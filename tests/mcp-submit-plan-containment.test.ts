// mc_submit_plan is the ONE write a 'chief'-scope Hermes token can reach (see
// mcp-chief-scope.test.ts). Everything protecting the autonomous relay downstream of it —
// the operator approval gate, the reviewed-SHA push binding, the CRON_SECRET dispatch
// route — rests on that write being a DEAD END: it deposits a planning artifact and does
// nothing else.
//
// This file pins the containment as a CONTRACT rather than a reading of the code. It asserts
// what mc_submit_plan can do at runtime (the exact column set it writes, against a mocked
// client) and what its source can reach (no egress, no process spawn, no dispatcher). It
// never touches live Mission Control.
//
// The invariant, stated once: mc_submit_plan may write plan + phase metadata and NOTHING
// else. It may not claim, queue, start or wake the dispatcher, approve, alter attempt /
// status / assignee, push, or deploy.
import { describe, expect, it, vi, beforeEach, afterEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

const state: { current: any; updateResult: any[] } = { current: null, updateResult: [] }
let updatePayload: Record<string, unknown> | null = null
let tablesTouched: string[] = []

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => ({
    from: (table: string) => {
      tablesTouched.push(table)
      let isUpdate = false
      const chain: any = {}
      chain.update = (payload: Record<string, unknown>) => {
        isUpdate = true
        updatePayload = payload
        return chain
      }
      chain.insert = (payload: Record<string, unknown>) => {
        isUpdate = true
        updatePayload = payload
        return chain
      }
      chain.select = () => chain
      chain.eq = () => chain
      chain.is = () => chain
      chain.in = () => chain
      chain.single = async () =>
        state.current ? { data: state.current, error: null } : { data: null, error: { message: 'no rows' } }
      chain.maybeSingle = async () => ({ data: state.updateResult[0] ?? null, error: null })
      return chain
    },
  }),
}))

// The complete set of columns a plan submission is permitted to write.
const ALLOWED_COLUMNS = ['plan', 'phase', 'plan_submitted_at', 'plan_by', 'updated_at']

// Columns that carry queueing, ownership, execution or consent. A plan submission that
// could write ANY of these would breach the gate it is meant to sit behind.
const FORBIDDEN_COLUMNS = [
  'status',          // -> could queue itself into an executable request
  'assigned_to',     // -> could reassign ownership
  'attempt_id',      // -> could rebind or supersede the reviewed attempt
  'approval_required',
  'approved_by',
  'approved_at',
  'approved_sha',    // -> could forge operator consent
  'reviewed_sha',    // -> could retarget consent at a different commit
  'blocker',
  'queued_at',
  'claimed_at',
  'completed_at',
  'result_summary',
  'artifact_refs',
  'latest_progress',
]

beforeEach(() => {
  updatePayload = null
  tablesTouched = []
  state.current = { status: 'submitted', assigned_to: 'hermes', plan: null }
  state.updateResult = [{ id: 'req-1', phase: 'planned', plan_submitted_at: '2026-08-21T00:00:00Z' }]
})

afterEach(() => {
  vi.unstubAllGlobals()
})

const submit = async (plan = 'the plan') => {
  const { callTool } = await import('@/lib/mcp-tools')
  return callTool('mc_submit_plan', { request_id: 'req-1', plan }, 'hermes')
}

describe('mc_submit_plan containment — what it writes', () => {
  it('writes plan + phase metadata and nothing else', async () => {
    await submit()
    expect(Object.keys(updatePayload!).sort()).toEqual([...ALLOWED_COLUMNS].sort())
  })

  it('cannot alter status, assignment, attempt, or approval state', async () => {
    await submit()
    for (const col of FORBIDDEN_COLUMNS) {
      expect(updatePayload, `mc_submit_plan must never write '${col}'`).not.toHaveProperty(col)
    }
  })

  it("sets phase to exactly 'planned' — never a queued or executing phase", async () => {
    await submit()
    expect(updatePayload!.phase).toBe('planned')
    // The phases that mean work is moving. A plan deposit must never produce one.
    expect(['queued', 'building', 'pushing', 'approved', 'completed']).not.toContain(updatePayload!.phase)
  })

  it('stamps the server-side actor, so plan_by cannot be spoofed by the caller', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    await callTool('mc_submit_plan', { request_id: 'req-1', plan: 'p', plan_by: 'operator' } as any, 'hermes')
    expect(updatePayload!.plan_by).toBe('hermes')
  })

  it('touches only the mc_requests row it was given — no other table', async () => {
    await submit()
    expect([...new Set(tablesTouched)]).toEqual(['mc_requests'])
  })
})

describe('mc_submit_plan containment — what its interface exposes', () => {
  it('declares exactly two inputs, so no extra column can be smuggled in', async () => {
    const { MCP_TOOLS } = await import('@/lib/mcp-tools')
    const tool = MCP_TOOLS.find(t => t.name === 'mc_submit_plan')!
    const props = Object.keys((tool.inputSchema as any).properties)
    expect(props.sort()).toEqual(['plan', 'request_id'])
    for (const col of FORBIDDEN_COLUMNS) {
      expect(props, `'${col}' must not be an accepted argument`).not.toContain(col)
    }
  })

  it('an unknown extra argument is ignored, not passed through to the write', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    await callTool(
      'mc_submit_plan',
      { request_id: 'req-1', plan: 'p', status: 'queued', assigned_to: 'dispatcher' } as any,
      'hermes',
    )
    expect(updatePayload).not.toHaveProperty('status')
    expect(updatePayload).not.toHaveProperty('assigned_to')
  })
})

describe('mc_submit_plan containment — what it can reach', () => {
  it('makes no network call: it cannot wake a dispatcher, push, or deploy', async () => {
    const fetchSpy = vi.fn(async () => new Response('{}'))
    vi.stubGlobal('fetch', fetchSpy)
    await submit()
    expect(fetchSpy, 'mc_submit_plan must not perform any HTTP egress').not.toHaveBeenCalled()
  })

  // Source-level boundary. The runtime test above proves this path made no call on the
  // happy path; this proves the capability is absent from the handler entirely.
  it('the handler source contains no process spawn, egress, or deploy call', () => {
    const src = readFileSync(join(process.cwd(), 'lib', 'mcp-tools.ts'), 'utf8')
    const start = src.indexOf("if (name === 'mc_submit_plan')")
    expect(start, 'handler not found — did the tool get renamed?').toBeGreaterThan(-1)

    // Slice the handler by brace balance from its opening block.
    let depth = 0
    let i = src.indexOf('{', start)
    const from = i
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) break
    }
    const handler = src.slice(from, i + 1)

    for (const forbidden of [
      'fetch(', 'spawn', 'exec', 'child_process',
      'dispatch', 'deploy', 'git push', 'notify',
      'mc_claim', 'mc_respond_approval', 'transitionRequest',
    ]) {
      expect(
        handler.includes(forbidden),
        `mc_submit_plan handler must not reference '${forbidden}'`,
      ).toBe(false)
    }
  })
})

describe('mc_submit_plan containment — the seam to the dispatcher', () => {
  // The one way a deposited plan could start work is the dispatcher's Gap A1 planned-claim
  // path. It is gated OFF by default: submitting a plan is inert until the OPERATOR turns
  // DISPATCHER_CLAIM_PLANNED on. Pinned here because it is the property that makes the
  // 'chief' write safe to hand to Hermes at all.
  it('a freshly deposited plan is not claimable while the operator gate is off', async () => {
    const { isClaimablePlanned } = await import('../scripts/lib/planned-claim.mjs')
    // Exactly the row mc_submit_plan produces.
    const deposited = { status: 'submitted', phase: 'planned', plan: 'the plan' }
    expect(isClaimablePlanned(deposited, false), 'gate off ⇒ inert').toBe(false)
    expect(isClaimablePlanned(deposited, undefined), 'gate unset ⇒ inert').toBe(false)
    // And with the operator gate explicitly on, it becomes eligible — proving the test
    // above is measuring the gate and not a malformed fixture.
    expect(isClaimablePlanned(deposited, true)).toBe(true)
  })

  it('the dispatcher reads the planned-claim gate from the environment, defaulting off', () => {
    const src = readFileSync(join(process.cwd(), 'scripts', 'dispatcher.mjs'), 'utf8')
    expect(src).toMatch(/const CLAIM_PLANNED = process\.env\.DISPATCHER_CLAIM_PLANNED === '1'/)
    // No `|| true`, no default-on fallback.
    expect(src).not.toMatch(/DISPATCHER_CLAIM_PLANNED\s*\|\|\s*(?:true|1)/)
  })
})
