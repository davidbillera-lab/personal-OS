import { afterEach, describe, expect, it, vi } from 'vitest'

const { getUser } = vi.hoisted(() => ({ getUser: vi.fn() }))

vi.mock('@/lib/supabase', () => ({
  createServerSupabaseClient: async () => ({ auth: { getUser } }),
}))

import { requireOwner } from '@/lib/owner'

describe('requireOwner', () => {
  const saved = process.env.MC_OWNER_USER_ID
  afterEach(() => {
    if (saved === undefined) delete process.env.MC_OWNER_USER_ID
    else process.env.MC_OWNER_USER_ID = saved
    getUser.mockReset()
  })

  it('throws when the owner variable is unset', async () => {
    delete process.env.MC_OWNER_USER_ID
    getUser.mockResolvedValue({ data: { user: { id: 'u1' } }, error: null })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('throws when the owner variable is empty', async () => {
    process.env.MC_OWNER_USER_ID = ''
    getUser.mockResolvedValue({ data: { user: { id: '' } }, error: null })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('throws on mismatch, without echoing either id', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: { id: 'other-2' } }, error: null })
    const err = await requireOwner().catch(e => e as Error)
    expect(err.message).toBe('Not authorized')
  })

  it('throws when there is no user', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: null }, error: null })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('throws when getUser errors', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: { message: 'boom' } })
    await expect(requireOwner()).rejects.toThrow('Not authorized')
  })

  it('returns the userId on match', async () => {
    process.env.MC_OWNER_USER_ID = 'owner-1'
    getUser.mockResolvedValue({ data: { user: { id: 'owner-1' } }, error: null })
    await expect(requireOwner()).resolves.toEqual({ actor: 'owner', userId: 'owner-1' })
  })
})
