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
  // Mirror `paused` into a ref the rAF loop reads (updated after commit, not during render).
  useEffect(() => { pausedRef.current = !!paused }, [paused])

  const galaxy = useMemo(() => buildGalaxy(items), [items])
  const galaxyRef = useRef(galaxy)
  // Mirror the latest galaxy into a ref for the rAF loop + imperative handle,
  // which read it after commit (never during render).
  useEffect(() => { galaxyRef.current = galaxy }, [galaxy])

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
