import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import {
  buildStuckJobsDigest,
  suppressAlreadySent,
  transitionKey,
  alertBucket,
  type StuckRequest,
} from '@/lib/alerts/stuck-jobs'

export const runtime = 'nodejs'

// Twice-daily Mission Control "jobs needing you" sweep → Telegram. Invoked by
// Vercel Cron (Authorization: Bearer <CRON_SECRET>). Serverless backstop to the
// rig dispatcher: surfaces requests that fell out of the autonomous path (build
// failed / too big, classifier-held, deposited-but-never-picked-up, or awaiting
// approval) so nothing rots silently. Sends nothing when clear (silence = all OK).

// STALE_PLANNED_MS in the builder is 2h; fetch is a coarse filter, the builder
// applies the precise cutoff.
const STALE_PLANNED_MS = 2 * 60 * 60 * 1000

export async function GET(req: NextRequest) {
  // 1. Fail-closed cron auth. No secret configured -> refuse everything.
  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return NextResponse.json({ error: 'CRON_SECRET not configured' }, { status: 401 })
  if (req.headers.get('authorization') !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: 'unauthorized' }, { status: 401 })
  }

  // 2. Runtime config — log only the missing name, never a value.
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    const missing = [!botToken && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean)
    console.error('stuck-jobs: missing config', missing)
    return NextResponse.json({ error: 'telegram not configured', missing }, { status: 503 })
  }

  // 3. Pull the actionable states with the admin client (bypasses RLS). Fresh
  //    'submitted' rows (phase != planned, or planned but recent) are dropped so
  //    only genuinely-stuck planned rows reach the builder.
  const supabase = createAdminSupabaseClient()
  const cutoff = new Date(Date.now() - STALE_PLANNED_MS).toISOString()
  const { data, error } = await supabase
    .from('mc_requests')
    .select('id, title, status, phase, blocker, updated_at')
    // 'in_progress' is here for the stuck_pushing bucket: a row approved for push that
    // never pushed. Omitting it is why a stranded approval was invisible to this sweep.
    // Non-stale in_progress rows are normal mid-flight work and bucket to null below.
    .in('status', ['failed', 'blocked', 'awaiting_approval', 'submitted', 'in_progress'])
    .order('updated_at', { ascending: true })

  if (error) {
    console.error('stuck-jobs: supabase error', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // Stale is the only condition here; phase is NOT filtered on. Requiring phase==='planned'
  // meant a workflow waiting on Hermes to plan it (phase null) could never reach the digest,
  // so it stalled invisibly — 26d1849b sat that way for two days. The builder still decides
  // which bucket it lands in.
  const rows = ((data ?? []) as StuckRequest[]).filter(
    (r) => r.status !== 'submitted' || r.updated_at < cutoff,
  )

  // 4. Drop transitions already announced in an earlier sweep, so an unresolved
  //    row isn't re-sent twice a day forever. A ledger read failure degrades to
  //    "send anyway" (empty set) — a duplicate alert beats a missed one.
  const now = new Date()
  const keys = rows.map((r) => transitionKey(r, now)).filter((k) => k !== '')
  let alreadySent = new Set<string>()
  if (keys.length > 0) {
    const { data: sentRows, error: sentErr } = await supabase
      .from('mc_alert_sends')
      .select('transition_key')
      .in('transition_key', keys)
    if (sentErr) {
      console.error('stuck-jobs: dedup ledger read failed, sending unsuppressed', sentErr.message)
    } else {
      alreadySent = new Set((sentRows ?? []).map((r: { transition_key: string }) => r.transition_key))
    }
  }

  const fresh = suppressAlreadySent(rows, alreadySent, now)

  // 5. Build; suppress all-clear (send nothing).
  const message = buildStuckJobsDigest(fresh, now)
  if (message === null) {
    return NextResponse.json(
      { sent: false, reason: keys.length > 0 ? 'no_new_transitions' : 'all_clear' },
      { status: 200 },
    )
  }

  // 6. Send one plain-text message. No parse_mode so request text can't break
  //    formatting. No retry — the next sweep is the retry.
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
  })

  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300)
    console.error('stuck-jobs: telegram send failed', resp.status, body)
    // Not recorded: a failed send must stay eligible for the next sweep.
    return NextResponse.json({ error: 'telegram send failed', status: resp.status }, { status: 502 })
  }

  // 7. Record only what we actually announced, and only after Telegram accepted.
  //    upsert + ignoreDuplicates makes a concurrent sweep a no-op rather than an
  //    error. A ledger write failure means the next sweep repeats this message —
  //    noisy, not silent, which is the correct direction to fail.
  const ledger = fresh
    .map((r) => ({
      transition_key: transitionKey(r, now),
      request_id: r.id,
      bucket: alertBucket(r, now),
    }))
    .filter((row) => row.transition_key !== '' && row.bucket !== null)

  if (ledger.length > 0) {
    const { error: writeErr } = await supabase
      .from('mc_alert_sends')
      .upsert(ledger, { onConflict: 'transition_key', ignoreDuplicates: true })
    if (writeErr) console.error('stuck-jobs: dedup ledger write failed', writeErr.message)
  }

  return NextResponse.json({ sent: true, announced: ledger.length }, { status: 200 })
}
