// Regression test for the bug that stranded operator approvals: findPushable() filtered
// assigned_to='claude', so an approved build whose row had been reassigned (mc_assign_request
// rewrites assigned_to at any time — e0afb33a and 713f6980 were both sitting at 'hermes' with
// real reviewed commits on disk) was invisible to the only code that can push it. reconcile()
// looked straight at it and logged "leaving for path B resume" on every sweep, handing off to
// a path that could not see it. Silent, permanent limbo.
//
// Ownership is now decided by evidence on disk, which no external write can forge.
import { describe, it, expect, vi, beforeAll, afterAll } from 'vitest'
import { mkdtempSync, mkdirSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'

const REQ = '11111111-1111-1111-1111-111111111111'
const ATTEMPT = '22222222-2222-2222-2222-222222222222'
const OTHER_REQ = '33333333-3333-3333-3333-333333333333'

let BUILDS: string
const rowsForQuery: any = { data: [] }

vi.mock('@supabase/supabase-js', () => ({
  createClient: () => ({
    from: () => {
      const c: any = {}
      for (const m of ['select', 'eq', 'in', 'not', 'is', 'order', 'limit', 'single', 'maybeSingle']) c[m] = () => c
      c.update = () => c; c.insert = () => c; c.upsert = () => c
      c.then = (res: any, rej: any) => Promise.resolve({ data: rowsForQuery.data, error: null }).then(res, rej)
      return c
    },
  }),
}))

const pushableRow = (over: any = {}) => ({
  id: REQ, attempt_id: ATTEMPT, status: 'in_progress', phase: 'pushing',
  approved_at: '2026-08-11T00:00:00Z', reviewed_sha: 'a'.repeat(40),
  workspace_ref: 'x', assigned_to: 'claude', ...over,
})

beforeAll(() => {
  BUILDS = mkdtempSync(join(tmpdir(), 'mc-pushable-'))
  // Only REQ/ATTEMPT gets a workspace on disk — that IS the ownership proof.
  mkdirSync(join(BUILDS, REQ, ATTEMPT), { recursive: true })
  process.env.DISPATCHER_BUILDS_DIR = BUILDS
  process.env.NEXT_PUBLIC_SUPABASE_URL = 'https://stub.supabase.co'
  process.env.SUPABASE_SERVICE_ROLE_KEY = 'stub'
})
afterAll(() => rmSync(BUILDS, { recursive: true, force: true }))

async function findPushableWith(rows: any[]) {
  rowsForQuery.data = rows
  const { findPushable, createAdminSupabaseClient } = await import('../scripts/dispatcher.mjs')
  return findPushable(createAdminSupabaseClient())
}

describe('findPushable — ownership by disk evidence, not by assigned_to', () => {
  it('THE REGRESSION: finds an approved row that was reassigned away from claude', async () => {
    const r = await findPushableWith([pushableRow({ assigned_to: 'hermes' })])
    expect(r, 'a reassigned approved build must still be pushable').not.toBeNull()
    expect(r.id).toBe(REQ)
  })

  it('finds it regardless of who the row claims to belong to', async () => {
    for (const who of ['claude', 'hermes', 'codex-qc', null, undefined]) {
      const r = await findPushableWith([pushableRow({ assigned_to: who })])
      expect(r?.id, `assigned_to=${who}`).toBe(REQ)
    }
  })

  it('leaves alone a row this dispatcher did not build (no workspace on disk)', async () => {
    const r = await findPushableWith([pushableRow({ id: OTHER_REQ, assigned_to: 'claude' })])
    expect(r).toBeNull()
  })

  it('skips a foreign row and returns the one we actually own', async () => {
    const r = await findPushableWith([
      pushableRow({ id: OTHER_REQ, attempt_id: ATTEMPT }),
      pushableRow({ assigned_to: 'hermes' }),
    ])
    expect(r?.id).toBe(REQ)
  })

  it('returns null when nothing is approved for push', async () => {
    expect(await findPushableWith([])).toBeNull()
  })

  it('ignores a row with no attempt_id (nothing on disk can prove ownership)', async () => {
    const r = await findPushableWith([pushableRow({ attempt_id: null })])
    expect(r).toBeNull()
  })
})
