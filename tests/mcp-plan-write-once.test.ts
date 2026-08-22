// mc_submit_plan write-once must hold under CONCURRENCY, not just under sequential calls.
//
// The bug: validatePlanPrecondition() reads the row and rejects if `plan` is already set,
// but the UPDATE that follows only re-asserted `.eq('status','submitted')`. Two concurrent
// submits therefore both read plan=null, both passed the precondition, and the second
// silently overwrote the first plan -- losing a planning artifact with no error anywhere.
//
// The fix is `.is('plan', null)` on the UPDATE, so the database decides the winner and the
// loser matches 0 rows. These tests pin that filter in place.
import { describe, expect, it, vi, beforeEach } from 'vitest'

// Row the "read current state" step sees, and rows the UPDATE resolves to.
const state: { current: any; updateResult: any[] } = { current: null, updateResult: [] }
// Every filter applied to the UPDATE chain, e.g. ['eq:id', 'eq:status', 'is:plan'].
let updateFilters: string[] = []

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => ({
    from: () => {
      let isUpdate = false
      const chain: any = {}
      chain.update = () => { isUpdate = true; return chain }
      chain.select = () => chain
      chain.eq = (col: string) => { if (isUpdate) updateFilters.push(`eq:${col}`); return chain }
      chain.is = (col: string) => { if (isUpdate) updateFilters.push(`is:${col}`); return chain }
      chain.single = async () =>
        state.current ? { data: state.current, error: null } : { data: null, error: { message: 'no rows' } }
      chain.maybeSingle = async () => ({ data: state.updateResult[0] ?? null, error: null })
      return chain
    },
  }),
}))

const submitted = { status: 'submitted', assigned_to: 'hermes', plan: null }
const winnerRow = { id: 'req-1', phase: 'planned', plan_submitted_at: '2026-08-21T00:00:00Z' }

beforeEach(() => {
  updateFilters = []
  state.current = { ...submitted }
  state.updateResult = [winnerRow]
})

describe('mc_submit_plan — atomic write-once', () => {
  it('re-asserts plan IS NULL on the UPDATE, not just the read-then-check', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    await callTool('mc_submit_plan', { request_id: 'req-1', plan: 'the plan' }, 'hermes')

    expect(updateFilters, 'UPDATE must be guarded by plan IS NULL').toContain('is:plan')
    // The status guard must survive too -- it stops a plan landing on a request that
    // moved to queued/claimed between the read and the write.
    expect(updateFilters).toContain('eq:status')
    expect(updateFilters).toContain('eq:id')
  })

  it('the concurrent loser matches 0 rows and is told to re-fetch, never silently dropped', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    // Both callers read plan=null (state.current), so both clear the precondition.
    // The winner's write already landed, so the loser's guarded UPDATE returns no row.
    state.updateResult = []

    await expect(
      callTool('mc_submit_plan', { request_id: 'req-1', plan: 'second plan' }, 'hermes'),
    ).rejects.toThrow(/re-fetch and retry/)
  })

  it('still stamps the server-side actor rather than trusting the caller', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    const out = await callTool('mc_submit_plan', { request_id: 'req-1', plan: 'the plan' }, 'hermes')
    expect(JSON.parse(out)).toEqual({
      request_id: 'req-1',
      phase: 'planned',
      plan_submitted_at: winnerRow.plan_submitted_at,
    })
  })

  it('rejects before any UPDATE when the request is not submitted+hermes', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    state.current = { status: 'queued', assigned_to: 'hermes', plan: null }
    await expect(
      callTool('mc_submit_plan', { request_id: 'req-1', plan: 'x' }, 'hermes'),
    ).rejects.toThrow('Plan intake requires a submitted request assigned to hermes')
    expect(updateFilters, 'no UPDATE should have been attempted').toEqual([])
  })

  it('rejects an oversized plan before touching the database at all', async () => {
    const { callTool } = await import('@/lib/mcp-tools')
    const { MC_SUBMIT_PLAN_MAX_LENGTH } = await import('@/lib/mcp-tools')
    await expect(
      callTool('mc_submit_plan', { request_id: 'req-1', plan: 'a'.repeat(MC_SUBMIT_PLAN_MAX_LENGTH + 1) }, 'hermes'),
    ).rejects.toThrow(/exceeds max length/)
    expect(updateFilters).toEqual([])
  })
})
