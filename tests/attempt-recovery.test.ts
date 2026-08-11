// Regression cover for the 2026-08-08 lost-build incident: a finished build (684s, real
// commit) was discarded because the single Supabase write-back threw `TypeError: fetch
// failed`, and startup-only recovery would then have marked the row failed without ever
// looking at the commit sitting on disk.
//
// Proves: transport failures are retried; a finished build survives a total write-back
// outage; a stranded attempt is salvaged from disk rather than failed; and a row this
// dispatcher did not build is left strictly alone.
import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { mkdtempSync, rmSync, mkdirSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join, resolve, sep } from 'path'
import { spawnSync } from 'child_process'
import {
  withRetry, persistAttemptResult, readAttemptResult, clearAttemptResult,
  recoverFinishedBuild, isOurAttempt,
} from '../scripts/lib/attempt-recovery.mjs'

const REQ = '268a0c76-0b62-4e51-aa13-72a795952ef7'
const ATTEMPT = '3b885a7e-5674-42df-9546-6bb04a5028ed'
const row = { id: REQ, attempt_id: ATTEMPT }

let buildsDir: string
const quiet = () => {}
const noSleep = async () => {}

beforeEach(() => { buildsDir = mkdtempSync(join(tmpdir(), 'mc-builds-')) })
afterEach(() => { rmSync(buildsDir, { recursive: true, force: true }) })

describe('withRetry', () => {
  it('returns immediately on success without retrying', async () => {
    let calls = 0
    const res = await withRetry('ok', async () => { calls++; return { data: 'x' } }, { log: quiet, sleepFn: noSleep })
    expect(calls).toBe(1)
    expect(res.error).toBeUndefined()
  })

  it('retries a thrown TypeError (the undici "fetch failed" shape) and succeeds', async () => {
    let calls = 0
    const res = await withRetry('flaky', async () => {
      calls++
      if (calls < 3) throw new TypeError('fetch failed')
      return { data: 'recovered' }
    }, { log: quiet, sleepFn: noSleep })
    expect(calls).toBe(3)
    expect(res.data).toBe('recovered')
    expect(res.error).toBeUndefined()
  })

  it('retries a returned { error } too', async () => {
    let calls = 0
    const res = await withRetry('returned-error', async () => {
      calls++
      return calls < 2 ? { error: new Error('503') } : { data: 'ok' }
    }, { log: quiet, sleepFn: noSleep })
    expect(calls).toBe(2)
    expect(res.data).toBe('ok')
  })

  it('gives up after the attempt budget and RETURNS the error instead of throwing', async () => {
    // Not throwing is the whole point: the throw is what unwound the tick and lost the build.
    let calls = 0
    const res = await withRetry('dead', async () => { calls++; throw new TypeError('fetch failed') },
      { attempts: 4, log: quiet, sleepFn: noSleep })
    expect(calls).toBe(4)
    expect(res.error).toBeInstanceOf(TypeError)
  })
})

describe('attempt result sidecar', () => {
  it('round-trips a persisted result', () => {
    persistAttemptResult(buildsDir, REQ, ATTEMPT, { reviewedSha: 'abc123', qcVerdict: 'SHIP', commits: ['x'] })
    const back = readAttemptResult(buildsDir, REQ, ATTEMPT)
    expect(back?.reviewedSha).toBe('abc123')
    expect(back?.qcVerdict).toBe('SHIP')
  })

  it('is written OUTSIDE the workspace, so the untrusted build cannot forge it', () => {
    persistAttemptResult(buildsDir, REQ, ATTEMPT, { reviewedSha: 'abc123' })
    // the workspace handed to the container is <buildsDir>/<req>/<attempt>; the sidecar is
    // its SIBLING. Compare against workspace + separator — `<attempt>.result.json` shares a
    // string prefix with `<attempt>` without being inside that directory.
    const workspace = resolve(buildsDir, REQ, ATTEMPT)
    const sidecar = resolve(buildsDir, REQ, `${ATTEMPT}.result.json`)
    expect(sidecar.startsWith(workspace + sep)).toBe(false)
  })

  it('ignores a sidecar with no reviewedSha', () => {
    persistAttemptResult(buildsDir, REQ, ATTEMPT, { qcVerdict: 'SHIP' })
    expect(readAttemptResult(buildsDir, REQ, ATTEMPT)).toBeNull()
  })

  it('returns null once cleared', () => {
    persistAttemptResult(buildsDir, REQ, ATTEMPT, { reviewedSha: 'abc123' })
    clearAttemptResult(buildsDir, REQ, ATTEMPT)
    expect(readAttemptResult(buildsDir, REQ, ATTEMPT)).toBeNull()
  })

  it('returns null when nothing was ever persisted', () => {
    expect(readAttemptResult(buildsDir, REQ, ATTEMPT)).toBeNull()
  })
})

describe('isOurAttempt', () => {
  it('is true when this dispatcher created the workspace', () => {
    mkdirSync(resolve(buildsDir, REQ, ATTEMPT), { recursive: true })
    expect(isOurAttempt(buildsDir, row)).toBe(true)
  })

  it('is false for a row no workspace exists for (another worker claimed it)', () => {
    expect(isOurAttempt(buildsDir, row)).toBe(false)
  })

  it('is false when the row has no attempt_id', () => {
    expect(isOurAttempt(buildsDir, { id: REQ, attempt_id: null })).toBe(false)
  })
})

describe('recoverFinishedBuild', () => {
  it('prefers the sidecar when present', () => {
    persistAttemptResult(buildsDir, REQ, ATTEMPT, { reviewedSha: 'sidecar-sha', qcVerdict: 'FIX-FIRST' })
    const got = recoverFinishedBuild(buildsDir, row)
    expect(got?.reviewedSha).toBe('sidecar-sha')
    expect(got?.qcVerdict).toBe('FIX-FIRST') // real verdict preserved, not downgraded
  })

  it('salvages a commit from the workspace when there is no sidecar', () => {
    // This is the 268a0c76 case: container SIGKILLed at the timeout wall, but the commit
    // (the executor's last step) had already landed.
    const ws = resolve(buildsDir, REQ, ATTEMPT)
    mkdirSync(ws, { recursive: true })
    const git = (...a: string[]) => spawnSync('git', ['-C', ws, ...a], { encoding: 'utf8' })
    git('init')
    git('config', 'user.email', 't@t')
    git('config', 'user.name', 't')
    writeFileSync(join(ws, 'BUILD.txt'), 'work that must not be thrown away\n')
    git('add', '-A')
    git('commit', '-m', 'real build output')

    const got = recoverFinishedBuild(buildsDir, row)
    expect(got).not.toBeNull()
    expect(got!.reviewedSha).toMatch(/^[0-9a-f]{40}$/)
    expect(got!.salvaged).toBe(true)
    expect(got!.qcVerdict).toBe('UNKNOWN') // honest: QC was never run on this path
  })

  it('returns null for a workspace with no commit (genuinely interrupted)', () => {
    const ws = resolve(buildsDir, REQ, ATTEMPT)
    mkdirSync(ws, { recursive: true })
    spawnSync('git', ['-C', ws, 'init'], { encoding: 'utf8' })
    expect(recoverFinishedBuild(buildsDir, row)).toBeNull()
  })

  it('returns null when there is no workspace at all', () => {
    expect(recoverFinishedBuild(buildsDir, row)).toBeNull()
  })
})
