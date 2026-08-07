import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { buildStuckJobsDigest, type StuckRequest } from '@/lib/alerts/stuck-jobs'

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
    .in('status', ['failed', 'blocked', 'awaiting_approval', 'submitted'])
    .order('updated_at', { ascending: true })

  if (error) {
    console.error('stuck-jobs: supabase error', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  const rows = ((data ?? []) as StuckRequest[]).filter(
    (r) => r.status !== 'submitted' || (r.phase === 'planned' && r.updated_at < cutoff),
  )

  // 4. Build; suppress all-clear (send nothing).
  const message = buildStuckJobsDigest(rows)
  if (message === null) {
    return NextResponse.json({ sent: false, reason: 'all_clear' }, { status: 200 })
  }

  // 5. Send one plain-text message. No parse_mode so request text can't break
  //    formatting. No retry — the next sweep is the retry.
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
  })

  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300)
    console.error('stuck-jobs: telegram send failed', resp.status, body)
    return NextResponse.json({ error: 'telegram send failed', status: resp.status }, { status: 502 })
  }

  return NextResponse.json({ sent: true }, { status: 200 })
}
