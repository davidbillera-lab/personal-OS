import { describe, expect, it, vi } from 'vitest'
import { createCachedHealthChecker } from '../scripts/lib/claude-executor-adapter.mjs'

describe('Docker executor health checks', () => {
  it('reuses a successful preflight during the cache window', () => {
    const probe = vi.fn(() => undefined)
    let now = 1_000
    const health = createCachedHealthChecker(probe, { ttlMs: 60_000, now: () => now })

    expect(health()).toEqual({ ok: true, reason: null })
    now += 5_000
    expect(health()).toEqual({ ok: true, reason: null })

    expect(probe).toHaveBeenCalledTimes(1)
  })

  it('throttles a failed preflight and retries after the cache window', () => {
    const probe = vi.fn()
      .mockImplementationOnce(() => { throw new Error('Docker is down') })
      .mockImplementationOnce(() => undefined)
    let now = 1_000
    const health = createCachedHealthChecker(probe, { ttlMs: 60_000, now: () => now })

    expect(health()).toEqual({ ok: false, reason: 'Docker is down' })
    now += 5_000
    expect(health()).toEqual({ ok: false, reason: 'Docker is down' })
    expect(probe).toHaveBeenCalledTimes(1)

    now += 60_000
    expect(health()).toEqual({ ok: true, reason: null })
    expect(probe).toHaveBeenCalledTimes(2)
  })
})
