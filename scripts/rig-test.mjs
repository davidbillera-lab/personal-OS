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
// Same rules the real tool runs. This CLI holds the SERVICE-ROLE key, so an approve path
// here that is weaker than mc_respond_approval's attempt+SHA binding is a real bypass of the
// approval gate, not a test-only shortcut — hence one shared implementation, imported ONCE.
import { applyApprovalDecision } from './lib/approval-binding.mjs'

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
  seed "<request text>"    Create a queued rig-test request. Prints the new id.
  status <id>              Show the current state of a request.
  approve <id> <attempt>   Simulate a voice approval (awaiting_approval → in_progress/pushing).
                           attempt_id is REQUIRED — copy it from 'status'. It names the
                           attempt you actually reviewed, so an approval can never land on
                           a rebuild that replaced it while you were looking.
  reject <id> <attempt>    Simulate a voice rejection (awaiting_approval → blocked).
                           attempt_id is REQUIRED here too, matching mc_respond_approval.
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
  approved_sha:     ${data.approved_sha ? data.approved_sha.slice(0, 10) : '(none)'}
  workspace_ref:    ${data.workspace_ref ?? '(none)'}
  approved_by:      ${data.approved_by ?? '(none)'}
  blocker:          ${data.blocker ?? '(none)'}
  latest_progress:  ${data.latest_progress ?? '(none)'}
`.trim())
}

// Read the row, then write through the SHARED guarded decision. The old version issued a
// bare `update ... where status='awaiting_approval'` with the service-role key: it bound to
// no attempt and stamped no approved_sha, so it could land on an attempt the operator never
// reviewed and left the push gate with nothing to check consent against.
//
// attempt_id is REQUIRED, exactly as in mc_respond_approval. It used to be optional, and
// when omitted this CLI passed `current.attempt_id` — the attempt as it stands on the
// SERVER — into the decision. That defeats the binding entirely: the guard then re-asserts
// whatever the row already says, so a rebuild that replaced the reviewed attempt between the
// operator's look and their `approve` was approved as if it had been reviewed. The operator
// must name the attempt; this CLI never fills it in for them.
async function decide(sb, decision, args) {
  const id = args[0]
  const expectedAttempt = args[1] // REQUIRED: the attempt the operator reviewed
  if (!id || !expectedAttempt) {
    console.log(`Usage: node scripts/rig-test.mjs ${decision} <id> <attempt_id>`)
    console.log("attempt_id is required — run 'status <id>' and copy the attempt_id you reviewed.")
    process.exitCode = 1
    return
  }
  const { data: current, error: readErr } = await sb
    .from('mc_requests')
    .select('status, attempt_id, reviewed_sha')
    .eq('id', id)
    .maybeSingle()
  if (readErr) {
    console.log(`Failed to read request: ${readErr.message}`)
    process.exitCode = 1
    return
  }
  if (!current) {
    console.log(`No request found with id ${id}`)
    process.exitCode = 1
    return
  }
  if (current.status !== 'awaiting_approval') {
    console.log(`Cannot ${decision}: request is not awaiting_approval (current status=${current.status}). Run a build first (Stage 2).`)
    process.exitCode = 1
    return
  }
  if (expectedAttempt !== current.attempt_id) {
    console.log(`Cannot ${decision}: attempt superseded — you passed ${expectedAttempt} but the current attempt is ${current.attempt_id ?? '(none)'}.`)
    process.exitCode = 1
    return
  }

  let result
  try {
    result = await applyApprovalDecision(sb, id, current, {
      // The OPERATOR's attempt, never current.attempt_id — see the note above.
      attemptId: expectedAttempt,
      decision,
      actor: 'rig-test',
      note: decision === 'reject' ? 'rig-test reject' : null,
      now: nowISO(),
    })
  } catch (e) {
    console.log(`Cannot ${decision}: ${e.message}`)
    process.exitCode = 1
    return
  }
  if (result.error) {
    console.log(`Failed to ${decision} request: ${result.error.message}`)
    process.exitCode = 1
    return
  }
  if (!result.data) {
    console.log(`Cannot ${decision}: the request moved while the decision was being applied (attempt superseded, reviewed commit changed, or already resolved). Re-run status and try again.`)
    process.exitCode = 1
    return
  }
  const data = result.data
  if (decision === 'approve') {
    console.log(`Approved ${data.id} — status=${data.status} phase=${data.phase} approved_sha=${data.approved_sha}. Dispatcher will pick up the gated push on its next poll.`)
  } else {
    console.log(`Rejected ${data.id} — status=${data.status}.`)
  }
}

const cmdApprove = (sb, args) => decide(sb, 'approve', args)
const cmdReject = (sb, args) => decide(sb, 'reject', args)

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
