import { describe, it, expect } from 'vitest'
import { buildProjectDigest, type DigestProject } from '@/lib/alerts/digest'

const DAY = 24 * 60 * 60 * 1000
const NOW = new Date('2026-07-16T12:00:00Z')
const daysAgo = (d: number) => new Date(NOW.getTime() - d * DAY).toISOString()

const base = (over: Partial<DigestProject> = {}): DigestProject => ({
  name: 'Proj',
  tier: 2,
  stage: 'build',
  status: 'ok',
  kill_criteria_status: 'pass',
  blockers: null,
  last_update: daysAgo(1),
  next_action: null,
  ...over,
})

describe('buildProjectDigest', () => {
  it('returns null on all-clear input', () => {
    expect(buildProjectDigest([base(), base({ name: 'B' })], NOW)).toBeNull()
  })

  it('lists kill_criteria_status "fail" under KILL RISK', () => {
    const msg = buildProjectDigest([base({ name: 'Alpha', kill_criteria_status: 'fail', status: 'revenue stalled' })], NOW)!
    expect(msg).toContain('🔴 KILL RISK')
    expect(msg).toContain('• [T2] Alpha — revenue stalled')
  })

  it('lists non-empty blockers under BLOCKED', () => {
    const msg = buildProjectDigest([base({ name: 'Beta', blockers: 'waiting on API key' })], NOW)!
    expect(msg).toContain('⛔ BLOCKED')
    expect(msg).toContain('• [T2] Beta — waiting on API key')
  })

  it('lists projects older than 14 days with a next_action under STALE', () => {
    const msg = buildProjectDigest([base({ name: 'Gamma', last_update: daysAgo(20), next_action: 'ship beta' })], NOW)!
    expect(msg).toContain('🕰 STALE >14 DAYS')
    expect(msg).toContain('• [T2] Gamma — Next: ship beta')
  })

  it('treats exactly 14 days as NOT stale (strictly older)', () => {
    const msg = buildProjectDigest([base({ last_update: daysAgo(14), next_action: 'do thing' })], NOW)
    expect(msg).toBeNull()
  })

  it('excludes stage="kill" from every bucket', () => {
    const msg = buildProjectDigest([
      base({ name: 'Dead', stage: 'kill', kill_criteria_status: 'fail', blockers: 'x', last_update: daysAgo(30), next_action: 'y' }),
    ], NOW)
    expect(msg).toBeNull()
  })

  it('treats whitespace-only blockers and next_action as empty', () => {
    const msg = buildProjectDigest([
      base({ name: 'WS', blockers: '   ', last_update: daysAgo(30), next_action: '  \n ' }),
    ], NOW)
    expect(msg).toBeNull()
  })

  it('does not treat an invalid last_update as stale', () => {
    const msg = buildProjectDigest([base({ name: 'Bad', last_update: 'not-a-date', next_action: 'do thing' })], NOW)
    expect(msg).toBeNull()
  })

  it('lets a project appear in multiple buckets', () => {
    const msg = buildProjectDigest([
      base({ name: 'Multi', kill_criteria_status: 'fail', blockers: 'stuck', last_update: daysAgo(30), next_action: 'unstick' }),
    ], NOW)!
    expect(msg).toContain('🔴 KILL RISK')
    expect(msg).toContain('⛔ BLOCKED')
    expect(msg).toContain('🕰 STALE >14 DAYS')
    expect((msg.match(/Multi/g) ?? []).length).toBe(3)
  })

  it('sorts each bucket by ascending tier then name', () => {
    const msg = buildProjectDigest([
      base({ name: 'Zed', tier: 1, kill_criteria_status: 'fail' }),
      base({ name: 'Apple', tier: 2, kill_criteria_status: 'fail' }),
      base({ name: 'Beta', tier: 1, kill_criteria_status: 'fail' }),
    ], NOW)!
    const order = ['Beta', 'Zed', 'Apple'].map((n) => msg.indexOf(n))
    expect(order[0]).toBeLessThan(order[1])
    expect(order[1]).toBeLessThan(order[2])
  })

  it('collapses internal line breaks into one bullet line', () => {
    const msg = buildProjectDigest([base({ name: 'LB', blockers: 'line one\nline two' })], NOW)!
    expect(msg).toContain('• [T2] LB — line one line two')
  })
})
