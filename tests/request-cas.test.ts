import { describe, it, expect } from 'vitest'
import { rereadForWrite } from '../scripts/lib/request-cas.mjs'

const ROW = { id: 'r1', attempt_id: 'a1' }
type Sb = Parameters<typeof rereadForWrite>[0]
const fakeSb = (result: { data?: Record<string, unknown> | null; error?: Error }) => ({
  from: () => ({ select: () => ({ eq: () => ({ maybeSingle: async () => ({ data: null, error: null, ...result }) }) }) }),
}) as unknown as Sb

describe('rereadForWrite', () => {
  it('returns the fresh token untouched when the row is still ours and allowed', async () => {
    const updated_at = '2026-11-05T10:00:00.123456+00:00'
    const r = await rereadForWrite(fakeSb({ data: { status: 'claimed', phase: 'building', attempt_id: 'a1', updated_at } }), ROW, ['claimed'])
    expect(r).toMatchObject({ ok: true, fresh: { updated_at } })
  })

  it('refuses on attempt mismatch, disallowed status, wrong phase, or missing row', async () => {
    const base = { status: 'claimed', phase: 'building', attempt_id: 'a1', updated_at: 't' }
    expect(await rereadForWrite(fakeSb({ data: { ...base, attempt_id: 'a2' } }), ROW, ['claimed'])).toMatchObject({ ok: false, reason: 'moved-on' })
    expect(await rereadForWrite(fakeSb({ data: { ...base, status: 'cancelled' } }), ROW, ['claimed'])).toMatchObject({ ok: false, reason: 'moved-on' })
    expect(await rereadForWrite(fakeSb({ data: { ...base, status: 'in_progress', phase: 'review' } }), ROW, ['in_progress'], { phase: 'pushing' })).toMatchObject({ ok: false, reason: 'moved-on' })
    expect(await rereadForWrite(fakeSb({ data: null }), ROW, ['claimed'])).toMatchObject({ ok: false, reason: 'gone' })
  })

  it('reports a read failure as a retryable error, not as moved-on', async () => {
    const err = new Error('fetch failed')
    expect(await rereadForWrite(fakeSb({ error: err }), ROW, ['claimed'])).toEqual({ ok: false, reason: 'error', error: err })
  })
})
