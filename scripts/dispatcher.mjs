// Rig-side autonomous dispatcher — Claude-only v0 (minimal voice slice, Piece 4).
//
// NO SHEBANG, deliberately. Node strips `#!` when it runs or imports a file, but vitest's
// module evaluator inlines the source and hands it to `new Script()` verbatim, where `#!`
// is a hard SyntaxError. That broke the C6-P5 return-path test — the one that proves secret
// scrubbing on the live path — with an error that pointed at the file but named no cause.
// pm2 launches this with an explicit node interpreter (ecosystem.config.cjs), so the
// shebang bought nothing and cost the security test that guards this file.
//
// Deterministic routing ONLY — no AI reasoning lives here. Each poll tick:
//   Path B (resume push): an operator-approved row (status=in_progress, phase=pushing,
//     approved_at + reviewed_sha + workspace_ref set) → run the SHA-bound GATED PUSH.
//   Path A (claim+build): else atomically claim ONE queued row → run the isolated build
//     via the executor adapter → request approval + fire the Telegram ping → WAIT.
//
// NON-NEGOTIABLES enforced here:
//   - Atomic claim via conditional UPDATE ... WHERE status='queued' (0 rows = lost race).
//   - The dispatcher NEVER calls mc_respond_approval. It requests approval and waits for
//     the operator (ChatGPT voice → mc_respond_approval). Self-approve is impossible here.
//   - Gated push verifies ALL before pushing (status/phase/approved_at, reviewed_sha +
//     workspace present, repo on allowlist + branch = mc-build-<id>, no newer reject, and
//     git HEAD === reviewed_sha). ANY failure ⇒ abort, no push, mark failed.
//   - Sandbox target is ALWAYS davidbillera-lab/mc-spike-test @ mc-build-<id>. Never a
//     portfolio repo.
//
// Second-half relay additions (specs/2026-08-06-autonomous-relay-second-half.md):
//   - Realtime: subscribes to mc_requests postgres_changes and schedules an immediate
//     debounced tick on change, in addition to (never instead of) the 5s poll loop, which
//     stays as the backstop if Realtime is unavailable for any reason.
//   - Gap A1, GATED OFF by default (DISPATCHER_CLAIM_PLANNED): when on, and only after no
//     queued row was found, the dispatcher may also claim a Hermes-deposited plan row
//     (status='submitted' AND phase='planned' AND plan IS NOT NULL).
//
// DEBT (v0, flagged): DB identity is the broad service-role key (scope-split deferred).
// Timeout is the spend-cap stand-in until Phase-2 spend tracking lands.

import { createClient } from '@supabase/supabase-js'
import { spawnSync } from 'child_process'
import { readFileSync, existsSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join, resolve } from 'path'
import crypto from 'crypto'
import { notifyAwaitingApproval, notifyClassifierHold, notifyBuildFailed, notifyPlanNeeded } from './lib/telegram-notify.mjs'
import { pickAdapter } from './lib/claude-executor-adapter.mjs'
import { classifyOps } from './lib/ops-classifier.mjs'
import { sanitizeForMC } from './lib/sanitize-result.mjs'
import { isClaimablePlanned } from './lib/planned-claim.mjs'
import { needsPlanNudge, planNudgeKey, PLAN_NUDGE_AFTER_MS } from './lib/plan-nudge.mjs'
import { resolveCloneTarget, cloneAllowlist } from './lib/clone-target.mjs'
import {
  withRetry, persistAttemptResult, clearAttemptResult, recoverFinishedBuild, isOurAttempt,
} from './lib/attempt-recovery.mjs'

const __filename = fileURLToPath(import.meta.url)
const __dirname = dirname(__filename)

// ---- .env.local bootstrap (mirror mcp-server.mjs; repo root is one level up) ----
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

// ---- config ----
const EXECUTOR = process.env.DISPATCHER_EXECUTOR || 'claude'
const POLL_MS = Number(process.env.DISPATCHER_POLL_MS || 5000)
// 30min default. Was 600000 (10min), which real portfolio builds ran straight through:
// measured 2026-08-06/08, two builds were SIGKILLed at exactly the 600s wall and a third
// only just survived (container ~600s + host QC = 684s total). The timeout is a spend cap,
// not a correctness control — set it above the real work, not through the middle of it.
const TIMEOUT_MS = Number(process.env.DISPATCHER_TIMEOUT_MS || 1800000)
const ALLOWED_REPOS = (process.env.DISPATCHER_ALLOWED_REPOS || 'davidbillera-lab/mc-spike-test')
  .split(',').map((s) => s.trim()).filter(Boolean)
const BUILDS_DIR = process.env.DISPATCHER_BUILDS_DIR || 'builds'
// mock-only — in production the push target is ALWAYS the fixed github sandbox; a stray
// env var cannot redirect the push.
const SANDBOX_REMOTE = (EXECUTOR === 'mock' && process.env.DISPATCHER_SANDBOX_REMOTE) ? process.env.DISPATCHER_SANDBOX_REMOTE : null
const SANDBOX_REPO = 'davidbillera-lab/mc-spike-test' // fixed; NEVER a portfolio repo
// Opt-in escape hatch, defaults OFF (C6-P4: unset ⇒ permissions ENFORCED). Leaving it off
// keeps the workspace deny-list live inside the container. See claude-executor-adapter.mjs.
const SKIP_PERMISSIONS = process.env.DISPATCHER_SKIP_PERMISSIONS === '1' || process.env.DISPATCHER_SKIP_PERMISSIONS === 'true'
// Test controls (deterministic runs): DISPATCHER_ONCE=1 → one tick then exit;
// DISPATCHER_MAX_TICKS=N → loop N ticks then exit. Neither set → run forever.
const RUN_ONCE = process.env.DISPATCHER_ONCE === '1' || process.env.DISPATCHER_ONCE === 'true'
const MAX_TICKS = process.env.DISPATCHER_MAX_TICKS ? Number(process.env.DISPATCHER_MAX_TICKS) : null
// Gap A1 (second-half relay), GATED OFF by default. Unset/false ⇒ dispatcher claims ONLY
// status='queued' rows, byte-for-byte the same as before this flag existed — see claimOne()
// and tick() below, where the planned-claim branch is guarded behind this flag and never
// touches a phase='planned' row unless it is true. Flip on to let the dispatcher also claim
// a Hermes-deposited plan (status='submitted' AND phase='planned' AND plan IS NOT NULL).
const CLAIM_PLANNED = process.env.DISPATCHER_CLAIM_PLANNED === '1' || process.env.DISPATCHER_CLAIM_PLANNED === 'true'
// Realtime event trigger (pure addition — the 5s poll loop below remains the backstop and
// keeps working on its own if Realtime setup throws or the subscription never connects).
// Debounce window: rapid-fire postgres_changes events collapse into a single tick.
const REALTIME_DEBOUNCE_MS = Number(process.env.DISPATCHER_REALTIME_DEBOUNCE_MS || 300)
// How often the reconcile sweep re-examines rows stuck in claimed/in_progress. Recovery
// used to run at startup ONLY, so a row stranded by a failed write-back stayed stranded
// until someone restarted the process (2026-08-08: two days).
const RECONCILE_MS = Number(process.env.DISPATCHER_RECONCILE_MS || 300000) // 5 min
let lastReconcileAt = 0
// Set for the duration of a build so the reconcile sweep never touches the live row.
let activeRequestId = null

// Kill-switch (operator emergency stop): while this file exists, tick() is a no-op —
// no claim, no build, no push. Migration-free, instant, no restart. Toggle via
// `node scripts/rig-test.mjs pause|resume`.
const PAUSE_FILE = process.env.DISPATCHER_PAUSE_FILE || join(__dirname, '..', '.dispatcher-paused')
let wasPaused = false
function isPaused() {
  const paused = existsSync(PAUSE_FILE)
  if (paused && !wasPaused) console.log(`[dispatcher] PAUSED — kill-switch engaged (${PAUSE_FILE})`)
  else if (!paused && wasPaused) console.log('[dispatcher] RESUMED — kill-switch released')
  wasPaused = paused
  return paused
}

const adapter = pickAdapter(EXECUTOR)
const nowISO = () => new Date().toISOString()
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))
const branchFor = (id) => `mc-build-${id}`
// C6-P5: every value that leaves this process goes through here. clip() keeps its old
// name and call sites, but now redacts secret-shaped strings before bounding length —
// the build result is an outbound channel even with the container sandbox in place.
const clip = (s, n = 480) => sanitizeForMC(s, { maxLen: n })

function createAdminSupabaseClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY
  if (!url || !key) throw new Error('NEXT_PUBLIC_SUPABASE_URL or SUPABASE_SERVICE_ROLE_KEY not set')
  return createClient(url, key, { auth: { autoRefreshToken: false, persistSession: false } })
}

async function logAudit(sb, tool, ok, error) {
  try { await sb.from('mcp_audit_log').insert({ actor: 'dispatcher', tool, ok, error: error ?? null }) }
  catch (e) { console.error(`[audit] write failed (non-fatal): ${e.message}`) }
}

// git helper (throws on nonzero) — the dispatcher IS the only push-cred holder; it is
// NOT subject to the workspace deny-list.
function git(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (r.status !== 0) throw new Error(`git ${args.join(' ')} (${r.status}): ${(r.stderr || r.stdout || '').trim()}`)
  return (r.stdout || '').trim()
}

// ---- durability: a finished build must survive a flaky network ----
// 2026-08-08 incident: request e0afb33a built cleanly (684s, commit 43f49d6, QC FIX-FIRST)
// and the result was LOST — the single write-back to Supabase raised `TypeError: fetch
// failed`, the throw unwound the tick, and the row sat in claimed/building forever with a
// finished commit stranded on disk. A completed build is expensive and irreplaceable; the
// network call that records it is neither. So: retry the write, and persist the result to
// disk BEFORE attempting it so a crash or a total network outage is still recoverable.

// Implementation + the full incident writeup live in scripts/lib/attempt-recovery.mjs
// (imported above). Bound to BUILDS_DIR here so the call sites below stay short.
const persistResult = (requestId, attemptId, result) => persistAttemptResult(BUILDS_DIR, requestId, attemptId, result)
const clearResult = (requestId, attemptId) => clearAttemptResult(BUILDS_DIR, requestId, attemptId)

// ---- Path A: atomic claim ----
async function claimOne(sb) {
  const { data: candidates, error: selErr } = await sb
    .from('mc_requests').select('id')
    .eq('status', 'queued').order('created_at', { ascending: true }).limit(1)
  if (selErr) throw new Error(`claim select failed: ${selErr.message}`)
  if (!candidates || candidates.length === 0) return null
  const candidateId = candidates[0].id
  const attemptId = crypto.randomUUID()
  const { data: claimed, error: updErr } = await sb
    .from('mc_requests')
    .update({ status: 'claimed', assigned_to: 'claude', phase: 'building', attempt_id: attemptId, updated_at: nowISO() })
    .eq('id', candidateId).eq('status', 'queued') // conditional: 0 rows ⇒ already claimed
    .select('*').maybeSingle()
  if (updErr) throw new Error(`claim update failed: ${updErr.message}`)
  if (!claimed) { console.log(`[claim] lost race on ${candidateId} (already claimed) — backing off`); return null }
  console.log(`[claim] ${claimed.id} attempt=${attemptId}`)
  await logAudit(sb, 'dispatcher.claim', true)
  return claimed
}

// ---- Path A: atomic claim of a Hermes-deposited plan (Gap A1, GATED OFF by default) ----
// Mirrors claimOne() exactly: select oldest eligible candidate, then a conditional UPDATE
// guarded on the row's still-unclaimed from-state; 0 rows back ⇒ another worker won the
// race, skip (no retry this tick). Only ever called from tick() when CLAIM_PLANNED is true
// AND claimOne() found no queued row — queued rows are always preferred, preserving the
// exact current ordering/behavior when this feature is off or idle.
async function claimPlannedOne(sb) {
  if (!CLAIM_PLANNED) return null // defense-in-depth; tick() already guards this before calling
  const { data: candidates, error: selErr } = await sb
    .from('mc_requests').select('*')
    .eq('status', 'submitted').eq('phase', 'planned').not('plan', 'is', null)
    .order('created_at', { ascending: true }).limit(1)
  if (selErr) throw new Error(`claim(planned) select failed: ${selErr.message}`)
  if (!candidates || candidates.length === 0) return null
  const candidate = candidates[0]
  // Belt-and-suspenders re-check against the pure eligibility rule (unit-tested in
  // tests/planned-claim.test.ts) before touching the row.
  if (!isClaimablePlanned(candidate, CLAIM_PLANNED)) return null
  const attemptId = crypto.randomUUID()
  const { data: claimed, error: updErr } = await sb
    .from('mc_requests')
    // Same target state as a queued claim: status='claimed', phase='building',
    // assigned_to='claude', attempt_id set, updated_at bumped.
    .update({ status: 'claimed', assigned_to: 'claude', phase: 'building', attempt_id: attemptId, updated_at: nowISO() })
    .eq('id', candidate.id).eq('status', 'submitted').eq('phase', 'planned') // conditional: 0 rows ⇒ already claimed
    .select('*').maybeSingle()
  if (updErr) throw new Error(`claim(planned) update failed: ${updErr.message}`)
  if (!claimed) { console.log(`[claim] lost race on planned ${candidate.id} (already claimed) — backing off`); return null }
  console.log(`[claim] planned ${claimed.id} attempt=${attemptId}`)
  await logAudit(sb, 'dispatcher.claim_planned', true)
  return claimed
}

// ---- Path A: ops-content safety check (blocklist — build unless flagged dangerous) ----
// Runs on every claimed row BEFORE the executor is invoked. Flagged ⇒ hold for operator
// review, no build, no push. See lib/ops-classifier.mjs for the rule set + caveats.
async function classifierGate(sb, row) {
  const verdict = classifyOps(`${row.title ?? ''}\n${row.request_text}`)
  if (!verdict.flagged) {
    console.log(`[classifier] passed ${row.id}`)
    return false
  }
  console.log(`[classifier] HELD ${row.id} category=${verdict.category} matched="${verdict.matched}"`)
  const blocker = clip(`auto-classifier: ${verdict.category} — held for operator review (matched: ${verdict.matched})`)
  await sb.from('mc_requests')
    .update({ status: 'blocked', phase: null, blocker, updated_at: nowISO() })
    .eq('id', row.id).eq('status', 'claimed')
  await logAudit(sb, 'dispatcher.classifier_blocked', false, verdict.category)
  const ping = await notifyClassifierHold({ id: row.id, title: row.title || clip(row.request_text, 40), category: verdict.category })
  console.log(`[classifier] ping ${JSON.stringify(ping)}`)
  return true
}

// ---- Path A: which repo (if any) may this request's build see? ----
// Default OFF: DISPATCHER_CLONEABLE_REPOS unset ⇒ cloneAllowlist() is empty ⇒
// resolveCloneTarget() returns null ⇒ an empty git init, exactly as before. Every lookup
// failure (no project, no repo_url, query error) also fails closed to null.
async function cloneTargetFor(sb, row) {
  const allowlist = cloneAllowlist()
  if (allowlist.length === 0 || !row.project_id) return null
  const { data, error } = await sb.from('projects').select('repo_url').eq('id', row.project_id).maybeSingle()
  if (error) { console.log(`[clone] repo lookup failed for ${row.id}: ${error.message} — building empty`); return null }
  const target = resolveCloneTarget(data?.repo_url, allowlist)
  if (!target) return null
  console.log(`[clone] ${row.id} → ${target.slug} (allowlisted)`)
  return target
}

// ---- Path A: build attempt via adapter ----
async function runAttempt(sb, row) {
  if (await classifierGate(sb, row)) return

  const attemptId = row.attempt_id
  const workspace = resolve(BUILDS_DIR, row.id, attemptId)
  const started = Date.now()
  const cloneTarget = await cloneTargetFor(sb, row)
  console.log(`[build] start ${row.id} executor=${EXECUTOR} workspace=${workspace} clone=${cloneTarget?.slug || 'none'}`)

  let result
  try {
    result = await adapter.launch({ workspace, request: row, env: process.env, timeoutMs: TIMEOUT_MS, skipPermissions: SKIP_PERMISSIONS, cloneTarget })
  } catch (e) {
    // Raw executor stderr — sanitize before it reaches the log OR mc_requests.blocker.
    console.log(`[build] FAILED ${row.id}: ${clip(e.message)}`)
    // Release the row out of 'claimed' — a swallowed error here once left a row
    // stuck mid-build (looked like it was still running). Check + log the write.
    // Retried: a failed build that ALSO fails to record its failure is the worst state —
    // the row keeps claiming to be building and nothing sweeps it (2026-08-08).
    const { error: uerr } = await withRetry('build-failed update', () => sb.from('mc_requests')
      .update({ status: 'failed', phase: null, blocker: clip(`build failed: ${e.message}`), updated_at: nowISO() })
      .eq('id', row.id).in('status', ['claimed', 'in_progress']))
    if (uerr) console.log(`[build] FAILED status-update error for ${row.id}: ${clip(uerr.message)} — reconcile will retry`)
    await logAudit(sb, 'dispatcher.build_failed', false, e.message)
    // Alert the operator: this job fell out of the autonomous path and needs a
    // human to run it interactively. Best-effort; never throws (no-ops if unconfigured).
    const ping = await notifyBuildFailed({ id: row.id, title: row.title || clip(row.request_text, 40), reason: clip(e.message, 200) })
      .catch((err) => ({ sent: false, reason: err?.message }))
    console.log(`[build] failure ping ${JSON.stringify(ping)}`)
    return
  }

  const runtimeSec = Math.round((Date.now() - started) / 1000)
  console.log(`[build] done ${row.id} sha=${result.reviewedSha} qc=${result.qcVerdict} (${runtimeSec}s)`)

  // Disk FIRST, network second. From here on the build is recoverable even if every
  // subsequent write fails: reconcile() replays this sidecar on the next tick.
  persistResult(row.id, attemptId, { ...result, workspace, runtimeSec })

  await requestApproval(sb, row, { ...result, workspace, runtimeSec })
}

// ---- move a finished build to awaiting_approval (shared: live path + reconcile) ----
// Split out of runAttempt so a build whose write-back failed can be replayed later from
// its sidecar without re-running the executor. Idempotent: the from-state guard means a
// replay against an already-advanced row is a no-op, not a double-request.
async function requestApproval(sb, row, result) {
  const { reviewedSha, qcVerdict, commits, workspace, runtimeSec } = result
  const attemptId = row.attempt_id
  const branch = branchFor(row.id)
  const title = row.title || clip(row.request_text, 40)
  const blocker = `built ${title}; CodexQC ${qcVerdict}; push commit ${reviewedSha} to ${SANDBOX_REPO}@${branch} — approve via ChatGPT Voice`

  const { data: awaiting, error: aerr } = await withRetry('request-approval update', () => sb
    .from('mc_requests')
    .update({
      status: 'awaiting_approval', phase: 'review', approval_required: true,
      reviewed_sha: reviewedSha, workspace_ref: workspace,
      latest_progress: clip(`built; CodexQC ${qcVerdict}; commit ${reviewedSha}`),
      blocker: clip(blocker), updated_at: nowISO(),
    })
    .eq('id', row.id).eq('status', 'claimed') // guard from-state
    .select('*').maybeSingle())

  // Retries exhausted: do NOT throw. The sidecar on disk is the record, the row stays
  // claimed/building, and reconcile() picks it up next tick. Throwing here is exactly
  // what lost the 2026-08-08 build.
  if (aerr) {
    console.log(`[approval] write-back failed for ${row.id} — build is SAFE on disk, reconcile will retry`)
    await logAudit(sb, 'dispatcher.request_approval', false, `write-back failed: ${aerr.message}`)
    return false
  }
  if (!awaiting) {
    console.log(`[approval] from-state guard failed for ${row.id} (no longer 'claimed') — not requesting`)
    clearResult(row.id, attemptId)
    return false
  }
  console.log(`[approval] requested ${row.id} → awaiting_approval (attempt ${attemptId})`)
  await logAudit(sb, 'dispatcher.request_approval', true)
  clearResult(row.id, attemptId) // recorded in MC — the sidecar is no longer the record

  // Telegram ping — best-effort, never throws (no-ops if TELEGRAM_* absent).
  const ping = await notifyAwaitingApproval({
    id: row.id, title, attempt_id: attemptId,
    summary: clip(commits, 800), // commit messages are executor-authored — sanitize
    qcVerdict, repo: SANDBOX_REPO, branch, sha: reviewedSha, runtimeSec,
  })
  console.log(`[ping] ${JSON.stringify(ping)}`)
  return true
}

// ---- Path B: find an approved, pushable row ----
// NOT filtered on assigned_to — same hole reconcile() had, and for the same reason.
// mc_assign_request can rewrite assigned_to at any time (e0afb33a and 713f6980 were both
// sitting at assigned_to='hermes' with a real reviewed commit on disk), and the old
// `.eq('assigned_to','claude')` made an approved row invisible to the only code that can
// push it. reconcile() then logged "leaving for path B resume" every sweep while path B
// could never see it — a silent, permanent limbo with no alert. Ownership is decided by
// evidence on disk (isOurAttempt), which no external write can forge; the gate in
// gatedPush() independently re-checks workspace_ref exists before anything is pushed.
async function findPushable(sb) {
  const { data, error } = await sb
    .from('mc_requests').select('*')
    .eq('status', 'in_progress').eq('phase', 'pushing')
    .not('approved_at', 'is', null).not('reviewed_sha', 'is', null).not('workspace_ref', 'is', null)
    .order('approved_at', { ascending: true }).limit(20)
  if (error) throw new Error(`findPushable failed: ${error.message}`)
  // Oldest approval first, but only rows THIS dispatcher built. A row claimed by another
  // worker has no attempt directory here, so we leave it strictly alone.
  for (const r of data || []) {
    if (isOurAttempt(BUILDS_DIR, r)) return r
    console.log(`[push] skip ${r.id} — approved but not this dispatcher's attempt (no workspace on disk)`)
  }
  return null
}

// ---- Path B: the SHA-bound GATED PUSH (safety core) ----
async function gatedPush(sb, row) {
  // Re-read fresh — never trust the row from the poll.
  const { data: r, error: rerr } = await sb.from('mc_requests').select('*').eq('id', row.id).single()
  if (rerr || !r) { console.log(`[push] re-read failed for ${row.id}: ${rerr?.message}`); return }

  const fail = async (reason) => {
    console.log(`[push] GATE FAIL ${r.id}: ${reason}`)
    await sb.from('mc_requests')
      .update({ status: 'failed', phase: null, blocker: clip(`push gate: ${reason}`), updated_at: nowISO() })
      .eq('id', r.id).eq('status', 'in_progress') // don't clobber a newer state
    await logAudit(sb, 'dispatcher.push', false, reason)
  }

  const branch = branchFor(r.id)

  // --- verify ALL ---
  if (r.status !== 'in_progress' || r.phase !== 'pushing' || !r.approved_at) {
    return fail(`not approved-for-push (status=${r.status} phase=${r.phase} approved_at=${r.approved_at})`)
  }
  console.log(`[push] gate: approved-for-push OK (approved_by=${r.approved_by} at ${r.approved_at})`)
  if (!r.reviewed_sha) return fail('reviewed_sha missing')
  if (!r.workspace_ref) return fail('workspace_ref missing')
  if (!existsSync(r.workspace_ref)) return fail(`workspace dir missing: ${r.workspace_ref}`)
  console.log(`[push] gate: reviewed_sha + workspace present OK (${r.workspace_ref})`)
  // SANDBOX_REMOTE is mock-only (see config above), so in production the push target is
  // always SANDBOX_REPO — this allowlist check is a real gate, not redirectable via env var.
  if (!ALLOWED_REPOS.includes(SANDBOX_REPO)) return fail(`repo ${SANDBOX_REPO} not on allowlist [${ALLOWED_REPOS.join(', ')}]`)
  if (branch !== `mc-build-${r.id}`) return fail(`branch ${branch} not the request's build branch`)
  console.log(`[push] gate: allowlist OK (${SANDBOX_REPO} @ ${branch})`)
  // no newer reject/cancel — the fresh re-read already confirmed status is in_progress;
  // this is the explicit belt-and-suspenders assertion.
  if (r.status === 'blocked' || r.status === 'cancelled') return fail(`superseded by ${r.status}`)

  // HEAD must be EXACTLY the reviewed+approved commit.
  let head
  try { head = git(r.workspace_ref, ['rev-parse', 'HEAD']) } catch (e) { return fail(`rev-parse failed: ${e.message}`) }
  if (head !== r.reviewed_sha) return fail(`SHA drift: HEAD ${head} != reviewed_sha ${r.reviewed_sha}`)
  console.log(`[push] gate: HEAD === reviewed_sha OK (${head})`)

  // --- all gates passed: push (dispatcher is the ONLY push-cred holder) ---
  const remote = SANDBOX_REMOTE || `https://github.com/${SANDBOX_REPO}.git`
  console.log(`[push] pushing ${head} → ${remote} ${branch}`)
  try {
    git(r.workspace_ref, ['push', remote, `HEAD:refs/heads/${branch}`])
  } catch (e) {
    return fail(`git push failed: ${e.message}`)
  }

  const repoURL = SANDBOX_REMOTE || `https://github.com/${SANDBOX_REPO}`
  const { data: done, error: derr } = await sb.from('mc_requests')
    .update({
      status: 'completed', phase: null,
      result_summary: `pushed ${head} to ${SANDBOX_REPO}@${branch}`,
      artifact_refs: [repoURL, head], completed_at: nowISO(), updated_at: nowISO(),
    })
    .eq('id', r.id).eq('status', 'in_progress') // guard: a newer state ⇒ don't double-complete
    .select('*').maybeSingle()
  if (derr) { console.log(`[push] complete update error ${r.id}: ${derr.message}`); return }
  if (!done) { console.log(`[push] complete guard failed for ${r.id} (a newer state won)`); return }
  console.log(`[push] SUCCESS ${r.id} → completed (${head})`)
  await logAudit(sb, 'dispatcher.push', true)
}

// ---- reconcile (startup, then periodically) ----
// Was startup-only, which is why the 2026-08-08 strandings sat untouched for two days —
// the dispatcher had been up since 08-06 and nothing re-examined a stuck row until restart.
async function reconcile(sb) {
  // Deliberately NOT filtered on assigned_to. That filter had a hole: mc_assign_request can
  // rewrite assigned_to while a build is in flight (2026-08-08, request e0afb33a was flipped
  // to 'hermes' mid-build), and the row then became invisible to its own recovery. Ownership
  // is decided below by evidence on disk, which no external write can forge.
  const { data: rows, error } = await sb.from('mc_requests').select('*')
    .in('status', ['claimed', 'in_progress'])
  if (error) { console.log(`[reconcile] query failed: ${error.message}`); return }
  for (const r of rows || []) {
    // Never touch the row this process is building right now. (Builds run via a blocking
    // spawnSync so a sweep cannot physically interleave with one — this is belt-and-braces
    // and documents the single-dispatcher assumption.)
    if (r.id === activeRequestId) continue

    // Ownership test: this dispatcher only reconciles attempts IT started, proven by the
    // build workspace it created. A row claimed by another worker has no such directory,
    // so we leave it strictly alone.
    const ours = isOurAttempt(BUILDS_DIR, r)
    if (!ours && r.assigned_to !== 'claude') continue

    // Cron orphan: a stray /api/queue/dispatch cron run claimed the row but never set
    // phase (only this dispatcher sets phase='building' at claim time). Reclaim it —
    // distinct from a legit interrupted build, which always has phase='building'.
    if (r.status === 'claimed' && !r.phase) {
      await withRetry('reconcile requeue', () => sb.from('mc_requests')
        .update({ status: 'queued', assigned_to: null, attempt_id: null, updated_at: nowISO() })
        .eq('id', r.id).eq('status', 'claimed'))
      console.log(`[reconcile] ${r.id} cron-orphan (claimed/phase=null) → requeued`)
      continue
    }

    const midBuild = ['building', 'qc', 'fixing'].includes(r.phase)
    if (midBuild && !r.reviewed_sha) {
      // SALVAGE BEFORE FAILING. A finished build whose write-back died looks identical to
      // an interrupted one from the DB alone; the difference is on disk. Marking this
      // failed without looking is what threw away a good 684s build.
      const finished = recoverFinishedBuild(BUILDS_DIR, r)
      if (finished) {
        console.log(`[reconcile] ${r.id} has a finished build on disk (${finished.reviewedSha}${finished.salvaged ? ', salvaged' : ''}) — replaying write-back`)
        const ok = await requestApproval(sb, r, finished)
        if (!ok) console.log(`[reconcile] ${r.id} write-back still failing — leaving claimed, will retry next sweep`)
        continue
      }
      await withRetry('reconcile fail', () => sb.from('mc_requests')
        .update({ status: 'failed', phase: null, blocker: 'dispatcher reconcile: build interrupted, no commit on disk', updated_at: nowISO() })
        .eq('id', r.id).in('status', ['claimed', 'in_progress']))
      console.log(`[reconcile] ${r.id} interrupted mid-build, nothing to salvage → failed`)
    } else if (r.phase === 'pushing' && r.approved_at && r.reviewed_sha) {
      console.log(`[reconcile] ${r.id} approved+pushing → leaving for path B resume`)
    } else {
      console.log(`[reconcile] ${r.id} no action (status=${r.status} phase=${r.phase} reviewed_sha=${r.reviewed_sha ? 'set' : 'null'})`)
    }
  }
}

// ---- Hermes planning wakeup ----
// Rides the same sweep as reconcile(). The relay's two halves both work — Hermes deposits a
// spec via mc_submit_plan (phase='planned'), claimPlannedOne() builds it from row.plan — but
// nothing ever TELLS Hermes a request is waiting, so submitted/phase=null rows wait forever
// (26d1849b: two days). This makes that stall loud within minutes instead of hours.
// Deduped through mc_alert_sends so a still-unplanned row is announced once, not every sweep.
async function nudgeUnplanned(sb) {
  const { data: rows, error } = await sb.from('mc_requests')
    .select('id, title, status, phase, plan, updated_at, created_at')
    .eq('status', 'submitted').is('phase', null).is('plan', null)
  if (error) { console.log(`[nudge] query failed: ${error.message}`); return }

  const now = new Date()
  const waiting = (rows || []).filter((r) => needsPlanNudge(r, now, PLAN_NUDGE_AFTER_MS))
  if (waiting.length === 0) return

  // Read the ledger once. A read failure degrades to "announce anyway" — same fail-safe
  // direction as the serverless sweep: a duplicate nudge beats a silent stall.
  const keys = waiting.map(planNudgeKey)
  let alreadySent = new Set()
  const { data: sent, error: sErr } = await sb.from('mc_alert_sends').select('transition_key').in('transition_key', keys)
  if (sErr) console.log(`[nudge] ledger read failed, announcing unsuppressed: ${sErr.message}`)
  else alreadySent = new Set((sent || []).map((s) => s.transition_key))

  for (const r of waiting) {
    const key = planNudgeKey(r)
    if (alreadySent.has(key)) continue
    const waitingMin = Math.round((now.getTime() - Date.parse(r.updated_at ?? r.created_at)) / 60000)
    const ping = await notifyPlanNeeded({ id: r.id, title: r.title || clip(r.id, 40), waitingMin })
      .catch((e) => ({ sent: false, reason: e?.message }))
    console.log(`[nudge] plan needed ${r.id} (${waitingMin}min) ${JSON.stringify(ping)}`)
    if (!ping.sent) continue // not announced ⇒ don't record it, so the next sweep retries
    // Record only what actually went out. A ledger write failure means a repeat next
    // sweep — noisy, not silent, which is the correct way to fail.
    const { error: lErr } = await sb.from('mc_alert_sends')
      .upsert({ transition_key: key, request_id: r.id, bucket: 'plan_nudge' }, { onConflict: 'transition_key', ignoreDuplicates: true })
    if (lErr) console.log(`[nudge] ledger write failed for ${r.id} (will re-announce): ${lErr.message}`)
  }
}

// ---- sandbox health gate ----
// Queued work WAITS while the sandbox is down instead of being claimed and failed one row
// at a time. Path B (pushing an already-approved, already-built commit) does not need the
// container and is deliberately NOT gated — an outage must not strand a finished build.
// Alerts on the down edge and logs the recovery edge, so an outage is announced once.
let sandboxDown = false
async function sandboxReady() {
  if (typeof adapter.health !== 'function') return true // mock/legacy adapters: nothing to check
  const { ok, reason } = adapter.health()
  if (ok) {
    if (sandboxDown) console.log('[sandbox] RECOVERED — resuming claims')
    sandboxDown = false
    return true
  }
  if (!sandboxDown) {
    sandboxDown = true
    console.log(`[sandbox] DOWN — not claiming any work: ${clip(reason, 200)}`)
    const ping = await notifyBuildFailed({
      id: 'sandbox', title: 'Executor sandbox unavailable — builds paused',
      reason: clip(reason, 200),
    }).catch((e) => ({ sent: false, reason: e?.message }))
    console.log(`[sandbox] down ping ${JSON.stringify(ping)}`)
  }
  return false
}

// ---- one tick ----
async function tick(sb) {
  if (isPaused()) return // skip every tick while paused; isPaused() logs the engage/release edge only
  const pushable = await findPushable(sb)
  if (pushable) { await gatedPush(sb, pushable); return } // path B before path A
  if (!await sandboxReady()) return // claiming now would only manufacture failed rows
  let claimed = await claimOne(sb)
  // Gap A1, GATED OFF by default: claimOne() above is untouched, so queued rows are always
  // tried first, exactly as before this feature existed. Only when no queued row was found
  // AND CLAIM_PLANNED is true do we call claimPlannedOne() at all — with the flag off/unset,
  // `&& CLAIM_PLANNED` is false, so claimPlannedOne() (and its phase='planned' query) is never
  // invoked, making this branch provably unreachable in the default state.
  if (!claimed && CLAIM_PLANNED) claimed = await claimPlannedOne(sb)
  if (claimed) {
    activeRequestId = claimed.id
    try { await runAttempt(sb, claimed) } finally { activeRequestId = null }
  }
}

async function safeTick(sb) {
  try { await tick(sb) } catch (e) { console.error(`[tick] error: ${e.message}`) }
}

// ---- concurrency guard + Realtime event trigger (pure addition to the poll loop) ----
// `ticking` makes sure only one tick ever runs at a time, whether it was woken by the poll
// loop or by a Realtime event. guardedTick() is what BOTH the poll loop and the Realtime
// handler call — never tick()/safeTick() directly — so there is one single gate.
let ticking = false
async function guardedTick(sb) {
  if (ticking) { console.log('[tick] skip — a tick is already running'); return }
  ticking = true
  try {
    // Periodic reconcile rides INSIDE the tick gate, so it can never overlap a build or
    // another sweep. Cheap (one indexed query) and only every RECONCILE_MS.
    if (Date.now() - lastReconcileAt >= RECONCILE_MS) {
      lastReconcileAt = Date.now()
      try { await reconcile(sb) } catch (e) { console.error(`[reconcile] error: ${e.message}`) }
      // Separate try: a nudge failure must never stop reconcile from running, and vice
      // versa. Both are best-effort sweeps; neither is allowed to take the tick down.
      try { await nudgeUnplanned(sb) } catch (e) { console.error(`[nudge] error: ${e.message}`) }
    }
    await safeTick(sb)
  } finally { ticking = false }
}

// Debounce: rapid-fire postgres_changes events (e.g. an insert immediately followed by an
// update) collapse into a single guardedTick() call instead of one per event.
let realtimeDebounceTimer = null
function scheduleTickFromRealtime(sb) {
  if (realtimeDebounceTimer) clearTimeout(realtimeDebounceTimer)
  realtimeDebounceTimer = setTimeout(() => {
    realtimeDebounceTimer = null
    guardedTick(sb).catch((e) => console.error(`[realtime] guarded tick error: ${e.message}`))
  }, REALTIME_DEBOUNCE_MS)
}

// Subscribing is a pure addition: on ANY failure here (network, auth, publication not
// configured, client shape mismatch, etc.) we log and return — the 5s poll loop below never
// depends on this succeeding and keeps running exactly as it always has.
let realtimeChannel = null
function setupRealtime(sb) {
  try {
    realtimeChannel = sb
      .channel('mc-dispatcher')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'mc_requests' }, () => {
        console.log('[realtime] mc_requests change received — scheduling a tick')
        scheduleTickFromRealtime(sb)
      })
      .subscribe((status) => console.log(`[realtime] subscription status: ${status}`))
    console.log('[realtime] subscribed to mc_requests postgres_changes (poll loop remains the backstop)')
  } catch (e) {
    console.error(`[realtime] setup failed — continuing on poll loop only: ${e.message}`)
    realtimeChannel = null
  }
}

function teardownRealtime(sb) {
  if (realtimeDebounceTimer) { clearTimeout(realtimeDebounceTimer); realtimeDebounceTimer = null }
  if (!realtimeChannel) return
  try { sb.removeChannel(realtimeChannel) } catch (e) { console.error(`[realtime] teardown error (non-fatal): ${e.message}`) }
  realtimeChannel = null
}

// ---- graceful shutdown ----
// pm2 (and Ctrl-C) send SIGINT/SIGTERM. Finish the current tick, then exit
// cleanly so a half-run tick never looks approved. A second signal forces exit.
// NOTE: a build runs via a BLOCKING spawnSync, so a signal received mid-build is
// handled only after that build returns (bounded by DISPATCHER_TIMEOUT_MS).
let shuttingDown = false
function requestShutdown(sig) {
  if (shuttingDown) { console.log(`[dispatcher] second ${sig} — forcing exit`); process.exit(1) }
  shuttingDown = true
  console.log(`[dispatcher] ${sig} received — finishing current tick, then exiting`)
}
process.on('SIGINT', () => requestShutdown('SIGINT'))
process.on('SIGTERM', () => requestShutdown('SIGTERM'))

async function main() {
  const sb = createAdminSupabaseClient()
  console.log(`[dispatcher] start executor=${EXECUTOR} poll=${POLL_MS}ms timeout=${TIMEOUT_MS}ms allowed=[${ALLOWED_REPOS.join(', ')}] remote=${SANDBOX_REMOTE || '(github default)'} skipPermissions=${SKIP_PERMISSIONS} once=${RUN_ONCE} maxTicks=${MAX_TICKS ?? '∞'} claimPlanned=${CLAIM_PLANNED}`)
  await reconcile(sb)
  lastReconcileAt = Date.now()
  // RUN_ONCE is the deterministic single-tick test mode — a Realtime subscription would
  // outlive that one tick for no benefit, so it's skipped there. Every other run mode gets it.
  if (RUN_ONCE) { await guardedTick(sb); console.log('[dispatcher] ONCE complete — exiting'); return }
  setupRealtime(sb)
  let ticks = 0
  while (!shuttingDown) {
    await guardedTick(sb)
    ticks += 1
    if (MAX_TICKS && ticks >= MAX_TICKS) { console.log(`[dispatcher] reached maxTicks=${MAX_TICKS} — exiting`); break }
    if (shuttingDown) break
    await sleep(POLL_MS)
  }
  teardownRealtime(sb)
  if (shuttingDown) console.log('[dispatcher] shutdown complete — exiting cleanly')
}

// Exported so tests can drive the real code paths directly instead of importing this file
// for its side effects. Importing the dispatcher USED to start it — which meant a test (or
// a careless `import`) ran the live dispatcher against production Mission Control, and made
// the C6-P5 return-path test depend on racing module-load side effects.
export {
  runAttempt, requestApproval, findPushable, gatedPush, reconcile, nudgeUnplanned,
  classifierGate, claimOne, claimPlannedOne, cloneTargetFor, tick, main,
  createAdminSupabaseClient,
}

// Only start when this file is the process entry point (`node scripts/dispatcher.mjs`,
// which is how pm2 runs it). Under `import`, this is false and nothing starts.
const isEntrypoint = (() => {
  try {
    return !!process.argv[1] && resolve(process.argv[1]) === resolve(fileURLToPath(import.meta.url))
  } catch { return false }
})()

if (isEntrypoint) {
  main().catch((e) => { console.error(`[dispatcher] fatal: ${e.message}`); process.exit(1) })
}
