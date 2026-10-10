import { afterEach, beforeAll, beforeEach, describe, it, expect, vi } from 'vitest'

const { admin, getUser, state } = vi.hoisted(() => {
  const state: { user: object | null; row: object | null; dbError: boolean } = { user: null, row: null, dbError: false }
  const admin = vi.fn(() => ({
    from: () => ({
      select: () => ({
        eq: () => ({
          maybeSingle: async () =>
            state.dbError ? { data: null, error: { message: 'db down' } } : { data: state.row, error: null },
        }),
      }),
    }),
  }))
  const getUser = vi.fn(async () => ({ data: { user: state.user } }))
  return { admin, getUser, state }
})

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: admin,
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}))
vi.mock('@/lib/models/router', () => ({ routeTask: vi.fn() }))
vi.mock('@/lib/classify', () => ({ classifyBrainDump: vi.fn() }))
vi.mock('@/lib/vault', () => ({ captureToVault: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))

// The first dynamic import of a route cold-transforms next/server and the route graph: ~0.9s alone,
// 2-5s under full-suite load, which blows the 5s default on whichever test imports first.
// Warm the module cache once, with a generous hook timeout, so test timing never depends on load.
beforeAll(async () => {
  await Promise.all([import('../app/api/route-task/route'), import('../lib/api-auth')])
}, 60_000)

beforeEach(() => {
  vi.clearAllMocks()
  Object.assign(state, { user: null, row: null, dbError: false })
})

const row = (scope: string, revoked_at: string | null = null) => ({ scope, actor: 'test', revoked_at, expires_at: null })
// api-auth caches lookups per key hash for 60s, so every test presents a fresh key.
let n = 0
const key = () => `test-key-${++n}`
const req = (token?: string) =>
  new Request('http://localhost/api/x', {
    method: 'POST',
    body: '{}',
    headers: token ? { authorization: `Bearer ${token}` } : {},
  })
const post = async (name: string, token?: string) => {
  const { POST } = await import(`../app/api/${name}/route`)
  return POST(req(token) as never)
}

const routes = ['route-task', 'classify', 'advisory-board', 'kill-criteria']
const keyRoutes = ['route-task', 'classify', 'kill-criteria']

describe('API routes require a session (or a full-scope key where allowed)', () => {
  it.each(routes)('%s POST returns 401 without a user or key', async (name) => {
    const res = await post(name)
    expect(res.status).toBe(401)
    expect(admin).not.toHaveBeenCalled()
  })

  it.each(keyRoutes)('%s POST rejects a revoked key even with a session', async (name) => {
    state.user = { id: 'u1' }
    state.row = row('full', '2026-01-01T00:00:00Z')
    expect((await post(name, key())).status).toBe(401)
  })

  it('advisory-board stays session-only: a full-scope key alone is 401', async () => {
    state.row = row('full')
    expect((await post('advisory-board', key())).status).toBe(401)
    expect(admin).not.toHaveBeenCalled()
  })
})

describe('requireUserOrBearer', () => {
  const gate = async (token?: string) => {
    const { requireUserOrBearer } = await import('../lib/api-auth')
    return requireUserOrBearer(req(token))
  }

  it('passes on a session alone', async () => {
    state.user = { id: 'u1' }
    expect(await gate()).toBeNull()
    expect(admin).not.toHaveBeenCalled()
  })

  it('passes on a full-scope key alone', async () => {
    state.row = row('full')
    expect(await gate(key())).toBeNull()
    expect(getUser).not.toHaveBeenCalled()
  })

  it('rejects a read-scope key with 403', async () => {
    state.user = { id: 'u1' }
    state.row = row('read')
    expect((await gate(key()))?.status).toBe(403)
  })

  it('rejects a revoked key with 401 even when a session exists', async () => {
    state.user = { id: 'u1' }
    state.row = row('full', '2026-01-01T00:00:00Z')
    expect((await gate(key()))?.status).toBe(401)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('fails closed with 503 when the key lookup errors, even when a session exists', async () => {
    state.user = { id: 'u1' }
    state.dbError = true
    expect((await gate(key()))?.status).toBe(503)
    expect(getUser).not.toHaveBeenCalled()
  })

  it('returns 401 with neither a session nor a key', async () => {
    expect((await gate())?.status).toBe(401)
  })

  it.each(['Basic x', 'Bearer', 'Bearer a b'])('treats a malformed header (%s) as no key', async (authorization) => {
    const { requireUserOrBearer } = await import('../lib/api-auth')
    const malformed = () => new Request('http://localhost/api/x', { method: 'POST', headers: { authorization } })
    expect((await requireUserOrBearer(malformed()))?.status).toBe(401)
    state.user = { id: 'u1' }
    expect(await requireUserOrBearer(malformed())).toBeNull()
    expect(admin).not.toHaveBeenCalled()
  })
})

describe('requireBearer env fallback', () => {
  afterEach(() => vi.unstubAllEnvs())

  it('passes an unknown key that matches the env key', async () => {
    const token = key()
    vi.stubEnv('MCP_API_KEY', token)
    const { requireBearer } = await import('../lib/api-auth')
    expect(await requireBearer(req(token))).toBeNull()
  })

  it('rejects the env key once its row is revoked', async () => {
    const token = key()
    vi.stubEnv('MCP_API_KEY', token)
    state.row = row('full', '2026-01-01T00:00:00Z')
    const { requireBearer } = await import('../lib/api-auth')
    expect((await requireBearer(req(token)))?.status).toBe(401)
  })
})
