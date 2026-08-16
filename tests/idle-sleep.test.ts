// The rig may only sleep from a positively-confirmed idle state. Every unknown, every row
// that still owes someone something, and every in-flight build keeps it awake.
import { describe, it, expect } from 'vitest'
import { isOutstanding, workSetEmpty, shouldSleep } from '../scripts/lib/idle-sleep.mjs'

describe('isOutstanding', () => {
  it('keeps the rig awake for work waiting or running', () => {
    for (const status of ['queued', 'claimed', 'in_progress']) {
      expect(isOutstanding({ status }), status).toBe(true)
    }
  })

  it('THE SAFETY RULE: an awaiting_approval row keeps it awake', () => {
    // The operator approves later and the DISPATCHER does the gated push. Sleeping here
    // would strand a finished build the same way the assigned_to filter did.
    expect(isOutstanding({ status: 'awaiting_approval' })).toBe(true)
  })

  it('a submitted row WITH a Hermes plan is ours to build', () => {
    expect(isOutstanding({ status: 'submitted', phase: 'planned', plan: 'spec' })).toBe(true)
  })

  it('a submitted row with NO plan is waiting on Hermes, not us — sleep through it', () => {
    // 26d1849b sat in exactly this state for two days. Staying awake for it is the old
    // always-on behaviour that caused the nagging.
    expect(isOutstanding({ status: 'submitted', phase: null, plan: null })).toBe(false)
    expect(isOutstanding({ status: 'submitted', phase: 'planned', plan: null })).toBe(false)
  })

  it('ignores finished and parked rows', () => {
    for (const status of ['completed', 'cancelled', 'rejected', 'failed', 'blocked']) {
      expect(isOutstanding({ status }), status).toBe(false)
    }
  })

  it('handles junk without throwing', () => {
    for (const r of [null, undefined, {}, { status: 7 }, 'nope']) {
      expect(isOutstanding(r as any)).toBe(false)
    }
  })
})

describe('workSetEmpty', () => {
  it('is true when nothing outstanding remains', () => {
    expect(workSetEmpty([{ status: 'completed' }, { status: 'submitted', phase: null, plan: null }])).toBe(true)
  })

  it('is false if even one row is outstanding', () => {
    expect(workSetEmpty([{ status: 'completed' }, { status: 'awaiting_approval' }])).toBe(false)
  })

  it('is true for an empty queue', () => {
    expect(workSetEmpty([])).toBe(true)
  })

  it('stays awake when the row set is unknown (fail safe)', () => {
    expect(workSetEmpty(null as any)).toBe(false)
    expect(workSetEmpty(undefined as any)).toBe(false)
  })
})

describe('shouldSleep', () => {
  const base = { idleSinceMs: 1_000, now: 1_000 + 600_000, thresholdMs: 300_000, buildInFlight: false }

  it('sleeps once the idle window has elapsed', () => {
    expect(shouldSleep(base)).toBe(true)
  })

  it('stays awake before the window elapses', () => {
    expect(shouldSleep({ ...base, now: 1_000 + 60_000 })).toBe(false)
  })

  it('is OFF unless a threshold is configured — preserves the old always-on behaviour', () => {
    expect(shouldSleep({ ...base, thresholdMs: 0 })).toBe(false)
    expect(shouldSleep({ ...base, thresholdMs: undefined as any })).toBe(false)
  })

  it('never sleeps mid-build, however long the queue has looked idle', () => {
    expect(shouldSleep({ ...base, buildInFlight: true })).toBe(false)
  })

  it('never sleeps before idle has actually been observed', () => {
    expect(shouldSleep({ ...base, idleSinceMs: null })).toBe(false)
  })

  it('sits exactly on the threshold and sleeps (>=)', () => {
    expect(shouldSleep({ ...base, now: 1_000 + 300_000 })).toBe(true)
  })
})
