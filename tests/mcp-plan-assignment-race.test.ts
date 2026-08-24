// mc_submit_plan's precondition is "submitted AND assigned to hermes", but only the
// `status` half was re-asserted on the atomic UPDATE. `assigned_to` was checked against the
// PRE-READ row and never again.
//
// The race: Hermes reads a submitted+hermes request, an operator (or the routing path)
// reassigns it to another worker, and Hermes's UPDATE then lands anyway -- delivering a plan
// written for hermes onto a request now owned by someone else, with a success response.
//
// The fix is `.eq('assigned_to', 'hermes')` on the UPDATE, so the database decides. These
// tests play the database rather than hard-coding the outcome: the mocked UPDATE evaluates
// its own filters against the row as it exists AT WRITE TIME. Drop the filter and the write
// lands on the reassigned row and the race tests fail.
import { describe, expect, it, vi, beforeEach } from 'vitest'
import { readFileSync } from 'fs'
import { join } from 'path'

type Filter = { op: 'eq' | 'is'; col: string; val: unknown }
type Row = Record<string, unknown>
type QueryResult = { data: Row | null; error: { message: string } | null }

// Only the slice of the supabase builder this handler actually reaches.
interface Chain {
  from: () => Chain
  update: (p: Row) => Chain
  select: () => Chain
  eq: (col: string, val: unknown) => Chain
  is: (col: string, val: unknown) => Chain
  single: () => Promise<QueryResult>
  maybeSingle: () => Promise<QueryResult>
}

// `read` is what the pre-read sees; `atWrite` is the committed row the UPDATE is evaluated
// against. Divergence between the two IS the race.
const state: { read: Row | null; atWrite: Row | null } = { read: null, atWrite: null }
let filters: Filter[] = []
let payload: Row | null = null
let landed = false

const matches = (row: Row | null, f: Filter) =>
  f.op === 'is' ? (row?.[f.col] ?? null) === f.val : row?.[f.col] === f.val

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: () => {
    let isUpdate = false
    const chain: Chain = {
      from: () => chain,
      update: (p: Row) => { isUpdate = true; payload = p; return chain },
      select: () => chain,
      eq: (col: string, val: unknown) => { if (isUpdate) filters.push({ op: 'eq', col, val }); return chain },
      is: (col: string, val: unknown) => { if (isUpdate) filters.push({ op: 'is', col, val }); return chain },
      single: async () =>
        state.read ? { data: state.read, error: null } : { data: null, error: { message: 'no rows' } },
      // The UPDATE resolves against the committed row: all filters must match, exactly as
      // Postgres would. No match -> 0 rows -> maybeSingle returns null.
      maybeSingle: async () => {
        if (!filters.every(f => matches(state.atWrite, f))) return { data: null, error: null }
        landed = true
        return { data: { id: 'req-1', phase: 'planned', plan_submitted_at: '2026-08-21T00:00:00Z' }, error: null }
      },
    }
    return { from: chain.from }
  },
}))

const submittedToHermes = { id: 'req-1', status: 'submitted', assigned_to: 'hermes', plan: null }

beforeEach(() => {
  filters = []
  payload = null
  landed = false
  state.read = { ...submittedToHermes }
  state.atWrite = { ...submittedToHermes }
})

const submit = async () => {
  const { callTool } = await import('@/lib/mcp-tools')
  return callTool('mc_submit_plan', { request_id: 'req-1', plan: 'the plan' }, 'hermes')
}

describe('mc_submit_plan — concurrent reassignment (shared handler, HTTP path)', () => {
  it('re-asserts assigned_to = hermes on the UPDATE, not just on the pre-read', async () => {
    await submit()
    expect(
      filters,
      'UPDATE must be guarded by assigned_to = hermes',
    ).toContainEqual({ op: 'eq', col: 'assigned_to', val: 'hermes' })
  })

  it('loses the write when the request is reassigned between the read and the update', async () => {
    // Pre-read is submitted+hermes, so validatePlanPrecondition passes...
    state.read = { ...submittedToHermes }
    // ...but by write time the request belongs to another worker.
    state.atWrite = { ...submittedToHermes, assigned_to: 'claude' }

    await expect(submit()).rejects.toThrow(/re-fetch and retry/)
    expect(landed, 'a plan written for hermes must never land on a reassigned request').toBe(false)
  })

  it('loses the write when the request is unassigned between the read and the update', async () => {
    state.atWrite = { ...submittedToHermes, assigned_to: null }
    await expect(submit()).rejects.toThrow(/re-fetch and retry/)
    expect(landed).toBe(false)
  })

  it('still loses when the status moves instead, so the existing guards survive the fix', async () => {
    state.atWrite = { ...submittedToHermes, status: 'queued' }
    await expect(submit()).rejects.toThrow(/re-fetch and retry/)
    expect(landed).toBe(false)

    filters = []
    landed = false
    state.atWrite = { ...submittedToHermes, plan: 'already here' }
    await expect(submit()).rejects.toThrow(/re-fetch and retry/)
    expect(landed).toBe(false)
  })

  it('still succeeds, with unchanged plan semantics, when assignment holds', async () => {
    const out = await submit()
    expect(landed).toBe(true)
    expect(JSON.parse(out)).toEqual({
      request_id: 'req-1',
      phase: 'planned',
      plan_submitted_at: '2026-08-21T00:00:00Z',
    })
    expect(payload).toEqual({
      plan: 'the plan',
      phase: 'planned',
      plan_submitted_at: expect.any(String),
      plan_by: 'hermes',
      updated_at: expect.any(String),
    })
  })

  it('treats assignment as a GUARD, never as something the plan write sets', async () => {
    await submit()
    // Chief scope holds only while mc_submit_plan cannot touch ownership. The fix adds a
    // filter; it must not add a column to the payload.
    expect(payload, "mc_submit_plan must not write 'assigned_to'").not.toHaveProperty('assigned_to')
    expect(payload).not.toHaveProperty('status')
  })
})

// The stdio server carries its own copy of mc_submit_plan (it is the only request tool it
// implements), so the guard has to be ported, not inherited. Source-level because importing
// mcp-server.mjs starts a live stdio server.
describe('mc_submit_plan — stdio parity', () => {
  const handlerOf = (src: string, marker: string) => {
    const start = src.indexOf(marker)
    expect(start, `handler not found (${marker}) -- did the tool get renamed?`).toBeGreaterThan(-1)
    let depth = 0
    let i = src.indexOf('{', start)
    const from = i
    for (; i < src.length; i++) {
      if (src[i] === '{') depth++
      else if (src[i] === '}' && --depth === 0) break
    }
    return src.slice(from, i + 1)
  }

  const stdioHandler = () =>
    handlerOf(readFileSync(join(process.cwd(), 'mcp-server.mjs'), 'utf8'), "if (name === 'mc_submit_plan')")
  const sharedHandler = () =>
    handlerOf(readFileSync(join(process.cwd(), 'lib', 'mcp-tools.ts'), 'utf8'), "if (name === 'mc_submit_plan')")

  it('the stdio UPDATE carries the same three guards as the shared handler', () => {
    const stdio = stdioHandler()
    for (const guard of [".eq('status', 'submitted')", ".eq('assigned_to', 'hermes')", ".is('plan', null)"]) {
      expect(stdio.includes(guard), `mcp-server.mjs mc_submit_plan is missing ${guard}`).toBe(true)
    }
  })

  it('neither copy writes assignment into the update payload', () => {
    for (const [label, handler] of [['stdio', stdioHandler()], ['shared', sharedHandler()]] as const) {
      const update = handler.slice(handler.indexOf('.update({'), handler.indexOf('.eq('))
      expect(update.includes('assigned_to'), `${label} handler must not set assigned_to`).toBe(false)
      expect(update.includes('status'), `${label} handler must not set status`).toBe(false)
    }
  })

  it('the guard set is identical across both copies, so parity cannot drift silently', () => {
    const guardsIn = (handler: string) =>
      (handler.match(/\.(?:eq|is)\('[a-z_]+', (?:'[a-z_]+'|null)\)/g) ?? []).sort()
    expect(guardsIn(stdioHandler())).toEqual(guardsIn(sharedHandler()))
  })
})
