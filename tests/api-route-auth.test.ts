import { describe, it, expect, vi } from 'vitest'

const { admin } = vi.hoisted(() => ({ admin: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  createAdminSupabaseClient: admin,
  createServerSupabaseClient: async () => ({
    auth: { getUser: async () => ({ data: { user: null } }) },
  }),
}))
vi.mock('@/lib/models/router', () => ({ routeTask: vi.fn() }))
vi.mock('@/lib/classify', () => ({ classifyBrainDump: vi.fn() }))
vi.mock('@/lib/vault', () => ({ captureToVault: vi.fn() }))
vi.mock('@anthropic-ai/sdk', () => ({ default: class {} }))

const routes = ['route-task', 'classify', 'advisory-board', 'kill-criteria']

describe('API routes require a session', () => {
  it.each(routes)('%s POST returns 401 without a user', async (name) => {
    const { POST } = await import(`../app/api/${name}/route`)
    const res = await POST(new Request('http://localhost/api/x', { method: 'POST', body: '{}' }) as never)
    expect(res.status).toBe(401)
    expect(admin).not.toHaveBeenCalled()
  })
})
