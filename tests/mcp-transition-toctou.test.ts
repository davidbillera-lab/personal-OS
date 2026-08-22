// The worker state machine must hold under CONCURRENCY, not just under sequential calls.
//
// The bug: transitionRequest() SELECTs `status`, checks it against `allowedFrom`, and then
// UPDATEs filtered on `.eq('id', ...)` ALONE. Between the read and the write the row is
// unguarded, so two callers that both read a legal from-state both pass the check and both
// write. Concretely:
//
//   - two workers read status='queued', both pass, both claim -> the second silently steals
//     a request the first already owns, and BOTH get a success response naming themselves
//     as assigned_to. Nothing anywhere reports the collision.
//   - a worker reads 'in_progress' and completes while the operator rejects to 'blocked' ->
//     the completion lands on a rejected request, erasing the rejection.
//
// The fix re-asserts the EXACT allowedFrom set in the UPDATE's WHERE clause (`.in('status',
// allowedFrom)`), so the database picks the winner and the loser matches 0 rows and is told
// to re-fetch. Same shape as the mc_submit_plan `.is('plan', null)` fix (mcp-plan-write-once)
// and the mc_respond_approval attempt binding (approval-sha-binding).
//
// NOTE: there is no stdio mirror to keep in step. mcp-server.mjs implements mc_submit_plan
// only -- it carries none of the worker state-machine tools -- so lib/mcp-tools.ts is the
// single implementation of transitionRequest. `mcp-transition-no-stdio-mirror` pins that.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

type Filter = { op: string; col: string; values?: unknown }

// Row the "read current state" step sees, and the row the guarded UPDATE resolves to
// (empty = the guard matched 0 rows, i.e. this caller lost the race).
const state: { current: any; updateResult: any[] } = { current: null, updateResult: [] }
let updateFilters: Filter[] = []
let updatePayload: Record<string, unknown> | null = null

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => ({
    from: () => {
      let isUpdate = false
      const chain: any = {}
      chain.update = (payload: Record<string, unknown>) => {
        isUpdate = true
        updatePayload = payload
        return chain
      }
      chain.select = () => chain
      chain.eq = (col: string, value: unknown) => {
        if (isUpdate) updateFilters.push({ op: 'eq', col, values: value })
        return chain
      }
      chain.in = (col: string, values: unknown) => {
        if (isUpdate) updateFilters.push({ op: 'in', col, values })
        return chain
      }
      chain.is = (col: string, values: unknown) => {
        if (isUpdate) updateFilters.push({ op: 'is', col, values })
        return chain
      }
      chain.single = async () =>
        state.current ? { data: state.current, error: null } : { data: null, error: { message: 'no rows' } }
      chain.maybeSingle = async () => ({ data: state.updateResult[0] ?? null, error: null })
      return chain
    },
  }),
}))

const statusGuard = () => updateFilters.find(f => f.col === 'status')
const guardedStatuses = () => {
  const g = statusGuard()
  return Array.isArray(g?.values) ? [...(g!.values as string[])].sort() : g?.values
}

beforeEach(() => {
  updateFilters = []
  updatePayload = null
  state.current = { status: 'queued' }
  state.updateResult = [{ id: 'req-1', status: 'claimed', assigned_to: 'worker-a' }]
})

describe('transitionRequest — the UPDATE re-asserts the from-state', () => {
  it('guards mc_claim_request on status, not on id alone', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    await callTool('mc_claim_request', { request_id: 'req-1', worker: 'worker-a' })

    expect(updateFilters.map(f => f.col), 'UPDATE must still target the row by id').toContain('id')
    expect(
      statusGuard(),
      'UPDATE must re-assert the from-state; .eq(id) alone leaves a read-then-write window',
    ).toBeDefined()
  })

  it('guards on the EXACT allowedFrom set, so the window cannot be widened by accident', async () => {
    const { callTool } = await import('@/lib/mcp-tools')

    // A claim is legal only from 'queued'.
    await callTool('mc_claim_request', { request_id: 'req-1', worker: 'worker-a' })
    expect(guardedStatuses()).toEqual(['queued'])

    // A completion is legal from exactly these three.
    updateFilters = []
    state.current = { status: 'in_progress' }
    state.updateResult = [{ id: 'req-1', status: 'completed', assigned_to: 'worker-a' }]
    await callTool('mc_complete_request', { request_id: 'req-1', result_summary: 'done' })
    expect(guardedStatuses()).toEqual(['awaiting_approval', 'claimed', 'in_progress'])
  })

  it('carries the guard on every transitioning tool, not just the one that was fixed', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    const cases: Array<[string, Record<string, string>, string]> = [
      ['mc_claim_request', { request_id: 'r', worker: 'w' }, 'queued'],
      ['mc_reassign_request', { request_id: 'r', worker: 'w' }, 'queued'],
      ['mc_post_progress', { request_id: 'r', progress: 'p' }, 'in_progress'],
      ['mc_mark_blocked', { request_id: 'r', blocker: 'b' }, 'in_progress'],
      ['mc_request_approval', { request_id: 'r', reason: 'why' }, 'in_progress'],
      ['mc_complete_request', { request_id: 'r', result_summary: 's' }, 'in_progress'],
      ['mc_mark_failed', { request_id: 'r', reason: 'boom' }, 'in_progress'],
    ]
    for (const [tool, args, from] of cases) {
      updateFilters = []
      state.current = { status: from }
      state.updateResult = [{ id: 'r', status: 'x', assigned_to: 'w' }]
      await callTool(tool, args)
      expect(statusGuard(), `${tool} must re-assert its from-state on the UPDATE`).toBeDefined()
      expect(
        (statusGuard()!.values as string[]).includes(from),
        `${tool} guard must admit the state it was read in`,
      ).toBe(true)
    }
  })
})

describe('transitionRequest — the concurrent loser is refused, never silently applied', () => {
  it('two workers cannot both claim the same request', async () => {
    const { callTool } = await import('@/lib/mcp-tools')

    // Worker A wins: the row was 'queued' and its guarded UPDATE matched.
    const first = JSON.parse(await callTool('mc_claim_request', { request_id: 'req-1', worker: 'worker-a' }))
    expect(first.assigned_to).toBe('worker-a')

    // Worker B read the same 'queued' snapshot and so clears the pre-check too -- this is
    // the TOCTOU window. Its guarded UPDATE now matches 0 rows because A flipped the status.
    state.updateResult = []
    await expect(
      callTool('mc_claim_request', { request_id: 'req-1', worker: 'worker-b' }),
    ).rejects.toThrow(/re-fetch and retry/)
  })

  it('a completion cannot land on a request that moved under it', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    // Worker read 'in_progress'; the operator rejected it to 'blocked' before the write.
    state.current = { status: 'in_progress' }
    state.updateResult = []
    await expect(
      callTool('mc_complete_request', { request_id: 'req-1', result_summary: 'done' }),
    ).rejects.toThrow(/re-fetch and retry/)
  })

  it('names the request and the states it expected, so the loser can act on the error', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.updateResult = []
    await expect(
      callTool('mc_claim_request', { request_id: 'req-42', worker: 'worker-b' }),
    ).rejects.toThrow(/req-42/)
  })
})

describe('transitionRequest — existing semantics preserved', () => {
  it('still rejects an illegal from-state before attempting any UPDATE', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.current = { status: 'completed' }
    await expect(
      callTool('mc_claim_request', { request_id: 'req-1', worker: 'worker-a' }),
    ).rejects.toThrow(/Not allowed from status 'completed'/)
    expect(updateFilters, 'no UPDATE should have been attempted').toEqual([])
  })

  it('still reports a missing request distinctly from a lost race', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.current = null
    await expect(
      callTool('mc_claim_request', { request_id: 'nope', worker: 'worker-a' }),
    ).rejects.toThrow(/Request not found: nope/)
  })

  it('still writes the same columns and returns the same response shape', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    const out = JSON.parse(await callTool('mc_claim_request', { request_id: 'req-1', worker: 'worker-a' }))
    expect(out).toEqual({ request_id: 'req-1', status: 'claimed', assigned_to: 'worker-a' })
    expect(updatePayload).toMatchObject({ status: 'claimed', assigned_to: 'worker-a' })
    expect(updatePayload, 'updated_at must still be bumped').toHaveProperty('updated_at')
  })

  it('still validates required args before touching the database', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    await expect(callTool('mc_claim_request', { request_id: 'req-1' })).rejects.toThrow(
      'request_id and worker are required',
    )
    expect(updateFilters).toEqual([])
  })
})

describe('mcp-transition-no-stdio-mirror', () => {
  // transitionRequest exists in exactly one place. If someone later ports the worker
  // state-machine tools into the stdio server, this fails and tells them to bring the
  // atomic guard with them rather than re-introducing the TOCTOU in a second copy.
  it('the stdio server carries no un-guarded copy of the worker state machine', () => {
    const stdio = readFileSync(join(process.cwd(), 'mcp-server.mjs'), 'utf8')
    for (const tool of [
      'mc_claim_request',
      'mc_reassign_request',
      'mc_post_progress',
      'mc_mark_blocked',
      'mc_request_approval',
      'mc_complete_request',
      'mc_mark_failed',
    ]) {
      expect(
        stdio.includes(tool),
        `${tool} appeared in mcp-server.mjs -- port the .in('status', allowedFrom) guard too`,
      ).toBe(false)
    }
  })
})
