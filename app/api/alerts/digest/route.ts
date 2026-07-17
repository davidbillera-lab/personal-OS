import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { buildProjectDigest, type DigestProject } from '@/lib/alerts/digest'

export const runtime = 'nodejs'

// Daily Mission Control health digest → Telegram. Invoked by Vercel Cron
// (which sends `Authorization: Bearer <CRON_SECRET>`). Delivery lane is
// entirely serverless — no dependency on the local Hermes rig. Sends nothing
// when there is nothing actionable (silence = all-clear).

const PROJECT_COLUMNS =
  'name, tier, stage, status, kill_criteria_status, blockers, last_update, next_action'

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
    console.error('digest: missing config', missing)
    return NextResponse.json({ error: 'telegram not configured', missing }, { status: 503 })
  }

  // 3. Read project health with the admin client (bypasses RLS).
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('projects')
    .select(PROJECT_COLUMNS)
    .order('tier', { ascending: true })

  if (error) {
    console.error('digest: supabase error', error.message)
    return NextResponse.json({ error: error.message }, { status: 500 })
  }

  // 4. Build; suppress all-clear (send nothing).
  const message = buildProjectDigest((data ?? []) as unknown as DigestProject[])
  if (message === null) {
    return NextResponse.json({ sent: false, reason: 'all_clear' }, { status: 200 })
  }

  // 5. Send one plain-text message. No parse_mode so project text can't break
  //    formatting. No retry — the next daily cron is the retry.
  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
  })

  if (!resp.ok) {
    const body = (await resp.text()).slice(0, 300)
    console.error('digest: telegram send failed', resp.status, body)
    return NextResponse.json({ error: 'telegram send failed', status: resp.status }, { status: 502 })
  }

  return NextResponse.json({ sent: true }, { status: 200 })
}
