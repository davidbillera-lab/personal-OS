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

export const TYPE_COLOR: Record<VaultItemType, string> = {
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

const ROTATION_RAD_PER_SEC = (2 * Math.PI) / 150   // one revolution ≈ 2.5 minutes — visibly alive
const IDLE_RESUME_MS = 3000                        // rotation resumes this long after last interaction
const READING_ZOOM = 1.3                           // zoomed past this = reading; rotation stays off

// Deterministic PRNG so the backdrop starfield is stable across renders
function mulberry32(seed: number) {
  let a = seed
  return () => {
    a |= 0; a = (a + 0x6d2b79f5) | 0
    let t = Math.imul(a ^ (a >>> 15), 1 | a)
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

interface BackdropStar { x: number; y: number; r: number; a: number; ph: number; sp: number }

function makeBackdrop(): BackdropStar[] {
  const rand = mulberry32(1337)
  return Array.from({ length: 240 }, () => ({
    x: rand(), y: rand(),
    r: 0.3 + rand() * 1.1,
    a: 0.12 + rand() * 0.45,
    ph: rand() * Math.PI * 2,
    sp: 0.4 + rand() * 1.2,
  }))
}

const NEBULAE: { x: number; y: number; r: number; color: string }[] = [
  { x: 0.72, y: 0.22, r: 0.55, color: '139,92,246' },  // violet
  { x: 0.18, y: 0.68, r: 0.5,  color: '59,130,246' },  // blue
  { x: 0.55, y: 0.92, r: 0.45, color: '6,182,212' },   // cyan
]

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
  onSelectHub?: (hubId: string) => void
  dimExcept?: Set<string> | null
  paused?: boolean
  handleRef?: MutableRefObject<VaultGraphHandle | null>
}

// force-graph mutates link source/target into node objects and adds sim fields
type FgMethods = {
  centerAt: (x?: number, y?: number, ms?: number) => void
  zoom: (k?: number, ms?: number) => void
  zoomToFit: (ms?: number, px?: number) => void
  d3Force: (name: string) => unknown
  d3ReheatSimulation?: () => void
}

export function VaultGraph({ items, search, selectedId, onSelect, onSelectHub, dimExcept, paused, handleRef }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const fgRef = useRef<FgMethods | null>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)
  const [size, setSize] = useState({ w: 800, h: 600 })
  const sizeRef = useRef(size)
  useEffect(() => { sizeRef.current = size }, [size])
  const backdrop = useMemo(() => makeBackdrop(), [])
  const didFit = useRef(false)

  // Refs for values the rAF/draw loop reads every frame (avoid re-creating callbacks)
  const hoverIdRef = useRef<string | null>(null)
  const hoverGrow = useRef(new Map<string, number>())   // nodeId -> 0..1 grow progress
  const lastInteraction = useRef(0)
  const zoomLevel = useRef(1)
  const dragging = useRef(false)
  const rotSpeed = useRef(0)                            // eased 0..1 rotation factor
  const reducedMotion = useRef(false)
  const pausedRef = useRef(false)
  // Mirror `paused` into a ref the rAF loop reads (updated after commit, not during render).
  useEffect(() => { pausedRef.current = !!paused }, [paused])

  const galaxy = useMemo(() => buildGalaxy(items), [items])
  // Re-fit the viewport whenever the node set changes (filters, reload)
  useEffect(() => { didFit.current = false }, [galaxy])
  const galaxyRef = useRef(galaxy)
  // Mirror the latest galaxy into a ref for the rAF loop + imperative handle,
  // which read it after commit (never during render).
  useEffect(() => { galaxyRef.current = galaxy }, [galaxy])

  // Rotation-invariant framing: fit the galaxy's bounding CIRCLE around its
  // centroid, not its bounding box — the ambient rotation sweeps the layout
  // through every angle, so a box fit clips corners at "weird angles" while
  // a circle fit never does.
  const frameGalaxy = useCallback((ms = 700) => {
    const fg = fgRef.current
    const nodes = galaxyRef.current.nodes
    if (!fg || nodes.length === 0) return
    let cx = 0, cy = 0, n = 0
    for (const node of nodes) {
      if (node.x !== undefined && node.y !== undefined) { cx += node.x; cy += node.y; n++ }
    }
    if (n === 0) return
    cx /= n; cy /= n
    let maxR = 0
    for (const node of nodes) {
      if (node.x === undefined || node.y === undefined) continue
      const d = Math.hypot(node.x - cx, node.y - cy) + node.radius * 2
      if (d > maxR) maxR = d
    }
    const { w, h } = sizeRef.current
    // 72px breathing room: clears the toolbar and keeps labels off the edges
    const k = Math.min(Math.max((Math.min(w, h) - 144) / (2 * Math.max(maxR, 1)), 0.05), 4)
    fg.centerAt(cx, cy, ms)
    fg.zoom(k, ms)
  }, [])

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
      zoomToFit: (ms = 800) => frameGalaxy(ms),
      getGalaxy: () => galaxyRef.current,
    }
    return () => { handleRef.current = null }
  }, [handleRef, frameGalaxy])

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

  // Spread the clusters: stronger repulsion + longer leashes = real void between
  // territories, so the map reads as space instead of a huddle. The force graph
  // mounts async (next/dynamic), so retry until the ref is live.
  useEffect(() => {
    let tries = 0
    const id = setInterval(() => {
      const fg = fgRef.current
      tries++
      if (fg?.d3Force) {
        const charge = fg.d3Force('charge') as { strength?: (v: number) => void } | undefined
        charge?.strength?.(-140)
        const link = fg.d3Force('link') as { distance?: (v: number) => void } | undefined
        link?.distance?.(45)
        fg.d3ReheatSimulation?.()
        clearInterval(id)
      } else if (tries > 50) clearInterval(id)
    }, 100)
    return () => clearInterval(id)
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

  // Deep-space backdrop drawn in screen space (unaffected by pan/zoom):
  // faint nebula washes + a twinkling starfield behind the whole galaxy.
  const renderBackdrop = useCallback(
    (ctx: CanvasRenderingContext2D) => {
      const t = performance.now()
      const { w, h } = sizeRef.current
      ctx.save()
      const dpr = window.devicePixelRatio || 1
      ctx.setTransform(dpr, 0, 0, dpr, 0, 0)
      for (const neb of NEBULAE) {
        const nx = neb.x * w, ny = neb.y * h, nr = neb.r * Math.max(w, h)
        const g = ctx.createRadialGradient(nx, ny, 0, nx, ny, nr)
        g.addColorStop(0, `rgba(${neb.color},0.07)`)
        g.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = g
        ctx.fillRect(nx - nr, ny - nr, nr * 2, nr * 2)
      }
      ctx.fillStyle = '#e2e8f0'
      for (const s of backdrop) {
        const tw = 0.65 + 0.35 * Math.sin(t / 1000 * s.sp + s.ph)
        ctx.globalAlpha = s.a * tw
        ctx.beginPath()
        ctx.arc(s.x * w, s.y * h, s.r, 0, 2 * Math.PI)
        ctx.fill()
      }
      ctx.globalAlpha = 1
      ctx.restore()
    },
    [backdrop]
  )

  const nodeCanvasObject = useCallback(
    (node: GalaxyNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const t = performance.now()
      const x = node.x ?? 0, y = node.y ?? 0
      const isSelected = node.id === selectedId
      const isHovered = node.id === hoverIdRef.current

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

      // Age brightness + star twinkle (per-node flicker, phase-offset)
      let bright = node.brightness
      if (node.cls === 'star') bright *= 0.65 + 0.35 * Math.sin(t / 900 + node.phase * 3)
      const alpha = vis * Math.min(bright + grow * 0.3, 1)

      if (node.cls === 'hub') {
        // Tag hubs are suns: white-hot core, violet corona, slow breathing pulse
        const pulse = 1 + 0.08 * Math.sin(t / 1600 + node.phase)
        const coronaR = r * (isHovered ? 3.6 : 2.8) * pulse
        const corona = ctx.createRadialGradient(x, y, r * 0.3, x, y, coronaR)
        corona.addColorStop(0, 'rgba(196,132,252,0.5)')
        corona.addColorStop(0.5, 'rgba(139,92,246,0.18)')
        corona.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = alpha
        ctx.beginPath(); ctx.arc(x, y, coronaR, 0, 2 * Math.PI)
        ctx.fillStyle = corona; ctx.fill()

        const body = ctx.createRadialGradient(x - r * 0.2, y - r * 0.2, 0, x, y, r)
        body.addColorStop(0, '#fdf4ff')
        body.addColorStop(0.45, '#d8b4fe')
        body.addColorStop(1, '#7c3aed')
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = body; ctx.fill()

        // Territory labels: visible from far out — these ARE the map
        if (globalScale > 0.3 || isHovered) {
          const fontSize = Math.max(9, 12 / globalScale)
          ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
          ctx.textAlign = 'center'; ctx.textBaseline = 'middle'
          ctx.fillStyle = `rgba(216,180,254,${0.9 * vis})`
          ctx.fillText(node.label, x, y - coronaR / pulse - fontSize * 0.6)
        }
        ctx.globalAlpha = 1
        return
      }

      const color = TYPE_COLOR[node.type!] ?? '#94a3b8'

      if (node.cls === 'star') {
        // Distant star: point of light, brightness = age; young stars get a glint cross
        ctx.globalAlpha = alpha
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = lighten(color, 0.45); ctx.fill()
        if (node.brightness > 0.45 || isHovered) {
          ctx.globalAlpha = alpha * 0.5
          ctx.strokeStyle = lighten(color, 0.6); ctx.lineWidth = 0.5
          const g = r * 2.6
          ctx.beginPath()
          ctx.moveTo(x - g, y); ctx.lineTo(x + g, y)
          ctx.moveTo(x, y - g); ctx.lineTo(x, y + g)
          ctx.stroke()
          ctx.globalAlpha = alpha
        }
        if (isHovered || isSelected) {
          ctx.beginPath(); ctx.arc(x, y, r + 2.5 / globalScale, 0, 2 * Math.PI)
          ctx.strokeStyle = 'rgba(226,232,240,0.8)'; ctx.lineWidth = 0.8 / globalScale; ctx.stroke()
        }
      } else {
        // Planet: glow halo (pulses while fresh) → optional back ring → gradient
        // body with drifting sheen → surface variant → terminator → front ring
        const pulse = node.fresh ? 1 + 0.15 * Math.sin(t / 900 + node.phase) : 1
        const glowR = r * (isHovered || isSelected ? 3 : 2.2) * pulse
        const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR)
        glow.addColorStop(0, color); glow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.globalAlpha = alpha * (isHovered || isSelected ? 0.55 : node.fresh ? 0.42 : 0.28)
        ctx.beginPath(); ctx.arc(x, y, glowR, 0, 2 * Math.PI)
        ctx.fillStyle = glow; ctx.fill()

        const ringed = node.variant === 'ringed'
        const tilt = -0.35 + (node.phase % 1) * 0.5
        if (ringed) {
          // Back half of the ring, hidden later by the body's top arc
          ctx.globalAlpha = alpha * 0.55
          ctx.strokeStyle = lighten(color, 0.35); ctx.lineWidth = r * 0.16
          ctx.beginPath(); ctx.ellipse(x, y, r * 1.9, r * 0.55, tilt, Math.PI, 2 * Math.PI)
          ctx.stroke()
        }

        // Sheen: the gradient highlight slowly drifts — light moving across the surface
        const sheenA = t / 3000 + node.phase
        const hx = x + Math.cos(sheenA) * r * 0.4
        const hy = y + Math.sin(sheenA) * r * 0.4
        ctx.globalAlpha = alpha
        const body = ctx.createRadialGradient(hx, hy, r * 0.1, x, y, r)
        body.addColorStop(0, lighten(color, 0.65))
        body.addColorStop(0.55, color)
        body.addColorStop(1, darken(color, 0.45))
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI)
        ctx.fillStyle = body; ctx.fill()

        // Surface details, clipped to the disc
        ctx.save()
        ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.clip()
        if (node.variant === 'banded') {
          ctx.globalAlpha = alpha * 0.3
          ctx.fillStyle = darken(color, 0.4)
          for (const [oy, hgt] of [[-0.45, 0.16], [0.05, 0.22], [0.5, 0.14]] as const) {
            ctx.fillRect(x - r, y + oy * r - (hgt * r) / 2, r * 2, hgt * r)
          }
          ctx.globalAlpha = alpha * 0.2
          ctx.fillStyle = lighten(color, 0.5)
          ctx.fillRect(x - r, y - 0.25 * r, r * 2, 0.1 * r)
        } else if (node.variant === 'swirl') {
          // Great-storm eye, drifting slowly around the disc
          const sa = t / 9000 + node.phase * 2
          const sx = x + Math.cos(sa) * r * 0.45, sy = y + Math.sin(sa) * r * 0.35
          ctx.globalAlpha = alpha * 0.4
          ctx.fillStyle = lighten(color, 0.45)
          ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.32, r * 0.2, sa, 0, 2 * Math.PI); ctx.fill()
          ctx.globalAlpha = alpha * 0.25
          ctx.fillStyle = darken(color, 0.35)
          ctx.beginPath(); ctx.ellipse(sx, sy, r * 0.16, r * 0.1, sa, 0, 2 * Math.PI); ctx.fill()
        }
        // Day/night terminator: dark limb opposite the sheen highlight
        ctx.globalAlpha = alpha * 0.45
        const shadow = ctx.createRadialGradient(
          x - Math.cos(sheenA) * r * 0.9, y - Math.sin(sheenA) * r * 0.9, r * 0.3,
          x - Math.cos(sheenA) * r * 0.9, y - Math.sin(sheenA) * r * 0.9, r * 1.8
        )
        shadow.addColorStop(0, 'rgba(2,6,23,0.9)')
        shadow.addColorStop(0.55, 'rgba(2,6,23,0.35)')
        shadow.addColorStop(1, 'rgba(0,0,0,0)')
        ctx.fillStyle = shadow
        ctx.fillRect(x - r, y - r, r * 2, r * 2)
        ctx.restore()

        if (ringed) {
          ctx.globalAlpha = alpha * 0.85
          ctx.strokeStyle = lighten(color, 0.35); ctx.lineWidth = r * 0.16
          ctx.beginPath(); ctx.ellipse(x, y, r * 1.9, r * 0.55, tilt, 0, Math.PI)
          ctx.stroke()
          ctx.globalAlpha = alpha * 0.35
          ctx.strokeStyle = lighten(color, 0.6); ctx.lineWidth = r * 0.05
          ctx.beginPath(); ctx.ellipse(x, y, r * 2.15, r * 0.62, tilt, 0, Math.PI)
          ctx.stroke()
        }
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
    else if (node.cls === 'hub') onSelectHub?.(node.id)
  }, [onSelect, onSelectHub])

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
        warmupTicks={60}
        cooldownTicks={120}
        d3VelocityDecay={0.3}
        autoPauseRedraw={false}
        onRenderFramePre={renderBackdrop as never}
        onEngineStop={(() => {
          // First settle after a data change: frame the whole galaxy
          if (!didFit.current) {
            didFit.current = true
            frameGalaxy(700)
          }
        }) as never}
      />
    </div>
  )
}
