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

type Row = Record<string, unknown>

// Only the slice of the supabase builder applyApprovalDecision actually reaches.
interface Chain {
  update: (p: Row) => Chain
  eq: (col: string, val: unknown) => Chain
  select: () => Chain
  maybeSingle: () => Promise<{ data: Row; error: null }>
}

// Records exactly what the shared helper sends to supabase.
function stubClient() {
  const seen: { updates: Row | null; filters: string[] } = { updates: null, filters: [] }
  const client = {
    from: () => {
      const c: Chain = {
        update: (p: Row) => { seen.updates = p; return c },
        eq: (col: string, val: unknown) => { seen.filters.push(`${col}=${String(val)}`); return c },
        select: () => c,
        maybeSingle: async () => ({ data: { id: REQ, ...seen.updates }, error: null }),
      }
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

  it('documents attempt_id as required, not optional', () => {
    expect(RIG_TEST_SRC).toContain('attempt_id')
    expect(RIG_TEST_SRC).toMatch(/approve <id> <attempt>/)
    expect(RIG_TEST_SRC, 'an optional attempt is the bug').not.toMatch(/approve <id> \[attempt\]/)
  })

  // THE BYPASS: when the attempt was omitted, this CLI passed `current.attempt_id` — the
  // attempt as it stands on the SERVER — into the decision. The binding then re-asserts what
  // the row already says, which is no binding at all: a rebuild that replaced the reviewed
  // attempt between the operator's look and their `approve` got approved as reviewed.
  it('never substitutes the server\'s current attempt for the one the operator named', () => {
    expect(RIG_TEST_SRC).toMatch(/attemptId:\s*expectedAttempt/)
    expect(RIG_TEST_SRC, 'the server-read attempt must never be the approval target')
      .not.toMatch(/attemptId:\s*current\.attempt_id/)
  })

  it('refuses both decisions when the attempt is missing, before any write', () => {
    // Both commands land in the same guard, so neither can drift looser than the other.
    expect(RIG_TEST_SRC).toMatch(/if \(!id \|\| !expectedAttempt\)/)
    expect(RIG_TEST_SRC).toMatch(/attempt_id is required/)
  })
})

describe('the shared rules refuse an unbound decision on their own', () => {
  // Belt and braces: even if a caller forgets the CLI-level guard, the helper both call
  // sites share will not build a decision that is bound to nothing.
  it('rejects approve with no attempt_id', async () => {
    const { client } = stubClient()
    await expect(applyApprovalDecision(client, REQ,
      { status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: SHA },
      { attemptId: undefined, decision: 'approve', actor: 'rig-test', now: NOW },
    )).rejects.toThrow(/attempt_id is required/)
  })

  it('rejects reject with no attempt_id', async () => {
    const { client } = stubClient()
    await expect(applyApprovalDecision(client, REQ,
      { status: 'awaiting_approval', attempt_id: ATTEMPT, reviewed_sha: SHA },
      { attemptId: undefined, decision: 'reject', actor: 'rig-test', now: NOW },
    )).rejects.toThrow(/attempt_id is required/)
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
    expect(out, 'the usage the operator reads must show attempt_id as required')
      .toContain('approve <id> <attempt>')
  })
})
