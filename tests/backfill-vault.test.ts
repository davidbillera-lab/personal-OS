import { beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'

type Row = Record<string, unknown>
const { admin, capture, state } = vi.hoisted(() => {
  const state: { tables: Record<string, Row[]>; readError: string | null; failIds: Set<string> } = {
    tables: {}, readError: null, failIds: new Set(),
  }
  // Minimal PostgREST fake: chainable filters, .range() slices, awaiting yields {data,error}.
  const builder = (table: string) => {
    let range: [number, number] | null = null
    const b: Record<string, unknown> = {}
    for (const m of ['select', 'eq', 'not', 'order']) b[m] = () => b
    b.range = (from: number, to: number) => { range = [from, to]; return b }
    const rows = () => {
      const all = state.tables[table] ?? []
      return range ? all.slice(range[0], range[1] + 1) : all
    }
    b.single = async () => ({ data: rows()[0] ?? null, error: null })
    b.maybeSingle = async () => ({ data: null, error: null })
    b.then = (res: (v: unknown) => unknown) =>
      Promise.resolve(
        state.readError && table === 'agent_handoffs'
          ? { data: null, error: { message: state.readError } }
          : { data: rows(), error: null }
      ).then(res)
    return b
  }
  const admin = vi.fn(() => ({ from: (t: string) => builder(t) }))
  const capture = vi.fn(async (p: { source_id: string }) => !state.failIds.has(p.source_id))
  return { admin, capture, state }
})

vi.mock('@/lib/supabase', () => ({ createAdminSupabaseClient: admin }))
vi.mock('@/lib/vault', () => ({ captureToVault: capture }))
vi.mock('@/lib/api-auth', () => ({ requireBearer: async () => null }))

const mk = (n: number, prefix: string) => Array.from({ length: n }, (_, i) => ({ id: `${prefix}${i}`, agent_name: 'a' }))
const run = async (name: string) => {
  const { POST } = await import(`../app/api/admin/${name}/route`)
  const res = await POST(new Request('http://localhost/x', { method: 'POST' }) as never)
  return { status: res.status, body: await res.json() }
}

beforeAll(async () => {
  await import('../app/api/admin/backfill-vault/route')
  await import('../app/api/admin/backfill-ab-vault/route')
}, 60000)

beforeEach(() => {
  vi.clearAllMocks()
  state.tables = {}
  state.readError = null
  state.failIds = new Set()
})

describe('backfill-vault', () => {
  it('processes every row across 2.5 pages', async () => {
    state.tables = { agent_handoffs: mk(2500, 'h') }
    const { status, body } = await run('backfill-vault')
    expect(status).toBe(200)
    expect(body.results.agent_handoffs.seeded).toBe(2500)
    expect(capture).toHaveBeenCalledTimes(2500)
  })

  it('returns non-200 on a read error and writes nothing', async () => {
    state.tables = { agent_handoffs: mk(3, 'h') }
    state.readError = 'boom'
    const { status, body } = await run('backfill-vault')
    expect(status).toBe(500)
    expect(body.ok).toBe(false)
    expect(body.error).toContain('boom')
    expect(capture).not.toHaveBeenCalled()
  })

  it('reports partial write failures in the counts', async () => {
    state.tables = { agent_handoffs: mk(5, 'h') }
    state.failIds = new Set(['h1', 'h3'])
    const { status, body } = await run('backfill-vault')
    expect(status).toBe(207)
    expect(body.ok).toBe(false)
    expect(body.totalSeeded).toBe(3)
    expect(body.totalFailed).toBe(2)
    expect(body.errors).toHaveLength(2)
  })
})

describe('backfill-ab-vault', () => {
  const chats = (n: number) =>
    Array.from({ length: n }, (_, i) => ({ id: `c${i}`, brain_dump_id: 'd', content: 'x', run_number: 1, created_at: '' }))

  it('processes every chat across 2.5 pages', async () => {
    state.tables = { ab_chats: chats(2500), brain_dumps: [{ raw_text: 't', classified_type: null, project_id: null }] }
    const { status, body } = await run('backfill-ab-vault')
    expect(status).toBe(200)
    expect(body.captured).toBe(2500)
    expect(body.processed).toBe(2500)
  })

  it('reports partial write failures', async () => {
    state.tables = { ab_chats: chats(4), brain_dumps: [{ raw_text: 't', classified_type: null, project_id: null }] }
    state.failIds = new Set(['c2'])
    const { status, body } = await run('backfill-ab-vault')
    expect(status).toBe(207)
    expect(body.captured).toBe(3)
    expect(body.failed).toBe(1)
  })
})
