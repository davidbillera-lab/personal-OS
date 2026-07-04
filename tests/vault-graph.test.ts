import { describe, it, expect } from 'vitest'
import {
  classifyType, ageBrightness, nodeRadius, hashPhase, isFresh, STAR_TYPES,
  buildGalaxy, UNTAGGED_HUB_ID,
} from '@/lib/vault-graph'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

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

function mkItem(over: Partial<VaultItemListItem>): VaultItemListItem {
  return {
    id: 'id-' + Math.random().toString(36).slice(2),
    type: 'knowledge', title: 'Item', content: '', encrypted: false,
    tags: [], project_id: null, source_table: null, source_id: null,
    is_mcp_accessible: true, metadata: {}, capture_source: 'test',
    created_at: daysAgo(1), updated_at: daysAgo(1),
    ...over,
  } as VaultItemListItem
}

describe('buildGalaxy', () => {
  it('creates one hub per tag and links items to their tags', () => {
    const a = mkItem({ id: 'a', tags: ['vzt'] })
    const b = mkItem({ id: 'b', tags: ['vzt', 'auth'] })
    const g = buildGalaxy([a, b], NOW)

    const hubIds = g.nodes.filter(n => n.cls === 'hub').map(n => n.id).sort()
    expect(hubIds).toEqual(['tag:auth', 'tag:vzt'])
    // linear linking: 3 item→tag links total, zero item→item links
    expect(g.links).toHaveLength(3)
    expect(g.links).toContainEqual({ source: 'a', target: 'tag:vzt' })
    expect(g.links).toContainEqual({ source: 'b', target: 'tag:vzt' })
    expect(g.links).toContainEqual({ source: 'b', target: 'tag:auth' })
  })

  it('routes untagged items to the untagged hub', () => {
    const a = mkItem({ id: 'a', tags: [] })
    const g = buildGalaxy([a], NOW)
    expect(g.nodes.some(n => n.id === UNTAGGED_HUB_ID)).toBe(true)
    expect(g.links).toContainEqual({ source: 'a', target: UNTAGGED_HUB_ID })
  })

  it('omits the untagged hub when every item has tags', () => {
    const g = buildGalaxy([mkItem({ id: 'a', tags: ['x'] })], NOW)
    expect(g.nodes.some(n => n.id === UNTAGGED_HUB_ID)).toBe(false)
  })

  it('sets class, degree, brightness, and freshness on item nodes', () => {
    const push = mkItem({ id: 'p', type: 'git_push', tags: ['repo'], updated_at: daysAgo(120) })
    const know = mkItem({ id: 'k', type: 'knowledge', tags: ['repo', 'x'], updated_at: daysAgo(1) })
    const g = buildGalaxy([push, know], NOW)
    const p = g.nodes.find(n => n.id === 'p')!
    const k = g.nodes.find(n => n.id === 'k')!
    expect(p.cls).toBe('star')
    expect(p.brightness).toBeCloseTo(0.2, 5)
    expect(p.fresh).toBe(false)
    expect(k.cls).toBe('planet')
    expect(k.brightness).toBe(1)
    expect(k.fresh).toBe(true)
    expect(k.degree).toBe(2)
    const hub = g.nodes.find(n => n.id === 'tag:repo')!
    expect(hub.degree).toBe(2) // two members
  })

  it('builds a neighbors map spanning hubs', () => {
    const a = mkItem({ id: 'a', tags: ['t'] })
    const b = mkItem({ id: 'b', tags: ['t'] })
    const g = buildGalaxy([a, b], NOW)
    expect(g.neighbors.get('tag:t')).toEqual(new Set(['a', 'b']))
    expect(g.neighbors.get('a')).toEqual(new Set(['tag:t']))
  })

  it('handles empty input', () => {
    const g = buildGalaxy([], NOW)
    expect(g.nodes).toHaveLength(0)
    expect(g.links).toHaveLength(0)
  })
})
