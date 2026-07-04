// Pure graph-building logic for the Vault galaxy. No canvas, no React —
// everything here is unit-testable in isolation.
import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

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

export interface GalaxyNode {
  id: string
  label: string
  cls: NodeClass
  type?: VaultItemType
  item?: VaultItemListItem
  degree: number
  radius: number
  brightness: number
  fresh: boolean
  phase: number
  x?: number
  y?: number
}

export interface GalaxyLink { source: string; target: string }

export interface Galaxy {
  nodes: GalaxyNode[]
  links: GalaxyLink[]
  neighbors: Map<string, Set<string>>
}

export const UNTAGGED_HUB_ID = 'tag:__untagged'

// Tag-hub model: items link to their tags, never to each other.
// Edge count is linear in item count; force physics forms the clusters.
export function buildGalaxy(items: VaultItemListItem[], now: number = Date.now()): Galaxy {
  const links: GalaxyLink[] = []
  const hubMembers = new Map<string, number>()
  const neighbors = new Map<string, Set<string>>()

  const connect = (itemId: string, hubId: string) => {
    links.push({ source: itemId, target: hubId })
    hubMembers.set(hubId, (hubMembers.get(hubId) ?? 0) + 1)
    if (!neighbors.has(itemId)) neighbors.set(itemId, new Set())
    if (!neighbors.has(hubId)) neighbors.set(hubId, new Set())
    neighbors.get(itemId)!.add(hubId)
    neighbors.get(hubId)!.add(itemId)
  }

  for (const item of items) {
    if (item.tags.length === 0) {
      connect(item.id, UNTAGGED_HUB_ID)
    } else {
      for (const tag of item.tags) connect(item.id, `tag:${tag}`)
    }
  }

  const itemNodes: GalaxyNode[] = items.map(item => {
    const cls = classifyType(item.type)
    const degree = Math.max(item.tags.length, 1)
    return {
      id: item.id,
      label: item.title,
      cls,
      type: item.type,
      item,
      degree,
      radius: nodeRadius(cls, degree),
      brightness: ageBrightness(item.updated_at, now, cls),
      fresh: isFresh(item.updated_at, now),
      phase: hashPhase(item.id),
    }
  })

  const hubNodes: GalaxyNode[] = [...hubMembers.entries()].map(([hubId, count]) => ({
    id: hubId,
    label: hubId === UNTAGGED_HUB_ID ? 'untagged' : hubId.slice(4),
    cls: 'hub' as const,
    degree: count,
    radius: nodeRadius('hub', count),
    brightness: 0.9,
    fresh: false,
    phase: hashPhase(hubId),
  }))

  return { nodes: [...itemNodes, ...hubNodes], links, neighbors }
}
