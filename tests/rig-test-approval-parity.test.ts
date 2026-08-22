// scripts/rig-test.mjs holds the SERVICE-ROLE key. Its `approve` command therefore is not a
// test fixture — it is a second, fully privileged door into the same approval gate.
//
// It used to be the weaker door: a bare `update ... where status='awaiting_approval'` that
// bound to no attempt and stamped no approved_sha. Anyone running it could approve an attempt
// the operator never reviewed, and the push gate had nothing to check consent against.
//
// Parity is enforced structurally: both callers go through applyApprovalDecision(), so the
// guard set cannot drift. These tests pin the shared behaviour AND that rig-test has not
// grown its own approval mutation again.
import { describe, it, expect } from 'vitest'
import { readFileSync } from 'fs'
import { execFileSync } from 'child_process'
import { applyApprovalDecision } from '../scripts/lib/approval-binding.mjs'

const SHA = 'a'.repeat(40)
const ATTEMPT = '22222222-2222-2222-2222-222222222222'
const REQ = '11111111-1111-1111-1111-111111111111'
const NOW = '2026-08-21T00:00:00.000Z'

const RIG_TEST_SRC = readFileSync('scripts/rig-test.mjs', 'utf8')

// Records exactly what the shared helper sends to supabase.
function stubClient() {
  const seen: { updates: any; filters: string[] } = { updates: null, filters: [] }
  const client = {
    from: () => {
      const c: any = {}
      c.update = (p: any) => { seen.updates = p; return c }
      c.eq = (col: string, val: any) => { seen.filters.push(`${col}=${val}`); return c }
      c.select = () => c
      c.maybeSingle = async () => ({ data: { id: REQ, ...seen.updates }, error: null })
      return c
    },
  }
  return { client, seen }
}

describe('rig-test approve — identical rules to mc_respond_approval', () => {
  it('stamps approved_sha and guards id + status + attempt + reviewed_sha', async () => {
    const { client, seen } = stubClient()
    await applyApprovalDecision(client, REQ, { status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: SHA }, {
      attemptId: ATTEMPT, decision: 'approve', actor: 'rig-test', now: NOW,
    })

    expect(seen.updates.approved_sha).toBe(SHA)
    expect(seen.updates.approved_by).toBe('rig-test')
    expect(seen.filters).toEqual([
      `id=${REQ}`, 'status=awaiting_approval', `attempt_id=${ATTEMPT}`, `reviewed_sha=${SHA}`,
    ])
  })

  it('refuses an attempt the operator did not review', async () => {
    const { client } = stubClient()
    await expect(applyApprovalDecision(client, REQ,
      { status: 'awaiting_approval', attempt_id: 'other-attempt', reviewed_sha: SHA },
      { attemptId: ATTEMPT, decision: 'approve', actor: 'rig-test', now: NOW },
    )).rejects.toThrow(/Attempt superseded/)
  })

  it('refuses to approve a request with no reviewed commit', async () => {
    const { client } = stubClient()
    await expect(applyApprovalDecision(client, REQ,
      { status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: null },
      { attemptId: ATTEMPT, decision: 'approve', actor: 'rig-test', now: NOW },
    )).rejects.toThrow(/no reviewed commit/)
  })

  it('reject clears approved_sha and skips the sha guard', async () => {
    const { client, seen } = stubClient()
    await applyApprovalDecision(client, REQ, { status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: SHA }, {
      attemptId: ATTEMPT, decision: 'reject', actor: 'rig-test', note: 'rig-test reject', now: NOW,
    })

    expect(seen.updates.approved_sha).toBeNull()
    expect(seen.filters).toEqual([`id=${REQ}`, 'status=awaiting_approval', `attempt_id=${ATTEMPT}`])
  })
})

describe('rig-test source — no second, weaker approval path', () => {
  it('routes decisions through the shared rules', () => {
    expect(RIG_TEST_SRC).toContain("from './lib/approval-binding.mjs'")
    expect(RIG_TEST_SRC).toContain('applyApprovalDecision(')
  })

  it('reads reviewed_sha from the server before deciding', () => {
    expect(RIG_TEST_SRC).toMatch(/select\('status, attempt_id, reviewed_sha'\)/)
  })

  it('THE REGRESSION: never hand-rolls an approval UPDATE of its own', () => {
    // The old bypass looked like `.update({ status: 'in_progress', ... approved_by: 'rig-test' })`.
    // Any inline update payload touching the approval columns is that bug coming back.
    const inlineUpdates = RIG_TEST_SRC.match(/\.update\(\{[\s\S]*?\}\)/g) ?? []
    for (const block of inlineUpdates) {
      expect(block, 'approval columns must only be written by the shared helper')
        .not.toMatch(/approved_by|approved_at|approved_sha/)
    }
  })

  it('exposes the attempt_id argument the operator needs to pin a review', () => {
    expect(RIG_TEST_SRC).toContain('attempt_id')
    expect(RIG_TEST_SRC).toMatch(/approve <id> \[attempt\]/)
  })
})

// Every other test in this file reads rig-test.mjs as TEXT, so the file can be source-perfect
// and still not run: a duplicate `import { applyApprovalDecision }` is an ESM early
// SyntaxError, and the CLI dies before main(). That shipped. This is the cheap check that the
// operator's emergency door actually opens.
//
// It must never IMPORT the module: rig-test.mjs calls main() at load, so an import in the
// test process would run the real CLI against production Mission Control. `--check` parses
// without executing; the no-arg run reaches usage() and returns before any Supabase client
// is constructed.
describe('rig-test CLI — actually loads and runs', () => {
  it('parses as a module (catches duplicate imports and other early SyntaxErrors)', () => {
    expect(() =>
      execFileSync(process.execPath, ['--check', 'scripts/rig-test.mjs'], { timeout: 30_000 }),
    ).not.toThrow()
  })

  it('runs with no arguments and prints usage instead of crashing', () => {
    const out = execFileSync(process.execPath, ['scripts/rig-test.mjs'], {
      encoding: 'utf8',
      timeout: 30_000,
    })
    expect(out).toContain('rig-test — drive the dispatcher rig test')
    expect(out).toContain('approve <id>')
  })
})
