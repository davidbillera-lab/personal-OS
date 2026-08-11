// Hermes planning wakeup: a submitted request with no plan is announced once it has waited
// past the threshold, and never announced while it is fresh, already planned, or advanced.
import { describe, it, expect } from 'vitest'
import { needsPlanNudge, planNudgeKey, PLAN_NUDGE_AFTER_MS } from '../scripts/lib/plan-nudge.mjs'

const NOW = new Date('2026-08-11T12:00:00.000Z')
const ago = (ms: number) => new Date(NOW.getTime() - ms).toISOString()

// The shape 26d1849b was actually in: submitted, never planned, two days old.
const STALLED = { id: 'r1', status: 'submitted', phase: null, plan: null, updated_at: ago(2 * 24 * 60 * 60 * 1000) }

describe('needsPlanNudge', () => {
  it('announces a submitted request that has waited past the threshold', () => {
    expect(needsPlanNudge(STALLED, NOW)).toBe(true)
  })

  it('stays quiet on a freshly-filed request — Hermes may be planning it right now', () => {
    expect(needsPlanNudge({ ...STALLED, updated_at: ago(60 * 1000) }, NOW)).toBe(false)
  })

  it('stays quiet once a plan has been deposited', () => {
    expect(needsPlanNudge({ ...STALLED, phase: 'planned', plan: 'the spec' }, NOW)).toBe(false)
  })

  it('stays quiet when a plan exists even if phase was not advanced', () => {
    expect(needsPlanNudge({ ...STALLED, plan: 'the spec' }, NOW)).toBe(false)
  })

  it('ignores rows that have left submitted', () => {
    for (const status of ['queued', 'claimed', 'in_progress', 'completed', 'failed', 'blocked']) {
      expect(needsPlanNudge({ ...STALLED, status }, NOW)).toBe(false)
    }
  })

  it('does NOT depend on assigned_to — the same rewrite-mid-flight hazard that hid approved rows', () => {
    expect(needsPlanNudge({ ...STALLED, assigned_to: 'claude' }, NOW)).toBe(true)
    expect(needsPlanNudge({ ...STALLED, assigned_to: null }, NOW)).toBe(true)
  })

  it('falls back to created_at when updated_at is absent', () => {
    expect(needsPlanNudge({ id: 'r1', status: 'submitted', phase: null, plan: null, created_at: ago(3 * 60 * 60 * 1000) }, NOW)).toBe(true)
  })

  it('stays quiet rather than spamming on an unparseable timestamp', () => {
    expect(needsPlanNudge({ ...STALLED, updated_at: 'not-a-date' }, NOW)).toBe(false)
  })

  it('sits exactly on the threshold without firing (strictly greater than)', () => {
    expect(needsPlanNudge({ ...STALLED, updated_at: ago(PLAN_NUDGE_AFTER_MS) }, NOW)).toBe(false)
    expect(needsPlanNudge({ ...STALLED, updated_at: ago(PLAN_NUDGE_AFTER_MS + 1000) }, NOW)).toBe(true)
  })

  it('handles a missing row', () => {
    expect(needsPlanNudge(null, NOW)).toBe(false)
  })
})

describe('planNudgeKey', () => {
  it('is stable across sweeps so an unresolved stall is announced once, not every tick', () => {
    expect(planNudgeKey(STALLED)).toBe(planNudgeKey({ ...STALLED, updated_at: ago(99) }))
  })

  it('is distinct per request', () => {
    expect(planNudgeKey(STALLED)).not.toBe(planNudgeKey({ ...STALLED, id: 'r2' }))
  })
})
