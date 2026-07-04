# Vault Graph v2 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.
> **Operator override:** execution runs via the `davids-agents` serial relay — one fresh subagent per task, lighter models for grunt work, orchestrator (Fable) reviews between tasks.

**Goal:** Rebuild the Vault graph as a full-screen "living galaxy" (planets = significant items, stars = auto-captured history, tag hubs = clusters), add a guided tour for non-operators, and add token-lean MCP vault access.

**Architecture:** Pure graph-building logic lives in `lib/vault-graph.ts` (unit-tested, no canvas). `components/VaultGraph.tsx` becomes the canvas renderer consuming it. A new full-screen route `app/(app)/vault/graph/page.tsx` hosts the graph + toolbar + tour; the old embedded graph on `/vault` becomes a preview link card. MCP gains `mc_get_vault_item` and slims `mc_get_vault_context` previews, changed in BOTH `lib/mcp-tools.ts` and `mcp-server.mjs`.

**Tech Stack:** Next.js 16 / React 19 / TypeScript, `react-force-graph-2d` (existing — no new graph lib), Tailwind v4, vitest (new devDependency, unit tests only), Supabase (read-side only, no schema changes).

**Spec:** `docs/superpowers/specs/2026-07-04-vault-graph-v2-design.md` — read it before starting any task.

## Global Constraints

- **No new graph library.** Rendering stays on `react-force-graph-2d@^1.29.1`.
- **No schema changes.** `created_at` / `updated_at` already load via `listVaultItems()`.
- **Never use `createServerSupabaseClient()` in server actions or API routes** — always `createAdminSupabaseClient()` (project standing rule).
- **MCP tool changes go in BOTH `lib/mcp-tools.ts` AND `mcp-server.mjs`** (duplicated definitions + handlers). `app/api/mcp/route.ts` is a generic dispatcher — verify no change needed, don't add per-tool code there.
- MCP tools must never return `encrypted` items or types `credential` / `personal`.
- Brightness floor: planets never dim below **0.35**, stars never below **0.20** — everything stays hoverable.
- All ambient animation (twinkle, sheen, rotation, pulse) must respect `prefers-reduced-motion: reduce` (disable it).
- Ambient rotation must pause during interaction (hover, drag, pan/zoom, tour) — hover targets never slide under the cursor.
- One commit per task, exact messages given per task. Do not push (orchestrator pushes at session end).
- Commands are for Windows PowerShell in `c:\Users\david\Documents\personal-os`.

---

### Task 1: Vitest setup + node classification, brightness curve, radii

**Recommended model:** Sonnet (Tier 2 — pure logic + test scaffolding)

**Files:**
- Modify: `package.json` (add vitest devDependency + `test` script)
- Create: `vitest.config.ts`
- Create: `lib/vault-graph.ts`
- Test: `tests/vault-graph.test.ts`

**Interfaces:**
- Consumes: `VaultItemType` from `@/lib/types`
- Produces (later tasks rely on these exact names):
  - `type NodeClass = 'planet' | 'star' | 'hub'`
  - `const STAR_TYPES: VaultItemType[]`
  - `classifyType(type: VaultItemType): 'planet' | 'star'`
  - `ageBrightness(updatedAt: string, now: number, cls: 'planet' | 'star'): number`
  - `nodeRadius(cls: NodeClass, degree: number): number`
  - `hashPhase(id: string): number` (deterministic 0..2π per node id)
  - `isFresh(updatedAt: string, now: number): boolean` (≤7 days — pulse eligibility)

- [ ] **Step 1: Install vitest and add the test script**

```powershell
npm install -D vitest
```

In `package.json` scripts, add:

```json
"test": "vitest run"
```

- [ ] **Step 2: Create `vitest.config.ts`** (path alias so `@/lib/...` imports resolve)

```ts
import { defineConfig } from 'vitest/config'
import path from 'path'

export default defineConfig({
  resolve: {
    alias: { '@': path.resolve(__dirname, '.') },
  },
  test: {
    include: ['tests/**/*.test.ts'],
  },
})
```

- [ ] **Step 3: Write the failing tests** in `tests/vault-graph.test.ts`

```ts
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
```

- [ ] **Step 4: Run tests to verify they fail**

Run: `npm test`
Expected: FAIL — `Cannot find module '@/lib/vault-graph'` (or equivalent resolve error).

- [ ] **Step 5: Implement `lib/vault-graph.ts`** (first half — Task 2 appends `buildGalaxy`)

```ts
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
```

- [ ] **Step 6: Run tests to verify they pass**

Run: `npm test`
Expected: PASS (all Task 1 describe blocks green).

- [ ] **Step 7: Commit**

```powershell
git add package.json package-lock.json vitest.config.ts lib/vault-graph.ts tests/vault-graph.test.ts
git commit -m "feat(vault-graph): pure logic core — classification, age brightness, radii, phase hash"
```

---

### Task 2: `buildGalaxy()` — tag hubs, links, degrees

**Recommended model:** Sonnet (Tier 2 — pure logic)

**Files:**
- Modify: `lib/vault-graph.ts` (append)
- Test: `tests/vault-graph.test.ts` (append)

**Interfaces:**
- Consumes: Task 1 exports; `VaultItemListItem` from `@/app/(app)/vault/actions`
- Produces (renderer + tour rely on these exact shapes):

```ts
export interface GalaxyNode {
  id: string                      // item id, or `tag:<name>` for hubs
  label: string                   // item title, or tag name
  cls: NodeClass
  type?: VaultItemType            // undefined for hubs
  item?: VaultItemListItem        // undefined for hubs — click payload
  degree: number                  // items: tag count; hubs: member count
  radius: number
  brightness: number              // precomputed ageBrightness (hubs: 0.9)
  fresh: boolean                  // pulse eligibility (hubs: false)
  phase: number                   // hashPhase(id)
  x?: number; y?: number          // filled in by force sim at runtime
}
export interface GalaxyLink { source: string; target: string }
export interface Galaxy {
  nodes: GalaxyNode[]
  links: GalaxyLink[]
  neighbors: Map<string, Set<string>>  // adjacency for hover highlighting
}
export const UNTAGGED_HUB_ID = 'tag:__untagged'
export function buildGalaxy(items: VaultItemListItem[], now?: number): Galaxy
```

- [ ] **Step 1: Append failing tests** to `tests/vault-graph.test.ts`

```ts
import { buildGalaxy, UNTAGGED_HUB_ID } from '@/lib/vault-graph'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

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
```

- [ ] **Step 2: Run tests to verify the new block fails**

Run: `npm test`
Expected: FAIL — `buildGalaxy is not a function` / not exported.

- [ ] **Step 3: Append the implementation** to `lib/vault-graph.ts`

```ts
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

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
```

- [ ] **Step 4: Run tests to verify they pass**

Run: `npm test`
Expected: PASS — all blocks green.

- [ ] **Step 5: Commit**

```powershell
git add lib/vault-graph.ts tests/vault-graph.test.ts
git commit -m "feat(vault-graph): buildGalaxy — tag hubs, linear links, adjacency map"
```

---

### Task 3: Rewrite `components/VaultGraph.tsx` — the living galaxy renderer

**Recommended model:** Sonnet (Tier 2 — the plan supplies complete code; task is careful transcription + verification)

**Files:**
- Modify: `components/VaultGraph.tsx` (full rewrite — replace entire file)

**Interfaces:**
- Consumes: `buildGalaxy`, `Galaxy`, `GalaxyNode`, `GalaxyLink` from `@/lib/vault-graph`
- Produces (Tasks 4 & 6 rely on this exact prop contract):

```ts
export interface VaultGraphHandle {
  centerOn: (nodeId: string, zoom?: number, ms?: number) => void
  zoomToFit: (ms?: number) => void
  getGalaxy: () => Galaxy
}
interface Props {
  items: VaultItemListItem[]
  search: string
  selectedId: string | null
  onSelect: (item: VaultItemListItem) => void
  dimExcept?: Set<string> | null   // tour spotlight: only these ids stay bright
  paused?: boolean                 // tour active: freeze ambient rotation
  handleRef?: React.MutableRefObject<VaultGraphHandle | null>
}
```

**Rendering requirements implemented below (from spec):** gradient planets (light core → type color → dark limb), tiny star points, tag hubs with far-zoom labels, age brightness, 7-day pulse, star twinkle + planet sheen (phase-offset), slow whole-field rotation around the centroid (~6 min/rev) that eases off during interaction, hover-grow ~1.8× with brighter halo, zoom-gated labels, search dimming, reduced-motion support. `autoPauseRedraw={false}` keeps the canvas animating after physics cools.

- [ ] **Step 1: Replace `components/VaultGraph.tsx` entirely with:**

```tsx
'use client'

import dynamic from 'next/dynamic'
import { useMemo, useCallback, useRef, useState, useEffect, type ComponentType, type MutableRefObject } from 'react'
import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'
import { buildGalaxy, type Galaxy, type GalaxyNode, type GalaxyLink } from '@/lib/vault-graph'

// Dynamic import prevents SSR crash; the wrapper forwards a ref to the
// force-graph instance (next/dynamic does not forward refs on its own).
const ForceGraph2D = dynamic(async () => {
  const mod = await import('react-force-graph-2d')
  const FG = mod.default as ComponentType<Record<string, unknown>>
  function Wrapper({ fgRef, ...props }: { fgRef?: MutableRefObject<unknown> } & Record<string, unknown>) {
    return <FG {...props} ref={fgRef as never} />
  }
  return Wrapper
}, { ssr: false })

const TYPE_COLOR: Record<VaultItemType, string> = {
  credential:       '#f59e0b',
  skill:            '#3b82f6',
  agent:            '#8b5cf6',
  personal:         '#f43f5e',
  knowledge:        '#22c55e',
  git_push:         '#94a3b8',
  file_snapshot:    '#94a3b8',
  brain_dump_mirror:'#06b6d4',
  ab_conversation:  '#a855f7',
  build_spec:       '#10b981',
  agent_session:    '#f97316',
  decision_log:     '#84cc16',
  mcp_event:        '#94a3b8',
}

const HUB_RING = '#8b5cf6'
const HUB_FILL = '#151030'
const ROTATION_RAD_PER_SEC = (2 * Math.PI) / 360   // one revolution ≈ 6 minutes
const IDLE_RESUME_MS = 3000                        // rotation resumes this long after last interaction
const READING_ZOOM = 1.3                           // zoomed past this = reading; rotation stays off

function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  return `rgb(${Math.round(r + (255 - r) * amount)},${Math.round(g + (255 - g) * amount)},${Math.round(b + (255 - b) * amount)})`
}

function darken(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff, g = (n >> 8) & 0xff, b = n & 0xff
  return `rgb(${Math.round(r * (1 - amount))},${Math.round(g * (1 - amount))},${Math.round(b * (1 - amount))})`
}

function endpointId(end: string | GalaxyNode): string {
  return typeof end === 'object' ? end.id : end
}

export interface VaultGraphHandle {
  centerOn: (nodeId: string, zoom?: number, ms?: number) => void
  zoomToFit: (ms?: number) => void
  getGalaxy: () => Galaxy
}

interface Props {
  items: VaultItemListItem[]
  search: string
  selectedId: string | null
  onSelect: (item: VaultItemListItem) => void
  dimExcept?: Set<string> | null
  paused?: boolean
  handleRef?: MutableRefObject<VaultGraphHandle | null>
}

// force-graph mutates link source/target into node objects and adds sim fields
type FgMethods = {
  centerAt: (x?: number, y?: number, ms?: number) => void
  zoom: (k?: number, ms?: number) => void
  zoomToFit: (ms?: number, px?: number) => void
}

export function VaultGraph({ items, search, selectedId, onSelect, dimExcept, paused, handleRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<FgMethods | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })

  // Refs for values the rAF/draw loop reads every frame (avoid re-creating callbacks)
  const hoverIdRef = useRef<string | null>(null)
  const hoverGrow = useRef(new Map<string, number>())   // nodeId -> 0..1 grow progress
  const lastInteraction = useRef(0)
  const zoomLevel = useRef(1)
  const dragging = useRef(false)
  const rotSpeed = useRef(0)                            // eased 0..1 rotation factor
  const reducedMotion = useRef(false)
  const pausedRef = useRef(false)
  pausedRef.current = !!paused

  const galaxy = useMemo(() => buildGalaxy(items), [items])
  const galaxyRef = useRef(galaxy)
  galaxyRef.current = galaxy

  // Expose the imperative handle for the tour + toolbar
  useEffect(() => {
    if (!handleRef) return
    handleRef.current = {
      centerOn: (nodeId, zoom = 2.5, ms = 800) => {
        const n = galaxyRef.current.nodes.find(nn => nn.id === nodeId)
        if (!n || n.x === undefined || n.y === undefined || !fgRef.current) return
        fgRef.current.centerAt(n.x, n.y, ms)
        fgRef.current.zoom(zoom, ms)
      },
      zoomToFit: (ms = 800) => fgRef.current?.zoomToFit(ms, 60),
      getGalaxy: () => galaxyRef.current,
    }
    return () => { handleRef.current = null }
  }, [handleRef])

  // Track container size (full-bleed layouts resize)
  useEffect(() => {
    const el = containerRef.current
    if (!el) return
    const ro = new ResizeObserver(() => setSize({ w: el.offsetWidth, h: el.offsetHeight }))
    ro.observe(el)
    setSize({ w: el.offsetWidth, h: el.offsetHeight })
    return () => ro.disconnect()
  }, [])

  useEffect(() => {
    reducedMotion.current = window.matchMedia('(prefers-reduced-motion: reduce)').matches
  }, [])

  // Ambient galaxy rotation: slowly rotate node positions around the centroid.
  // Runs only when idle — mutating real positions keeps hover hit-targets exact.
  useEffect(() => {
    let raf = 0
    let prev = performance.now()
    const tick = (t: number) => {
      const dt = Math.min((t - prev) / 1000, 0.1)
      prev = t
      const idle =
        !reducedMotion.current &&
        !pausedRef.current &&
        !hoverIdRef.current &&
        !dragging.current &&
        zoomLevel.current <= READING_ZOOM &&
        t - lastInteraction.current > IDLE_RESUME_MS &&
        !document.hidden
      const target = idle ? 1 : 0
      rotSpeed.current += (target - rotSpeed.current) * Math.min(dt * 2, 1)

      if (rotSpeed.current > 0.01) {
        const nodes = galaxyRef.current.nodes
        if (nodes.length > 1) {
          let cx = 0, cy = 0, n = 0
          for (const node of nodes) {
            if (node.x !== undefined && node.y !== undefined) { cx += node.x; cy += node.y; n++ }
          }
          if (n > 0) {
            cx /= n; cy /= n
            const dtheta = ROTATION_RAD_PER_SEC * dt * rotSpeed.current
            const cos = Math.cos(dtheta), sin = Math.sin(dtheta)
            for (const node of nodes) {
              if (node.x === undefined || node.y === undefined) continue
              const dx = node.x - cx, dy = node.y - cy
              node.x = cx + dx * cos - dy * sin
              node.y = cy + dx * sin + dy * cos
            }
          }
        }
      }
      raf = requestAnimationFrame(tick)
    }
    raf = requestAnimationFrame(tick)
    return () => cancelAnimationFrame(raf)
  }, [])

  const focusId = hoverId ?? selectedId
  const highlight = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const n of galaxy.neighbors.get(focusId) ?? []) set.add(n)
    return set
  }, [focusId, galaxy])

  const searchLower = search.toLowerCase()

  const nodeCanvasObject = useCallback(
    (node: GalaxyNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const t = performance.now()
      const x = node.x ?? 0, y = node.y ?? 0
      const isSelected = node.id === selectedId
      const isHovered = node.id === hoverIdRef.current
      const anim = !reducedMotion.current

      // Hover-grow: ease each node's scale toward 1.8 while hovered, back to 1 after
      let grow = hoverGrow.current.get(node.id) ?? 0
      grow += ((isHovered ? 1 : 0) - grow) * 0.18
      if (grow < 0.005) hoverGrow.current.delete(node.id)
      else hoverGrow.current.set(node.id, grow)
      const scale = 1 + grow * 0.8
      const r = node.radius * scale

      // Layered dimming: tour spotlight > search > hover/selection neighborhood
      let vis = 1
      if (dimExcept) vis = dimExcept.has(node.id) ? 1 : 0.08
      else if (search) vis = node.label.toLowerCase().includes(searchLower) ? 1 : 0.1
      else if (highlight) vis = highlight.has(node.id) ? 1 : 0.12

      // Age brightness + star twinkle (slow per-node flicker, phase-offset)
      let bright = node.brightness
      if (anim && node.cls === 'star') bright *= 0.82 + 0.18 * Math.sin(t / 1400 + node.phase * 3)
      const alpha = vis * Math.min(bright + grow * 0.3, 1)

      if (node.cls === 'hub') {
        ctx.globalAlpha = alpha * 0.9
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = HUB_FILL; ctx.fill()
        ctx.strokeStyle = HUB_RING; ctx.lineWidth = 1 / globalScale + 0.4; ctx.stroke()
        // Territory labels: visible from far out — these ARE the map
        if (globalScale > 0.3 || isHovered) {
          const fontSize = Math.max(9, 12 / globalScale)
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillStyle = `rgba(167,139,250,${0.85 * vis})`
          ctx.fillText(node.label, x, y - r - fontSize * 0.8)
        }
        ctx.globalAlpha = 1
        return
      }

      const color = TYPE_COLOR[node.type!] ?? '#94a3b8'

      if (node.cls === 'star') {
        ctx.globalAlpha = alpha
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = lighten(color, 0.3); ctx.fill()
        if (isHovered || isSelected) {
          ctx.beginPath(); ctx.arc(x, y, r + 2.5 / globalScale, 0, 2 * Math.PI)
          ctx.strokeStyle = 'rgba(226,232,240,0.8)'; ctx.lineWidth = 0.8 / globalScale; ctx.stroke()
        }
      } else {
        // Planet: outer glow halo (pulses while fresh), then gradient body with sheen
        const pulse = anim && node.fresh ? 1 + 0.15 * Math.sin(t / 900 + node.phase) : 1
        const glowR = r * (isHovered || isSelected ? 3.4 : 2.4) * pulse
        const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR)
        glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = alpha * (isHovered || isSelected ? 0.55 : node.fresh ? 0.4 : 0.25)
        ctx.beginPath(); ctx.arc(x, y, glowR, 0, 2 * Math.PI)
        ctx.fillStyle = glow; ctx.fill()

        // Sheen: the gradient highlight slowly drifts — light moving across the surface
        const sheenA = anim ? t / 5000 + node.phase : -0.6
        const hx = x + Math.cos(sheenA) * r * 0.35
        const hy = y + Math.sin(sheenA) * r * 0.35
        ctx.globalAlpha = alpha
        const body = ctx.createRadialGradient(hx, hy, r * 0.1, x, y, r)
        body.addColorStop(0, lighten(color, 0.6))
        body.addColorStop(0.6, color)
        body.addColorStop(1, darken(color, 0.35))
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = body; ctx.fill()
      }

      if (isSelected) {
        ctx.beginPath(); ctx.arc(x, y, r + 3 / globalScale, 0, 2 * Math.PI)
        ctx.strokeStyle = '#ffffff'; ctx.lineWidth = 1.2 / globalScale; ctx.stroke()
      }

      // Zoom-gated labels: planets appear past 1.2× (or on focus); stars only on focus
      const showLabel =
        node.cls === 'planet'
          ? globalScale > 1.2 || isHovered || isSelected
          : isHovered || isSelected
      if (showLabel) {
        const label = node.label.length > 28 ? node.label.slice(0, 26) + '…' : node.label
        const fontSize = Math.max(7, 11 / globalScale)
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
        const ly = y + r + fontSize * 0.9 + 2 / globalScale
        ctx.globalAlpha = Math.max(alpha, isHovered || isSelected ? 1 : 0)
        ctx.fillStyle = 'rgba(0,0,0,0.65)'; ctx.fillText(label, x + 0.6, ly + 0.6)
        ctx.fillStyle = isHovered || isSelected ? '#ffffff' : 'rgba(226,232,240,0.8)'
        ctx.fillText(label, x, ly)
      }

      ctx.globalAlpha = 1
    },
    [selectedId, search, searchLower, highlight, dimExcept]
  )

  // Generous hit area so 1.5px stars are hoverable
  const nodePointerAreaPaint = useCallback(
    (node: GalaxyNode, color: string, ctx: CanvasRenderingContext2D, globalScale: number) => {
      ctx.fillStyle = color
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, Math.max(node.radius + 1.5, 4 / globalScale), 0, 2 * Math.PI)
      ctx.fill()
    },
    []
  )

  const linkColor = useCallback(
    (link: GalaxyLink) => {
      const s = endpointId(link.source as never), tt = endpointId(link.target as never)
      if (dimExcept) return dimExcept.has(s) && dimExcept.has(tt) ? 'rgba(148,163,184,0.5)' : 'rgba(148,163,184,0.03)'
      if (highlight) return highlight.has(s) && highlight.has(tt) ? 'rgba(148,163,184,0.5)' : 'rgba(148,163,184,0.04)'
      return 'rgba(148,163,184,0.1)'
    },
    [highlight, dimExcept]
  )

  const linkWidth = useCallback(
    (link: GalaxyLink) => {
      if (!highlight) return 0.8
      const s = endpointId(link.source as never), tt = endpointId(link.target as never)
      return highlight.has(s) && highlight.has(tt) ? 1.5 : 0.5
    },
    [highlight]
  )

  const handleNodeClick = useCallback((node: GalaxyNode) => {
    lastInteraction.current = performance.now()
    if (node.item) onSelect(node.item)
  }, [onSelect])

  const handleNodeHover = useCallback((node: GalaxyNode | null) => {
    hoverIdRef.current = node?.id ?? null
    setHoverId(node?.id ?? null)
    lastInteraction.current = performance.now()
    if (containerRef.current) containerRef.current.style.cursor = node ? 'pointer' : 'default'
  }, [])

  const handleZoom = useCallback((tr: { k: number }) => {
    zoomLevel.current = tr.k
    lastInteraction.current = performance.now()
  }, [])

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-full min-h-96 text-sm text-gray-500">
        No vault items to display in graph.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="w-full h-full bg-[#030712]">
      <ForceGraph2D
        fgRef={fgRef}
        graphData={galaxy}
        nodeId="id"
        nodeLabel={() => ''}
        nodeVal={(n: GalaxyNode) => n.radius * n.radius}
        nodeRelSize={1}
        nodeCanvasObject={nodeCanvasObject as never}
        nodeCanvasObjectMode={() => 'replace'}
        nodePointerAreaPaint={nodePointerAreaPaint as never}
        onNodeClick={handleNodeClick as never}
        onNodeHover={handleNodeHover as never}
        onNodeDrag={(() => { dragging.current = true; lastInteraction.current = performance.now() }) as never}
        onNodeDragEnd={(() => { dragging.current = false }) as never}
        onZoom={handleZoom as never}
        linkColor={linkColor as never}
        linkWidth={linkWidth as never}
        backgroundColor="#030712"
        width={size.w}
        height={size.h}
        cooldownTicks={120}
        d3VelocityDecay={0.3}
        autoPauseRedraw={false}
      />
    </div>
  )
}
```

- [ ] **Step 2: Type-check and lint**

Run: `npx tsc --noEmit; npm run lint`
Expected: no new errors. (`app/(app)/vault/page.tsx` still imports `VaultGraph` with the old props — if `tsc` flags that call site, note it and continue; Task 5 removes it. Any other error must be fixed here.)

- [ ] **Step 3: Commit**

```powershell
git add components/VaultGraph.tsx
git commit -m "feat(vault-graph): living-galaxy renderer — planets/stars/hubs, age light, twinkle, sheen, rotation, hover-grow"
```

---

### Task 4: Full-screen route `app/(app)/vault/graph/page.tsx`

**Recommended model:** Sonnet (Tier 2 — new page wiring, complete code supplied)

**Files:**
- Create: `app/(app)/vault/graph/page.tsx`

**Interfaces:**
- Consumes: `VaultGraph`, `VaultGraphHandle` (Task 3), `VaultSidePanel` (existing, unchanged), `listVaultItems`, `listProjectNames` from `@/app/(app)/vault/actions`, `STAR_TYPES` from `@/lib/vault-graph`
- Produces: a `tourOpen` state hook point — Task 6 mounts `VaultGraphTour` at the `{/* TOUR MOUNT */}` marker comment.

- [ ] **Step 1: Create the page**

```tsx
'use client'

import { useEffect, useMemo, useRef, useState } from 'react'
import Link from 'next/link'
import { listVaultItems, listProjectNames, type VaultItemListItem } from '../actions'
import { VaultGraph, type VaultGraphHandle } from '@/components/VaultGraph'
import { VaultSidePanel } from '@/components/VaultSidePanel'
import { STAR_TYPES } from '@/lib/vault-graph'
import type { VaultItemType } from '@/lib/types'

// Not exported — Next.js App Router rejects non-standard exports from page files
const TYPE_GROUPS: { key: string; label: string; types: VaultItemType[] | null }[] = [
  { key: 'all',       label: 'All',            types: null },
  { key: 'knowledge', label: 'Knowledge',      types: ['knowledge'] },
  { key: 'decisions', label: 'Specs & Decisions', types: ['build_spec', 'decision_log'] },
  { key: 'dumps',     label: 'Brain Dumps',    types: ['brain_dump_mirror', 'ab_conversation'] },
  { key: 'skills',    label: 'Skills & Agents', types: ['skill', 'agent'] },
  { key: 'history',   label: 'History',        types: STAR_TYPES },
]

export default function VaultGraphPage() {
  const [items, setItems] = useState<VaultItemListItem[]>([])
  const [projects, setProjects] = useState<{ id: string; name: string }[]>([])
  const [loading, setLoading] = useState(true)
  const [loadError, setLoadError] = useState<string | null>(null)
  const [search, setSearch] = useState('')
  const [group, setGroup] = useState('all')
  const [projectFilter, setProjectFilter] = useState<'all' | string>('all')
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [tourOpen, setTourOpen] = useState(false)
  const graphHandle = useRef<VaultGraphHandle | null>(null)

  async function load() {
    setLoading(true)
    setLoadError(null)
    try {
      const [data, projs] = await Promise.all([listVaultItems(), listProjectNames()])
      setItems(data)
      setProjects(projs)
    } catch (err) {
      setLoadError(err instanceof Error ? err.message : 'Failed to load vault')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const displayItems = useMemo(() => {
    const types = TYPE_GROUPS.find(g => g.key === group)?.types ?? null
    return items.filter(i =>
      (types === null || types.includes(i.type)) &&
      (projectFilter === 'all' || i.project_id === projectFilter)
    )
  }, [items, group, projectFilter])

  const selectedItem = items.find(i => i.id === selectedId) ?? null
  const chipCls = (active: boolean) =>
    `px-3 py-1.5 rounded-full text-xs transition-colors border ${
      active ? 'bg-violet-600/30 border-violet-500/50 text-violet-200'
             : 'bg-white/5 border-white/10 text-gray-400 hover:text-white hover:border-white/25'
    }`

  return (
    <div className="fixed inset-0 z-40 bg-[#030712]">
      <VaultGraph
        items={displayItems}
        search={search}
        selectedId={selectedId}
        onSelect={item => setSelectedId(item.id)}
        paused={tourOpen}
        handleRef={graphHandle}
      />

      {/* Toolbar overlay */}
      <div className="absolute top-0 inset-x-0 p-4 flex items-center gap-3 flex-wrap pointer-events-none">
        <div className="flex items-center gap-3 pointer-events-auto">
          <Link
            href="/vault"
            className="px-3 py-1.5 rounded-lg bg-white/5 border border-white/10 text-xs text-gray-400 hover:text-white"
          >
            ← Vault
          </Link>
          <input
            className="w-56 bg-black/50 backdrop-blur border border-white/10 rounded-lg px-3 py-1.5 text-sm text-white placeholder-gray-500 focus:outline-none focus:border-violet-500"
            placeholder="Search the galaxy…"
            value={search}
            onChange={e => setSearch(e.target.value)}
          />
        </div>
        <div className="flex items-center gap-1.5 flex-wrap pointer-events-auto">
          {TYPE_GROUPS.map(g => (
            <button key={g.key} onClick={() => setGroup(g.key)} className={chipCls(group === g.key)}>
              {g.label}
            </button>
          ))}
        </div>
        <div className="flex items-center gap-2 ml-auto pointer-events-auto">
          {projects.length > 0 && (
            <select
              value={projectFilter}
              onChange={e => setProjectFilter(e.target.value)}
              className="bg-black/50 border border-white/10 rounded-lg px-2 py-1.5 text-xs text-white focus:outline-none focus:border-violet-500"
              style={{ colorScheme: 'dark' }}
            >
              <option value="all" style={{ backgroundColor: '#111827' }}>All projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id} style={{ backgroundColor: '#111827' }}>{p.name}</option>
              ))}
            </select>
          )}
          <button
            onClick={() => setTourOpen(true)}
            className="px-3 py-1.5 rounded-lg bg-violet-600/80 hover:bg-violet-500 text-white text-xs"
          >
            ✦ What is this?
          </button>
        </div>
      </div>

      {loading && (
        <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
          <p className="text-sm text-gray-500 animate-pulse">Charting the galaxy…</p>
        </div>
      )}
      {loadError && (
        <div className="absolute inset-x-0 top-20 flex justify-center">
          <div className="rounded-xl border border-red-500/20 bg-red-500/10 px-4 py-3">
            <p className="text-sm text-red-400">Failed to load vault: {loadError}</p>
            <button onClick={load} className="mt-1 text-xs text-red-400 underline">Retry</button>
          </div>
        </div>
      )}

      {selectedItem && (
        <VaultSidePanel
          item={selectedItem}
          onClose={() => setSelectedId(null)}
          onUpdated={load}
          onDeleted={() => { setSelectedId(null); load() }}
          onSelect={item => setSelectedId(item.id)}
        />
      )}

      {/* TOUR MOUNT — Task 6 renders <VaultGraphTour> here when tourOpen */}
    </div>
  )
}
```

- [ ] **Step 2: Verify it builds and renders**

Run: `npx tsc --noEmit; npm run build`
Expected: build succeeds (same pre-existing vault page warning allowance as Task 3 — nothing new).

Then: `npm run dev`, open `http://localhost:3000/vault/graph` in a browser. Verify: galaxy renders full-screen, clusters form around tag hubs, planets glow / stars twinkle, hover grows a node and shows its name, click opens the side panel, search dims non-matches, chips and project filter re-shape the graph, the field slowly rotates when you keep hands off and stops when you hover.

- [ ] **Step 3: Commit**

```powershell
git add "app/(app)/vault/graph/page.tsx"
git commit -m "feat(vault): full-screen galaxy route with toolbar, filters, side panel"
```

---

### Task 5: Vault page preview card (replace embedded graph)

**Recommended model:** Haiku (Tier 1 — mechanical edit, complete code supplied)

**Files:**
- Modify: `app/(app)/vault/page.tsx`
- Modify: `components/VaultList.tsx`

**Interfaces:**
- Consumes: nothing new. Removes the `view` / `onViewChange` props from `VaultList` and all `VaultGraph` usage from the vault page.
- Produces: `/vault` page shows a "Galaxy view" link card above the list.

- [ ] **Step 1: Edit `app/(app)/vault/page.tsx`**

1. Remove the import: `import { VaultGraph } from '@/components/VaultGraph'`
2. Add: `import Link from 'next/link'`
3. Remove the state line: `const [view, setView] = useState<'list' | 'graph'>('list')`
4. Replace the entire `{view === 'list' ? ( ... ) : ( ... )}` block (both branches render `VaultList`; the second also renders `VaultGraph`) with:

```tsx
          <Link
            href="/vault/graph"
            className="group relative flex items-center justify-between rounded-xl border border-white/10 bg-gradient-to-r from-[#0b1120] to-[#151030] px-5 py-4 overflow-hidden hover:border-violet-500/40 transition-colors"
          >
            <div className="relative z-10">
              <p className="text-sm font-medium text-white">✦ Galaxy view</p>
              <p className="text-xs text-gray-500 mt-0.5">
                {items.length} items orbiting {new Set(items.flatMap(i => i.tags)).size} topics — explore the second brain as a living map
              </p>
            </div>
            <span className="relative z-10 text-xs text-violet-300 group-hover:text-violet-200">Open →</span>
            <svg className="absolute inset-0 w-full h-full opacity-40" aria-hidden="true">
              <circle cx="72%" cy="30%" r="2.5" fill="#22c55e" />
              <circle cx="80%" cy="60%" r="1.5" fill="#3b82f6" />
              <circle cx="88%" cy="38%" r="2" fill="#f59e0b" />
              <circle cx="64%" cy="68%" r="1" fill="#94a3b8" />
              <circle cx="93%" cy="70%" r="1" fill="#94a3b8" />
              <circle cx="58%" cy="42%" r="1.2" fill="#a855f7" />
            </svg>
          </Link>

          <VaultList
            items={displayItems}
            search={search}
            typeFilter={typeFilter}
            selectedId={selectedId}
            onSearch={setSearch}
            onTypeFilter={setTypeFilter}
            onSelect={handleSelect}
          />
```

- [ ] **Step 2: Edit `components/VaultList.tsx`**

1. In `interface Props` (line ~35), remove the two lines: `onViewChange: (v: 'list' | 'graph') => void` and `view: 'list' | 'graph'`
2. In the destructured parameters, remove `onViewChange, view`
3. Delete the view-toggle button group (the two buttons calling `onViewChange('list')` / `onViewChange('graph')` and their wrapper div, around lines 66–80)
4. Change the conditional `{view === 'list' && (` to always render — replace with `{(` and keep the block, or remove the condition entirely so the list always shows.

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit; npm run lint`
Expected: clean — the old-props call site is gone, no remaining references to `view`/`onViewChange` (`grep -n "onViewChange" components app` should return nothing).

Then in the dev server: `/vault` shows the Galaxy view card above the list; clicking it opens the full-screen graph; back link returns.

- [ ] **Step 4: Commit**

```powershell
git add "app/(app)/vault/page.tsx" components/VaultList.tsx
git commit -m "feat(vault): replace embedded graph with galaxy-view preview card"
```

---

### Task 6: Guided tour — `components/VaultGraphTour.tsx`

**Recommended model:** Sonnet (Tier 2 — interaction logic, complete code supplied)

**Files:**
- Create: `components/VaultGraphTour.tsx`
- Modify: `app/(app)/vault/graph/page.tsx` (mount at the `{/* TOUR MOUNT */}` marker + pass `dimExcept`)

**Interfaces:**
- Consumes: `VaultGraphHandle` (Task 3), `Galaxy`, `GalaxyNode` from `@/lib/vault-graph`
- Produces:

```ts
interface TourProps {
  handle: React.MutableRefObject<VaultGraphHandle | null>
  onDim: (ids: Set<string> | null) => void   // page passes this into VaultGraph.dimExcept
  onClose: () => void
}
export function VaultGraphTour(props: TourProps): JSX.Element
```

- [ ] **Step 1: Create `components/VaultGraphTour.tsx`**

```tsx
'use client'

import { useEffect, useMemo, useState, type MutableRefObject } from 'react'
import type { VaultGraphHandle } from '@/components/VaultGraph'
import type { GalaxyNode } from '@/lib/vault-graph'

interface TourStep {
  title: string
  body: string
  targetId: string | null   // null = zoom out to the whole galaxy
  zoom: number
}

// Pick live targets so the tour never goes stale. Any picker may return
// undefined (e.g. no stars exist) — those steps are skipped.
function buildSteps(nodes: GalaxyNode[]): TourStep[] {
  const planets = nodes.filter(n => n.cls === 'planet')
  const hubs = nodes.filter(n => n.cls === 'hub' && n.id !== 'tag:__untagged')
  const stars = nodes.filter(n => n.cls === 'star')

  const brightestPlanet = [...planets].sort((a, b) => b.brightness - a.brightness)[0]
  const biggestHub = [...hubs].sort((a, b) => b.degree - a.degree)[0]
  const dimmestPlanet = [...planets].sort((a, b) => a.brightness - b.brightness)[0]
  const anyStar = [...stars].sort((a, b) => b.brightness - a.brightness)[0]

  const steps: (TourStep | null)[] = [
    {
      title: "David's second brain",
      body: 'Every dot is one real thing — a lesson learned, a decision made, an idea captured, or a piece of work done. Together they form a map of everything the business knows.',
      targetId: null, zoom: 1,
    },
    brightestPlanet ? {
      title: 'The big colorful dots are knowledge',
      body: `Planets are the important stuff: things David learned, decisions, plans, and ideas. This one is "${brightestPlanet.label}". The color tells you what kind of thing it is.`,
      targetId: brightestPlanet.id, zoom: 3,
    } : null,
    biggestHub ? {
      title: 'Topics pull things together',
      body: `The small ringed dots are topics. Everything about "${biggestHub.label}" gathers around this one — that's why the map forms neighborhoods.`,
      targetId: biggestHub.id, zoom: 2.2,
    } : null,
    dimmestPlanet && dimmestPlanet.brightness < 0.8 ? {
      title: 'Bright means recent',
      body: 'Fresh information glows. Things nobody has touched in months fade — like this one — but they never disappear. Brightness shows where the action is right now.',
      targetId: dimmestPlanet.id, zoom: 3,
    } : null,
    anyStar ? {
      title: 'The tiny stars are work history',
      body: 'Every time code gets saved or an AI finishes a work session, a tiny star appears automatically. Nobody writes these down — the system remembers by itself.',
      targetId: anyStar.id, zoom: 3.5,
    } : null,
    {
      title: 'AI agents read this too',
      body: "When an AI works on any of David's projects, it looks things up here first — so nothing has to be re-explained. That's why it's called a second brain.",
      targetId: null, zoom: 1,
    },
    {
      title: 'Explore it yourself',
      body: "Point at any dot to see its name. Click it to read what is inside. That is all there is to it — have a look around.",
      targetId: null, zoom: 1,
    },
  ]
  return steps.filter((s): s is TourStep => s !== null)
}

interface TourProps {
  handle: MutableRefObject<VaultGraphHandle | null>
  onDim: (ids: Set<string> | null) => void
  onClose: () => void
}

export function VaultGraphTour({ handle, onDim, onClose }: TourProps) {
  const [idx, setIdx] = useState(0)
  const steps = useMemo(() => buildSteps(handle.current?.getGalaxy().nodes ?? []), [handle])

  useEffect(() => {
    const step = steps[idx]
    if (!step) return
    if (step.targetId) {
      handle.current?.centerOn(step.targetId, step.zoom, 900)
      const galaxy = handle.current?.getGalaxy()
      const spotlight = new Set([step.targetId])
      for (const n of galaxy?.neighbors.get(step.targetId) ?? []) spotlight.add(n)
      onDim(spotlight)
    } else {
      handle.current?.zoomToFit(900)
      onDim(null)
    }
  }, [idx, steps, handle, onDim])

  function close() {
    onDim(null)
    handle.current?.zoomToFit(600)
    onClose()
  }

  if (steps.length === 0) { close(); return null }
  const step = steps[idx]
  const last = idx === steps.length - 1

  return (
    <div className="absolute inset-x-0 bottom-8 flex justify-center pointer-events-none">
      <div className="pointer-events-auto w-full max-w-md mx-4 rounded-2xl border border-violet-500/30 bg-gray-950/90 backdrop-blur p-5 shadow-2xl">
        <div className="flex items-center gap-1.5 mb-3">
          {steps.map((_, i) => (
            <span key={i} className={`h-1.5 rounded-full transition-all ${i === idx ? 'w-6 bg-violet-400' : 'w-1.5 bg-white/20'}`} />
          ))}
          <button onClick={close} className="ml-auto text-xs text-gray-500 hover:text-white">Skip ✕</button>
        </div>
        <h3 className="text-sm font-semibold text-white">{step.title}</h3>
        <p className="mt-1.5 text-sm text-gray-400 leading-relaxed">{step.body}</p>
        <div className="flex justify-between mt-4">
          <button
            onClick={() => setIdx(i => Math.max(0, i - 1))}
            disabled={idx === 0}
            className="px-3 py-1.5 text-xs text-gray-400 hover:text-white disabled:opacity-30"
          >
            ← Back
          </button>
          <button
            onClick={() => (last ? close() : setIdx(i => i + 1))}
            className="px-4 py-1.5 text-xs bg-violet-600 hover:bg-violet-500 text-white rounded-lg"
          >
            {last ? 'Done — explore' : 'Next →'}
          </button>
        </div>
      </div>
    </div>
  )
}
```

Careful with apostrophes inside single-quoted tour strings — keep the copy free of contractions or use double quotes, exactly as written above.

- [ ] **Step 2: Mount the tour in `app/(app)/vault/graph/page.tsx`**

1. Add imports: `import { VaultGraphTour } from '@/components/VaultGraphTour'`
2. Add state: `const [tourDim, setTourDim] = useState<Set<string> | null>(null)`
3. Pass to the graph: add `dimExcept={tourDim}` to the `<VaultGraph … />` props.
4. Replace the `{/* TOUR MOUNT */}` comment with:

```tsx
      {tourOpen && (
        <VaultGraphTour
          handle={graphHandle}
          onDim={setTourDim}
          onClose={() => setTourOpen(false)}
        />
      )}
```

- [ ] **Step 3: Verify**

Run: `npx tsc --noEmit; npm run lint`
Expected: clean.

Dev server: open `/vault/graph`, click "✦ What is this?". Verify: camera flies to each target, everything else dims, cards read in plain English, Back/Next/Skip work, ambient rotation stays frozen during the tour, closing restores the full view.

- [ ] **Step 4: Commit**

```powershell
git add components/VaultGraphTour.tsx "app/(app)/vault/graph/page.tsx"
git commit -m "feat(vault): guided galaxy tour — live-data spotlight walkthrough for non-operators"
```

---

### Task 7: MCP token-lean access — `mc_get_vault_item` + slim previews

**Recommended model:** Sonnet (Tier 2 — precision duplication across two files; security-sensitive filters)

**Files:**
- Modify: `lib/mcp-tools.ts` (tool definition after `mc_get_vault_context` in `MCP_TOOLS`; handler in `callTool` after the `mc_get_vault_context` block; slim the existing preview)
- Modify: `mcp-server.mjs` (same two additions in its `tools` array ~line 188 and handler chain ~line 449; same preview slim)
- Verify only (no edit expected): `app/api/mcp/route.ts` — generic dispatcher, confirm nothing per-tool lives there

**Interfaces:**
- Produces MCP tool `mc_get_vault_item(id: string)` → full item JSON; `mc_get_vault_context` results change `content` to a 200-char preview plus `truncated: boolean`.

- [ ] **Step 1: In `lib/mcp-tools.ts`, add the tool definition** immediately after the `mc_get_vault_context` entry in `MCP_TOOLS`:

```ts
  {
    name: 'mc_get_vault_item',
    description: 'Fetch ONE vault item\'s full content by id. Token-lean pattern: search with mc_get_vault_context or list with mc_browse_vault (cheap previews), then call this for the single item you actually need. Never returns encrypted or personal items.',
    scope: 'read',
    inputSchema: {
      type: 'object',
      properties: {
        id: { type: 'string', description: 'Vault item UUID from a prior search or browse result' },
      },
      required: ['id'],
    },
  },
```

- [ ] **Step 2: In `lib/mcp-tools.ts`, update the `mc_get_vault_context` definition description** to teach the two-step pattern. Replace its `description` with:

```ts
    description: 'Semantic search over vault items. Pass the current task description to get relevant skills, agent roles, and knowledge items back as 200-char previews with ids. Call mc_get_vault_item with an id to fetch full content — do NOT re-search with broader queries to see more text. Never returns encrypted or personal items.',
```

- [ ] **Step 3: In `lib/mcp-tools.ts` `callTool`, slim the preview and add the handler.** In the `mc_get_vault_context` block, change the mapped result to:

```ts
      results.map(r => ({
        id: r.id,
        type: r.type,
        title: r.title,
        content: r.content.slice(0, 200),
        truncated: r.content.length > 200,
        tags: r.tags,
      }))
```

Immediately after that `if` block, add:

```ts
  if (name === 'mc_get_vault_item') {
    const { id } = args
    if (!id) throw new Error('id is required')
    const { data, error } = await supabase
      .from('vault_items')
      .select('id, type, title, content, tags, project_id, created_at, updated_at')
      .eq('id', id)
      .eq('encrypted', false)
      .eq('is_mcp_accessible', true)
      .not('type', 'in', '(credential,personal)')
      .single()
    if (error || !data) throw new Error(`Vault item not found or not MCP-accessible: ${id}`)
    return JSON.stringify(data)
  }
```

- [ ] **Step 4: Mirror all three changes in `mcp-server.mjs`.** Add the same tool definition object (JS, no types) after the `mc_get_vault_context` entry in its `tools` array (~line 188); update that entry's `description` the same way; in the handler chain, change `content: r.content.slice(0, 500)` (~line 467) to the 200-char + `truncated` shape above, and add the same `if (name === 'mc_get_vault_item')` handler (plain JS) after the `mc_get_vault_context` block:

```js
  if (name === 'mc_get_vault_item') {
    const { id } = args
    if (!id) throw new Error('id is required')
    const { data, error } = await supabase
      .from('vault_items')
      .select('id, type, title, content, tags, project_id, created_at, updated_at')
      .eq('id', id)
      .eq('encrypted', false)
      .eq('is_mcp_accessible', true)
      .not('type', 'in', '(credential,personal)')
      .single()
    if (error || !data) throw new Error(`Vault item not found or not MCP-accessible: ${id}`)
    return JSON.stringify(data)
  }
```

- [ ] **Step 5: Confirm `app/api/mcp/route.ts` needs no change** — it dispatches via `toolsForScope` / `callTool` / `isToolAllowed` from `lib/mcp-tools.ts` with no per-tool code. Read it; if that's still true, do not edit it.

- [ ] **Step 6: Verify**

Run: `npx tsc --noEmit; node --check mcp-server.mjs`
Expected: both clean.

- [ ] **Step 7: Commit**

```powershell
git add lib/mcp-tools.ts mcp-server.mjs
git commit -m "feat(mcp): mc_get_vault_item + 200-char search previews — token-lean two-step vault access"
```

---

### Task 8: Full verification pass + docs touch-up

**Recommended model:** Sonnet (Tier 2 — verification + small doc edits)

**Files:**
- Modify: `CLAUDE.md` (project) — vault/MCP bullets
- Verify: whole feature

- [ ] **Step 1: Run everything**

```powershell
npm test; npx tsc --noEmit; npm run lint; npm run build
```
Expected: all pass with zero errors. Fix anything that fails before proceeding (and report what was fixed).

- [ ] **Step 2: Manual smoke pass** (dev server)

- `/vault`: list works, Galaxy view card present, credentials section untouched, add/edit/delete still work.
- `/vault/graph`: clusters, brightness variance visible between old and new items, twinkle + sheen animate, rotation pauses on hover and resumes after ~3s idle, hover-grow works on planets AND stars AND hubs, search/chips/project filter work, side panel opens/closes, tour runs end to end.

- [ ] **Step 3: Update project `CLAUDE.md`**

In the Tech Stack section, extend the **Vault** bullet's final sentence to: `Queried via mc_get_vault_context (semantic, 200-char previews) or mc_browse_vault (browse by type/recency), with mc_get_vault_item for full single-item fetch.`

In the **MCP server** bullet, no change needed (tool list is described generically) — verify and leave as-is.

- [ ] **Step 4: Commit**

```powershell
git add CLAUDE.md
git commit -m "docs(CLAUDE.md): document token-lean vault MCP pattern"
```

---

## Post-plan (orchestrator, not a task)

- MCP endpoint live-verification after next Vercel deploy: call `mc_get_vault_context` (expect 200-char previews) and `mc_get_vault_item` (expect full content; expect error for an encrypted item id).
- Session end: push to GitHub, `mc_update_project_status`, `decisions-sync` (architectural decision: tag-hub graph model + star/planet hierarchy + token-lean MCP pattern).
