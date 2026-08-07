import { describe, it, expect } from 'vitest'
import { buildStuckJobsDigest, type StuckRequest } from '../lib/alerts/stuck-jobs'

const NOW = new Date('2026-08-06T22:00:00Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()
const row = (o: Partial<StuckRequest>): StuckRequest => ({
  id: '20d5c8af-46ff-4439-b893-73edf1847598', title: 'Homeroom Tutor', status: 'failed',
  phase: null, blocker: null, updated_at: ago(60_000), ...o,
})

describe('buildStuckJobsDigest', () => {
  it('returns null when nothing is actionable (all-clear)', () => {
    expect(buildStuckJobsDigest([], NOW)).toBeNull()
    // fresh planned + completed rows are not actionable
    expect(buildStuckJobsDigest([
      row({ status: 'submitted', phase: 'planned', updated_at: ago(60_000) }),
      row({ status: 'completed' }),
    ], NOW)).toBeNull()
  })

  it('surfaces a failed build under the FAILED bucket with instruction', () => {
    const msg = buildStuckJobsDigest([row({ status: 'failed', blocker: 'build failed: timed out after 600000ms' })], NOW)
    expect(msg).toContain('🛑 FAILED')
    expect(msg).toContain('Homeroom Tutor')
    expect(msg).toContain('check MC and build the pending jobs')
  })

  it('buckets held, awaiting, and stale-planned separately', () => {
    const msg = buildStuckJobsDigest([
      row({ id: 'aaaaaaaa-0000-0000-0000-000000000001', status: 'blocked', blocker: 'secrets hold' }),
      row({ id: 'bbbbbbbb-0000-0000-0000-000000000002', status: 'awaiting_approval' }),
      row({ id: 'cccccccc-0000-0000-0000-000000000003', status: 'submitted', phase: 'planned', updated_at: ago(3 * 60 * 60 * 1000) }),
    ], NOW)!
    expect(msg).toContain('⚠️ HELD')
    expect(msg).toContain('🔔 AWAITING YOUR APPROVAL')
    expect(msg).toContain('🕒 NOT PICKED UP')
  })

  it('treats a recently-planned row as not-yet-stale (no false alarm)', () => {
    const msg = buildStuckJobsDigest([
      row({ status: 'submitted', phase: 'planned', updated_at: ago(30 * 60 * 1000) }), // 30 min < 2h
    ], NOW)
    expect(msg).toBeNull()
  })
})
