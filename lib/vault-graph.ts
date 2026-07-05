// Pure graph-building logic for the Vault galaxy. No canvas, no React —
// everything here is unit-testable in isolation.
import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

export type NodeClass = 'planet' | 'star' | 'hub'
export type PlanetVariant = 'ringed' | 'banded' | 'swirl' | 'smooth'

// Auto-captured exhaust renders as tiny "distant stars"; everything else is a planet.
export const STAR_TYPES: VaultItemType[] = ['git_push', 'agent_session', 'file_snapshot', 'mcp_event']

// Significance per type — drives node size so the galaxy reads at a glance:
// decisions/specs are gas giants, knowledge/skills mid planets, dumps small, exhaust dim stars.
export const TYPE_WEIGHT: Record<VaultItemType, number> = {
  decision_log:      1,
  build_spec:        1,
  knowledge:         0.85,
  skill:             0.8,
  agent:             0.8,
  personal:          0.65,
  credential:        0.65,
  ab_conversation:   0.55,
  brain_dump_mirror: 0.5,
  agent_session:     0.45,
  git_push:          0.3,
  file_snapshot:     0.25,
  mcp_event:         0.2,
}

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

// Size bands driven by significance (weight² spreads the range) PLUS content
// volume (log of chars — a 40k-char spec is a gas giant, a one-liner a rock)
// plus connectivity: planets ~3–17px, stars ~1–2.5px, hub suns 5–14px.
export function nodeRadius(cls: NodeClass, degree: number, weight = 0.7, contentLength = 0): number {
  if (cls === 'planet') {
    const volume = Math.max(Math.log10(Math.max(contentLength, 10)) - 1, 0) // 0 at ≤10 chars → ~4 at 100k
    return Math.min(2 + weight * weight * 7 + volume * 1.7 + Math.min(degree, 6) * 0.6, 17)
  }
  if (cls === 'star') return 0.8 + weight * 1.6 + Math.min(degree, 4) * 0.15
  return Math.min(5 + Math.sqrt(Math.max(degree, 0)) * 1.6, 14)
}

function hashCode(id: string): number {
  let h = 0
  for (let i = 0; i < id.length; i++) h = (h * 31 + id.charCodeAt(i)) | 0
  return Math.abs(h)
}

// Deterministic per-node phase offset in [0, 2π) so twinkle/sheen never sync up.
export function hashPhase(id: string): number {
  return (hashCode(id) % 6283) / 1000
}

// Deterministic surface look. Top-significance planets get rings; the rest
// split between banded (Jupiter), swirl (storm), and smooth surfaces.
export function planetVariant(id: string, weight: number): PlanetVariant {
  if (weight >= 0.95) return 'ringed'
  return (['banded', 'swirl', 'smooth'] as const)[hashCode(id) % 3]
}

export interface GalaxyNode {
  id: string
  label: string
  cls: NodeClass
  type?: VaultItemType
  item?: VaultItemListItem
  degree: number
  radius: number
  weight: number
  variant?: PlanetVariant
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
    const weight = TYPE_WEIGHT[item.type] ?? 0.6
    return {
      id: item.id,
      label: item.title,
      cls,
      type: item.type,
      item,
      degree,
      radius: nodeRadius(cls, degree, weight, item.content.length),
      weight,
      variant: cls === 'planet' ? planetVariant(item.id, weight) : undefined,
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
    weight: 1,
    brightness: 0.9,
    fresh: false,
    phase: hashPhase(hubId),
  }))

  return { nodes: [...itemNodes, ...hubNodes], links, neighbors }
}
