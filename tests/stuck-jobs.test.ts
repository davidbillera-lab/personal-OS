import { describe, it, expect } from 'vitest'
import {
  buildStuckJobsDigest,
  suppressAlreadySent,
  transitionKey,
  alertBucket,
  type StuckRequest,
} from '../lib/alerts/stuck-jobs'

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

  // Regression: request 26d1849b sat in submitted/phase=null for two days and never
  // alerted, because a 'submitted' row was only ever considered when phase==='planned'.
  // Nothing in the system auto-claims that state, so silence meant it waited forever.
  it('surfaces a submitted workflow that Hermes never planned (phase null)', () => {
    const msg = buildStuckJobsDigest([
      row({ status: 'submitted', phase: null, updated_at: ago(3 * 60 * 60 * 1000) }),
    ], NOW)!
    expect(msg).toContain('📝 NOT PLANNED')
    expect(msg).toContain('Homeroom Tutor')
  })

  it('does not alarm on a workflow submitted moments ago', () => {
    expect(buildStuckJobsDigest([
      row({ status: 'submitted', phase: null, updated_at: ago(5 * 60 * 1000) }),
    ], NOW)).toBeNull()
  })

  it('keeps never-planned and never-picked-up in separate buckets', () => {
    const msg = buildStuckJobsDigest([
      row({ id: 'dddddddd-0000-0000-0000-000000000004', status: 'submitted', phase: null, updated_at: ago(3 * 60 * 60 * 1000) }),
      row({ id: 'eeeeeeee-0000-0000-0000-000000000005', status: 'submitted', phase: 'planned', updated_at: ago(3 * 60 * 60 * 1000) }),
    ], NOW)!
    expect(msg).toContain('📝 NOT PLANNED')
    expect(msg).toContain('🕒 NOT PICKED UP')
  })
})

describe('alertBucket — never-planned workflows', () => {
  it('classifies a stale unplanned submission as stale_unplanned', () => {
    const r = row({ status: 'submitted', phase: null, updated_at: ago(3 * 60 * 60 * 1000) })
    expect(alertBucket(r, NOW)).toBe('stale_unplanned')
  })

  it('gives it its own dedup key, so it nudges once rather than twice daily forever', () => {
    const r = row({ status: 'submitted', phase: null, updated_at: ago(3 * 60 * 60 * 1000) })
    expect(transitionKey(r, NOW)).toBe(`${r.id}:stale_unplanned`)
  })

  it('is not actionable while still fresh', () => {
    expect(alertBucket(row({ status: 'submitted', phase: null, updated_at: ago(60_000) }), NOW)).toBeNull()
  })
})

describe('alert dedup', () => {
  const held = row({ status: 'blocked', blocker: 'auto-classifier: live-deploy — held for operator review' })

  it('suppresses a transition that was already announced', () => {
    const sent = new Set([transitionKey(held, NOW)])
    expect(suppressAlreadySent([held], sent, NOW)).toEqual([])
    // and therefore the sweep sends nothing at all
    expect(buildStuckJobsDigest(suppressAlreadySent([held], sent, NOW), NOW)).toBeNull()
  })

  it('re-alerts when the same request moves to a different state', () => {
    const sent = new Set([transitionKey(held, NOW)])
    const nowFailed = { ...held, status: 'failed' }
    expect(suppressAlreadySent([nowFailed], sent, NOW)).toEqual([nowFailed])
  })

  it('re-alerts when a held request is re-held for a different reason', () => {
    const sent = new Set([transitionKey(held, NOW)])
    const reheld = { ...held, blocker: 'auto-classifier: secrets — held for operator review' }
    expect(suppressAlreadySent([reheld], sent, NOW)).toEqual([reheld])
  })

  it('ignores cosmetic whitespace churn in the blocker text', () => {
    const spaced = { ...held, blocker: `  ${held.blocker!.replace(' ', '\n  ')}  ` }
    expect(transitionKey(spaced, NOW)).toBe(transitionKey(held, NOW))
  })

  it('sends everything when the ledger read failed (empty set = fail noisy)', () => {
    expect(suppressAlreadySent([held], new Set(), NOW)).toEqual([held])
  })

  it('drops non-actionable rows and gives them no key', () => {
    const fresh = row({ status: 'submitted', phase: 'planned', updated_at: ago(60_000) })
    expect(alertBucket(fresh, NOW)).toBeNull()
    expect(transitionKey(fresh, NOW)).toBe('')
    expect(suppressAlreadySent([fresh], new Set(), NOW)).toEqual([])
  })

  it('keys stale-planned on the request alone, so it nudges once', () => {
    const stale = row({ status: 'submitted', phase: 'planned', updated_at: ago(3 * 60 * 60 * 1000) })
    expect(alertBucket(stale, NOW)).toBe('stale_planned')
    // still stale six hours later -> same key -> suppressed
    const later = new Date(NOW.getTime() + 6 * 60 * 60 * 1000)
    expect(transitionKey(stale, later)).toBe(transitionKey(stale, NOW))
  })
})
