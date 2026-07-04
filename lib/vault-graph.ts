// Pure graph-building logic for the Vault galaxy. No canvas, no React —
// everything here is unit-testable in isolation.
import type { VaultItemType } from '@/lib/types'

export type NodeClass = 'planet' | 'star' | 'hub'

// Auto-captured exhaust renders as tiny "distant stars"; everything else is a planet.
export const STAR_TYPES: VaultItemType[] = ['git_push', 'agent_session', 'file_snapshot', 'mcp_event']

export function classifyType(type: VaultItemType): 'planet' | 'star' {
  return STAR_TYPES.includes(type) ? 'star' : 'planet'
}

const DAY_MS = 24 * 60 * 60 * 1000
const FULL_UNTIL_DAYS = 3   // full brightness up to this age
const FLOOR_AT_DAYS = 90    // floor reached at this age
const PLANET_RANGE = { max: 1, floor: 0.35 }
const STAR_RANGE = { max: 0.75, floor: 0.2 }
const FRESH_DAYS = 7        // pulse window

// Smoothstep-eased decay from range.max (≤3 days) to range.floor (≥90 days).
export function ageBrightness(updatedAt: string, now: number, cls: 'planet' | 'star'): number {
  const range = cls === 'planet' ? PLANET_RANGE : STAR_RANGE
  const ts = Date.parse(updatedAt)
  if (Number.isNaN(ts)) return range.floor
  const days = (now - ts) / DAY_MS
  if (days <= FULL_UNTIL_DAYS) return range.max
  if (days >= FLOOR_AT_DAYS) return range.floor
  const t = (days - FULL_UNTIL_DAYS) / (FLOOR_AT_DAYS - FULL_UNTIL_DAYS)
  const eased = t * t * (3 - 2 * t) // smoothstep
  return range.max - eased * (range.max - range.floor)
}

export function isFresh(updatedAt: string, now: number): boolean {
  const ts = Date.parse(updatedAt)
  if (Number.isNaN(ts)) return false
  return (now - ts) / DAY_MS <= FRESH_DAYS
}

// Size bands: planets 5–9px by connectivity (never grape-sized), stars 1.5–2.5px,
// tag hubs 4–9px by member count.
export function nodeRadius(cls: NodeClass, degree: number): number {
  if (cls === 'planet') return 5 + Math.min(degree, 8) * 0.5
  if (cls === 'star') return 1.5 + Math.min(degree, 4) * 0.25
  return Math.min(4 + Math.sqrt(Math.max(degree, 0)), 9)
}

// Deterministic per-node phase offset in [0, 2π) so twinkle/sheen never sync up.
export function hashPhase(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return (Math.abs(h) % 6283) / 1000
}
