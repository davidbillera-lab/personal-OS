#!/usr/bin/env node
// rig-test — operator CLI for driving the dispatcher rig test without hand-writing SQL.
// Lets a non-developer seed a queued mc_requests row, check its status, simulate the
// voice approval (mirrors mc_respond_approval's approve transition) BEFORE that tool is
// deployed, reject, list, and clean up. No AI reasoning here — plain CRUD against
// mc_requests, same env/client pattern as dispatcher.mjs.

import { createClient } from '@supabase/supabase-js'
import { readFileSync, writeFileSync, existsSync, unlinkSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// Same resolution as dispatcher.mjs's PAUSE_FILE — both scripts live in scripts/, so this
// must resolve to the identical path for the kill-switch to work.
const PAUSE_FILE = process.env.DISPATCHER_PAUSE_FILE || join(__dirname, '..', '.dispatcher-paused')

// ---- .env.local bootstrap (mirrors dispatcher.mjs / mcp-server.mjs; repo root is one level up) ----
try {
  const envPath = join(__dirname, '..', '.env.local')
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
  // .env.local absent — rely on already-set environment variables
}

function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) {
    throw new Error(
      'Missing NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY.\n' +
      'Make sure .env.local exists at the repo root with those two values set.'
    )
  }
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

const nowISO = () => new Date().toISOString()
const clip = (s, n = 60) => {
  const str = String(s ?? '')
  return str.length > n ? str.slice(0, n) + '…' : str
}

function usage() {
  console.log(`
rig-test — drive the dispatcher rig test without hand-writing SQL

Usage: node scripts/rig-test.mjs <command> [args]

Commands:
  seed "<request text>"   Create a queued rig-test request. Prints the new id.
  status <id>              Show the current state of a request.
  approve <id>             Simulate a voice approval (awaiting_approval → in_progress/pushing).
  reject <id>              Simulate a voice rejection (awaiting_approval → blocked).
  list                     List recent rig-test requests (newest first).
  cleanup                  Delete all rig-test requests.
  pause                    Engage the dispatcher kill-switch (writes .dispatcher-paused).
  resume                   Release the dispatcher kill-switch (deletes .dispatcher-paused).
`.trim())
}

async function cmdSeed(sb, args) {
  const text = args.join(' ').trim()
  if (!text) {
    console.log('Usage: node scripts/rig-test.mjs seed "<request text>"')
    process.exitCode = 1
    return
  }
  const { data, error } = await sb
    .from('mc_requests')
    .insert({
      request_text: text,
      status: 'queued',
      source: 'rig-test',
      created_by: 'rig-test',
      preferred_worker: 'claude',
    })
    .select('id')
    .single()
  if (error) {
    console.log(`Failed to seed request: ${error.message}`)
    process.exitCode = 1
    return
  }
  console.log(`Seeded request: ${data.id}`)
}

async function cmdStatus(sb, args) {
  const id = args[0]
  if (!id) {
    console.log('Usage: node scripts/rig-test.mjs status <id>')
    process.exitCode = 1
    return
  }
  const { data, error } = await sb.from('mc_requests').select('*').eq('id', id).maybeSingle()
  if (error) {
    console.log(`Failed to fetch request: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!data) {
    console.log(`No request found with id ${id}`)
    process.exitCode = 1
    return
  }
  console.log(`
Request ${data.id}
  status:           ${data.status}
  phase:            ${data.phase ?? '(none)'}
  attempt_id:       ${data.attempt_id ?? '(none)'}
  reviewed_sha:     ${data.reviewed_sha ? data.reviewed_sha.slice(0, 10) : '(none)'}
  workspace_ref:    ${data.workspace_ref ?? '(none)'}
  approved_by:      ${data.approved_by ?? '(none)'}
  blocker:          ${data.blocker ?? '(none)'}
  latest_progress:  ${data.latest_progress ?? '(none)'}
`.trim())
}

async function cmdApprove(sb, args) {
  const id = args[0]
  if (!id) {
    console.log('Usage: node scripts/rig-test.mjs approve <id>')
    process.exitCode = 1
    return
  }
  const { data, error } = await sb
    .from('mc_requests')
    .update({
      status: 'in_progress', phase: 'pushing', approval_required: false,
      approved_by: 'rig-test', approved_at: nowISO(), updated_at: nowISO(),
    })
    .eq('id', id).eq('status', 'awaiting_approval')
    .select('*')
    .maybeSingle()
  if (error) {
    console.log(`Failed to approve request: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!data) {
    const { data: current } = await sb.from('mc_requests').select('status').eq('id', id).maybeSingle()
    const currentStatus = current ? current.status : '(request not found)'
    console.log(`Cannot approve: request is not awaiting_approval (current status=${currentStatus}). Run a build first (Stage 2).`)
    process.exitCode = 1
    return
  }
  console.log(`Approved ${data.id} — status=${data.status} phase=${data.phase}. Dispatcher will pick up the gated push on its next poll.`)
}

async function cmdReject(sb, args) {
  const id = args[0]
  if (!id) {
    console.log('Usage: node scripts/rig-test.mjs reject <id>')
    process.exitCode = 1
    return
  }
  const { data, error } = await sb
    .from('mc_requests')
    .update({
      status: 'blocked', approval_required: false,
      approved_by: 'rig-test', approved_at: nowISO(), blocker: 'rig-test reject', updated_at: nowISO(),
    })
    .eq('id', id).eq('status', 'awaiting_approval')
    .select('*')
    .maybeSingle()
  if (error) {
    console.log(`Failed to reject request: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!data) {
    const { data: current } = await sb.from('mc_requests').select('status').eq('id', id).maybeSingle()
    const currentStatus = current ? current.status : '(request not found)'
    console.log(`Cannot reject: request is not awaiting_approval (current status=${currentStatus}). Run a build first (Stage 2).`)
    process.exitCode = 1
    return
  }
  console.log(`Rejected ${data.id} — status=${data.status}.`)
}

async function cmdList(sb) {
  const { data, error } = await sb
    .from('mc_requests')
    .select('id, status, phase, title, request_text, created_at')
    .eq('created_by', 'rig-test')
    .order('created_at', { ascending: false })
    .limit(20)
  if (error) {
    console.log(`Failed to list requests: ${error.message}`)
    process.exitCode = 1
    return
  }
  if (!data || data.length === 0) {
    console.log('No rig-test requests found.')
    return
  }
  console.log(`Found ${data.length} rig-test request(s):\n`)
  for (const r of data) {
    const label = r.title || clip(r.request_text, 40)
    console.log(`  ${r.id}  status=${r.status}  phase=${r.phase ?? '(none)'}  "${label}"`)
  }
}

async function cmdCleanup(sb) {
  const { data, error } = await sb
    .from('mc_requests')
    .delete()
    .eq('created_by', 'rig-test')
    .select('id')
  if (error) {
    console.log(`Failed to clean up: ${error.message}`)
    process.exitCode = 1
    return
  }
  const count = data ? data.length : 0
  console.log(`Deleted ${count} rig-test request(s).`)
}

function cmdPause() {
  writeFileSync(PAUSE_FILE, `paused via rig-test at ${nowISO()}\n`)
  console.log(`Kill-switch ENGAGED — wrote ${PAUSE_FILE}`)
  console.log('Dispatcher will halt (no claim, no build, no push) within one poll interval.')
}

function cmdResume() {
  if (existsSync(PAUSE_FILE)) {
    unlinkSync(PAUSE_FILE)
    console.log(`Kill-switch RELEASED — removed ${PAUSE_FILE}`)
  } else {
    console.log(`Kill-switch already released (${PAUSE_FILE} not present)`)
  }
}

async function main() {
  const [, , cmd, ...args] = process.argv
  const commands = {
    seed: cmdSeed, status: cmdStatus, approve: cmdApprove, reject: cmdReject, list: cmdList, cleanup: cmdCleanup,
    pause: cmdPause, resume: cmdResume,
  }
  const handler = commands[cmd]
  if (!handler) {
    usage()
    process.exitCode = cmd ? 1 : 0
    return
  }
  let sb
  try {
    sb = createAdminSupabaseClient()
  } catch (e) {
    console.log(e.message)
    process.exitCode = 1
    return
  }
  await handler(sb, args)
}

main()
