// Reusable Telegram notifier for the autonomous execution dispatcher.
// Sends ONE plain-text message when a request enters `awaiting_approval`.
// Notice only — never the approval record. Rig-side ES module (Node 18+,
// global fetch). NOT part of the Next.js app tree — no Next/Vercel imports.
//
// Send pattern mirrors app/api/alerts/digest/route.ts: no parse_mode (plain
// text so build/QC output can't break formatting), no retry.

const v = (x) => (x === undefined || x === null || x === '' ? '—' : x)

export async function notifyAwaitingApproval(params = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    const missing = [!botToken && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean)
    console.error('telegram-notify: missing config', missing)
    return { sent: false, reason: 'not configured' }
  }

  const { id, title, attempt_id, summary, qcVerdict, repo, branch, sha, runtimeSec } = params
  const text = [
    `🔔 Approval needed — ${v(title)}`,
    `Request: ${v(id)}`,
    `Attempt: ${v(attempt_id)}`,
    '',
    `Built: ${v(summary)}`,
    `QC: ${v(qcVerdict)}`,
    `Target: push commit ${v(sha)} to ${v(repo)}@${v(branch)}`,
    `Run time: ${v(runtimeSec)}s`,
    '',
    'Approve through ChatGPT Voice.',
  ].join('\n')

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text, disable_web_page_preview: true }),
  })

  if (!resp.ok) {
    console.error('telegram-notify: send failed', resp.status)
    return { sent: false, reason: `telegram ${resp.status}` }
  }

  return { sent: true }
}
