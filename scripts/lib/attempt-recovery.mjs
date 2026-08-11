// Durability layer for dispatcher build attempts.
//
// WHY THIS EXISTS (2026-08-08 incident): request e0afb33a built cleanly — 684s, real commit
// 43f49d6, CodexQC FIX-FIRST — and the result was LOST. The single write-back to Supabase
// raised `TypeError: fetch failed`, the throw unwound the tick, and the row sat in
// claimed/building forever while a finished commit sat on disk that nothing would ever look
// at. Startup-only recovery then compounded it: the dispatcher had been up since 08-06, so
// nothing re-examined the row for two days, and when recovery DID run its rule was
// "mid-build with no reviewed_sha -> failed", which would have thrown the commit away.
//
// The invariant this module buys: a finished build is recorded on disk BEFORE any network
// call, and is replayable until MC has actually accepted it. Compute is expensive and
// irreplaceable; the HTTP call that records it is neither.

import { spawnSync } from 'child_process'
import { existsSync, readFileSync, writeFileSync, mkdirSync, unlinkSync } from 'fs'
import { dirname, resolve } from 'path'

const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

// Retry a Supabase write on transport-level failure. supabase-js surfaces those two ways —
// a thrown TypeError (undici) or a returned { error } — so treat both as retryable and let
// the caller decide what a final failure means. Never throws.
export async function withRetry(label, fn, { attempts = 5, baseMs = 1000, log = console.log, sleepFn = sleep } = {}) {
  let lastErr
  for (let i = 1; i <= attempts; i++) {
    try {
      const res = await fn()
      if (!res?.error) return res
      lastErr = res.error
    } catch (e) {
      lastErr = e
    }
    if (i < attempts) {
      const wait = baseMs * 2 ** (i - 1) // 1s, 2s, 4s, 8s
      log(`[retry] ${label} attempt ${i}/${attempts} failed (${lastErr?.message ?? lastErr}) — retrying in ${wait}ms`)
      await sleepFn(wait)
    }
  }
  log(`[retry] ${label} EXHAUSTED after ${attempts} attempts: ${lastErr?.message ?? lastErr}`)
  return { error: lastErr ?? new Error(`${label} failed`) }
}

// The sidecar lives NEXT TO the workspace, never inside it: the workspace is the rw mount
// handed to the untrusted build, so a file in there is build-writable and cannot be trusted
// as a record of what the build produced.
export const resultPathFor = (buildsDir, requestId, attemptId) =>
  resolve(buildsDir, requestId, `${attemptId}.result.json`)

export function persistAttemptResult(buildsDir, requestId, attemptId, result, { log = console.log } = {}) {
  try {
    const p = resultPathFor(buildsDir, requestId, attemptId)
    mkdirSync(dirname(p), { recursive: true })
    writeFileSync(p, JSON.stringify({ requestId, attemptId, ...result, persistedAt: new Date().toISOString() }, null, 2))
    return p
  } catch (e) {
    log(`[durable] could not persist result for ${requestId}: ${e.message}`)
    return null
  }
}

export function readAttemptResult(buildsDir, requestId, attemptId) {
  try {
    const p = resultPathFor(buildsDir, requestId, attemptId)
    if (!existsSync(p)) return null
    const r = JSON.parse(readFileSync(p, 'utf8'))
    return r?.reviewedSha ? r : null
  } catch { return null }
}

export function clearAttemptResult(buildsDir, requestId, attemptId) {
  try {
    const p = resultPathFor(buildsDir, requestId, attemptId)
    if (existsSync(p)) unlinkSync(p)
  } catch { /* a stale sidecar is harmless — it is only read for rows still mid-build */ }
}

// Ownership test. This dispatcher reconciles ONLY attempts it started, proven by the build
// workspace it created. Needed because mc_assign_request can rewrite assigned_to while a
// build is in flight (e0afb33a was flipped to 'hermes' mid-build and its own recovery then
// couldn't see it). A directory on the rig is evidence no external write can forge.
export function isOurAttempt(buildsDir, row) {
  if (!row?.attempt_id) return false
  return existsSync(resolve(buildsDir, row.id, row.attempt_id))
}

function gitOut(cwd, args) {
  const r = spawnSync('git', ['-C', cwd, ...args], { encoding: 'utf8' })
  if (r.status !== 0) return null
  return (r.stdout || '').trim()
}

// Did this attempt actually finish? Two sources, best first.
//   1. the sidecar — authoritative for any build after this module shipped
//   2. a commit in the workspace — covers builds stranded BEFORE the sidecar existed, and
//      any case where the sidecar write itself failed
// A commit is the executor's LAST step, so its presence means the build reached the end
// even if the container was killed immediately after (which is exactly what happened to
// 268a0c76: SIGKILLed at the 600s wall with commit 8b73b991 already on disk).
export function recoverFinishedBuild(buildsDir, row) {
  if (!row?.attempt_id) return null

  const sidecar = readAttemptResult(buildsDir, row.id, row.attempt_id)
  if (sidecar) return sidecar

  const workspace = resolve(buildsDir, row.id, row.attempt_id)
  if (!existsSync(workspace)) return null
  const reviewedSha = gitOut(workspace, ['rev-parse', 'HEAD'])
  if (!reviewedSha) return null
  const logOut = gitOut(workspace, ['log', '--oneline'])
  // QC is NOT re-derived here: runHostQc blocks the loop for up to 5 minutes and this path
  // is rare. UNKNOWN is honest, and the operator still gates the push either way.
  return {
    reviewedSha,
    qcVerdict: 'UNKNOWN',
    commits: logOut ? logOut.split('\n').filter(Boolean) : [],
    workspace,
    runtimeSec: null,
    salvaged: true,
  }
}
