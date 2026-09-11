import { describe, expect, it, vi } from 'vitest'
import { createKeyLookup, type KeyRow } from '../lib/mcp-key-cache'

describe('mcp_api_keys lookup cache', () => {
  it('rejects a key revoked in the datastore once the cache window passes', async () => {
    const row: KeyRow = { scope: 'full', actor: 'full', revoked_at: null, expires_at: null }
    const fetchRow = vi.fn(async () => ({ ...row }))
    let now = 1_000
    const lookup = createKeyLookup(fetchRow, { ttlMs: 60_000, now: () => now })

    expect(await lookup('h')).toEqual({ status: 'active', scope: 'full', actor: 'full' })
    row.revoked_at = new Date().toISOString()
    now += 5_000
    expect((await lookup('h')).status).toBe('active') // still inside the cache window
    now += 60_000
    expect(await lookup('h')).toEqual({ status: 'revoked' })
    expect(fetchRow).toHaveBeenCalledTimes(2)
  })

  it('treats expired rows as revoked and fails closed without caching fetch errors', async () => {
    const fetchRow = vi.fn()
      .mockRejectedValueOnce(new Error('db down'))
      .mockResolvedValueOnce({ scope: 'read', actor: 'x', revoked_at: null, expires_at: '1970-01-01T00:00:01Z' })
    const lookup = createKeyLookup(fetchRow, { now: () => 5_000 })

    expect(await lookup('h')).toEqual({ status: 'error' })
    expect(await lookup('h')).toEqual({ status: 'revoked' })
  })
})
