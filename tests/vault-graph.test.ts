import { describe, it, expect } from 'vitest'
import {
  classifyType, ageBrightness, nodeRadius, hashPhase, isFresh, STAR_TYPES,
} from '@/lib/vault-graph'

const DAY = 24 * 60 * 60 * 1000
const NOW = Date.parse('2026-07-04T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW - d * DAY).toISOString()

describe('classifyType', () => {
  it('classifies exhaust types as stars', () => {
    for (const t of ['git_push', 'agent_session', 'file_snapshot', 'mcp_event'] as const) {
      expect(classifyType(t)).toBe('star')
    }
  })
  it('classifies significant types as planets', () => {
    for (const t of ['knowledge', 'build_spec', 'decision_log', 'brain_dump_mirror',
                     'credential', 'skill', 'agent', 'personal', 'ab_conversation'] as const) {
      expect(classifyType(t)).toBe('planet')
    }
  })
  it('STAR_TYPES matches classifyType', () => {
    for (const t of STAR_TYPES) expect(classifyType(t)).toBe('star')
  })
})

describe('ageBrightness', () => {
  it('fresh planet is full brightness', () => {
    expect(ageBrightness(daysAgo(0), NOW, 'planet')).toBe(1)
    expect(ageBrightness(daysAgo(3), NOW, 'planet')).toBe(1)
  })
  it('old planet clamps at the 0.35 floor', () => {
    expect(ageBrightness(daysAgo(90), NOW, 'planet')).toBeCloseTo(0.35, 5)
    expect(ageBrightness(daysAgo(400), NOW, 'planet')).toBeCloseTo(0.35, 5)
  })
  it('planet brightness decreases monotonically between 3 and 90 days', () => {
    const b10 = ageBrightness(daysAgo(10), NOW, 'planet')
    const b45 = ageBrightness(daysAgo(45), NOW, 'planet')
    const b89 = ageBrightness(daysAgo(89), NOW, 'planet')
    expect(b10).toBeGreaterThan(b45)
    expect(b45).toBeGreaterThan(b89)
    expect(b89).toBeGreaterThan(0.35)
  })
  it('stars run dimmer: 0.75 fresh, 0.20 floor', () => {
    expect(ageBrightness(daysAgo(0), NOW, 'star')).toBeCloseTo(0.75, 5)
    expect(ageBrightness(daysAgo(120), NOW, 'star')).toBeCloseTo(0.2, 5)
  })
  it('handles invalid dates without NaN (falls back to floor)', () => {
    expect(ageBrightness('not-a-date', NOW, 'planet')).toBeCloseTo(0.35, 5)
  })
})

describe('nodeRadius', () => {
  it('planets stay in the 5–9px band', () => {
    expect(nodeRadius('planet', 0)).toBe(5)
    expect(nodeRadius('planet', 100)).toBeLessThanOrEqual(9)
    expect(nodeRadius('planet', 4)).toBeGreaterThan(nodeRadius('planet', 1))
  })
  it('stars stay in the 1.5–2.5px band', () => {
    expect(nodeRadius('star', 0)).toBe(1.5)
    expect(nodeRadius('star', 100)).toBeLessThanOrEqual(2.5)
  })
  it('hubs scale with item count, capped at 9', () => {
    expect(nodeRadius('hub', 1)).toBeGreaterThanOrEqual(4)
    expect(nodeRadius('hub', 500)).toBeLessThanOrEqual(9)
  })
})

describe('hashPhase', () => {
  it('is deterministic and in [0, 2π)', () => {
    expect(hashPhase('abc')).toBe(hashPhase('abc'))
    expect(hashPhase('abc')).not.toBe(hashPhase('abd'))
    expect(hashPhase('anything')).toBeGreaterThanOrEqual(0)
    expect(hashPhase('anything')).toBeLessThan(Math.PI * 2)
  })
})

describe('isFresh', () => {
  it('true within 7 days, false after', () => {
    expect(isFresh(daysAgo(2), NOW)).toBe(true)
    expect(isFresh(daysAgo(8), NOW)).toBe(false)
  })
})
