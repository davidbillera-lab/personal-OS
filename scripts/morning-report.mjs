#!/usr/bin/env node
// Rig-native morning status report — factual snapshot of git/dispatcher/MC state,
// sent to Telegram. Standalone: does not touch the dispatcher or its adapters.
//
// Usage:
//   node scripts/morning-report.mjs             gather + send
//   node scripts/morning-report.mjs --dry-run   gather + compose + print only

import { createClient } from '@supabase/supabase-js'
import { execSync } from 'child_process'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)
const REPO_ROOT = join(__dirname, '..')
const DRY_RUN = process.argv.includes('--dry-run')

// ---- .env.local bootstrap (mirrors dispatcher.mjs) ----
try {
  const envPath = join(REPO_ROOT, '.env.local')
  const raw = readFileSync(envPath, 'utf8')
  for (const line of raw.split('\n')) {
    const trimmed = line.trim()
    if (!trimmed || trimmed.startsWith('#')) continue
    const eq = trimmed.indexOf('=')
    if (eq < 1) continue
    const key = trimmed.slice(0, eq).trim()
    let value = trimmed.slice(eq + 1)
    if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
      value = value.slice(1, -1)
    }
    if (!(key in process.env)) process.env[key] = value
  }
} catch {
  // .env.local absent - rely on already-set environment variables
}

const TRACKED_REQUESTS = [
  { id: '20d5c8af-46ff-4439-b893-73edf1847598', label: 'Homeroom Tutor' },
  { id: '66143987-fda8-43aa-b63c-74ffd6a4143b', label: 'Telegram alerts' },
]

function getRecentCommits() {
  try {
    const out = execSync('git log --oneline -8', { cwd: REPO_ROOT, encoding: 'utf8' })
    const lines = out.split('\n').map((l) => l.trim()).filter(Boolean)
    return lines.length ? lines : ['(no commits found)']
  } catch (e) {
    return [`git log failed: ${e.message.split('\n')[0]}`]
  }
}

function getDispatcherState() {
  try {
    const out = execSync('pm2 jlist', { encoding: 'utf8' })
    const procs = JSON.parse(out)
    const proc = procs.find((p) => p.name === 'mc-dispatcher')
    if (!proc) return 'mc-dispatcher: not found in pm2 process list'
    const status = proc.pm2_env && proc.pm2_env.status ? proc.pm2_env.status : 'unknown'
    return `mc-dispatcher: ${status}`
  } catch (e) {
    if (e.code === 'ENOENT' || /not recognized|not found/i.test(e.message)) {
      return 'pm2 unavailable'
    }
    return `pm2 check failed: ${e.message.split('\n')[0]}`
  }
}

async function getRequestStates() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    return TRACKED_REQUESTS.map((r) => `${r.label}: lookup failed (Supabase env not set)`)
  }
  try {
    const sb = createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
    const ids = TRACKED_REQUESTS.map((r) => r.id)
    const { data, error } = await sb.from('mc_requests').select('id,status,phase').in('id', ids)
    if (error) {
      return TRACKED_REQUESTS.map((r) => `${r.label}: query error (${error.message})`)
    }
    return TRACKED_REQUESTS.map((r) => {
      const row = (data || []).find((d) => d.id === r.id)
      if (!row) return `${r.label}: not found in mc_requests`
      return `${r.label}: status=${row.status}, phase=${row.phase}`
    })
  } catch (e) {
    return TRACKED_REQUESTS.map((r) => `${r.label}: query failed (${e.message.split('\n')[0]})`)
  }
}

function readPlainLine(states) {
  const bothStuck = states.every((s) => /phase=planned/.test(s))
  const anyBuilding = states.some((s) => /phase=(building|queued|awaiting_approval|completed)/.test(s))
  if (bothStuck) return 'Both plans still parked at planned -> second-half not wired yet.'
  if (anyBuilding) return 'At least one plan has moved past planned -> relay is carrying work forward.'
  return 'Mixed/unclear state -> check Mission Control directly.'
}

async function main() {
  const commits = getRecentCommits()
  const dispatcherLine = getDispatcherState()
  const requestLines = await getRequestStates()
  const dateStr = new Date().toISOString().slice(0, 10)

  const message = [
    `MC overnight status - ${dateStr}`,
    '',
    'Recent commits (main):',
    ...commits.map((c) => `- ${c}`),
    '',
    'Dispatcher:',
    `- ${dispatcherLine}`,
    '',
    'Tracked plans:',
    ...requestLines.map((l) => `- ${l}`),
    '',
    readPlainLine(requestLines),
  ].join('\n')

  if (DRY_RUN) {
    console.log(message)
    return
  }

  const botToken = process.env.TELEGRAM_BOT_TOKEN
  const chatId = process.env.TELEGRAM_CHAT_ID
  if (!botToken || !chatId) {
    console.error('morning-report: missing TELEGRAM_BOT_TOKEN or TELEGRAM_CHAT_ID; printing instead')
    console.log(message)
    return
  }

  const resp = await fetch(`https://api.telegram.org/bot${botToken}/sendMessage`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ chat_id: chatId, text: message, disable_web_page_preview: true }),
  })

  if (!resp.ok) {
    console.error(`morning-report: telegram send failed (${resp.status})`)
    console.log(message)
    return
  }

  console.log('morning-report: sent')
}

main().catch((e) => {
  console.error('morning-report: fatal error', e.message)
  process.exit(1)
})
