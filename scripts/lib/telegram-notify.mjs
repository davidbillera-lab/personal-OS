// Reusable Telegram notifier for the autonomous execution dispatcher.
// Sends ONE plain-text message when a request enters `awaiting_approval`.
// Notice only — never the approval record. Rig-side ES module (Node 18+,
// global fetch). NOT part of the Next.js app tree — no Next/Vercel imports.
//
// Send pattern mirrors app/api/alerts/digest/route.ts: no parse_mode (plain
// text so build/QC output can't break formatting), no retry.

import { sanitizeForMC } from './sanitize-result.mjs'

const v = (x) => (x === undefined || x === null || x === '' ? '—' : x)
// C6-P5: Telegram is an outbound boundary in its own right. The dispatcher already
// sanitizes per field; this is the backstop for any caller that doesn't. 3500 keeps us
// inside Telegram's 4096-char message limit.
const outbound = (text) => sanitizeForMC(text, { maxLen: 3500 })

export async function notifyAwaitingApproval(params = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    const missing = [!botToken && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean)
    console.error('telegram-notify: missing config', missing)
    return { sent: false, reason: 'not configured' }
  }

  const { id, title, attempt_id, summary, qcVerdict, repo, branch, sha, runtimeSec } = params
  const text = outbound([
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
  ].join('\n'))

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

// Sent when a build attempt fails or times out (e.g. the plan is too large for
// the headless executor's window). This is the trigger that tells the operator a
// job fell out of the autonomous path and needs interactive handling. Same
// no-throw / config-guard pattern as notifyAwaitingApproval above.
export async function notifyBuildFailed(params = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    const missing = [!botToken && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean)
    console.error('telegram-notify: missing config', missing)
    return { sent: false, reason: 'not configured' }
  }

  const { id, title, reason } = params
  const text = outbound([
    `🛑 Build failed — ${v(title)}`,
    `Request: ${v(id)}`,
    `Reason: ${v(reason)}`,
    '',
    'Too big or errored for the auto-builder. Open a Claude window and say:',
    "\"check MC and build the pending job\".",
  ].join('\n'))

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

// Sent when the ops-classifier auto-holds a claimed request instead of building it.
// Same no-throw / config-guard pattern as notifyAwaitingApproval above.
export async function notifyClassifierHold(params = {}) {
  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    const missing = [!botToken && 'TELEGRAM_BOT_TOKEN', !chatId && 'TELEGRAM_CHAT_ID'].filter(Boolean)
    console.error('telegram-notify: missing config', missing)
    return { sent: false, reason: 'not configured' }
  }

  const { id, title, category } = params
  const text = outbound(`⚠️ MC auto-held request ${v(id)} ("${v(title)}") — flagged ${v(category)}. Review in Mission Control; not built.`)

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
