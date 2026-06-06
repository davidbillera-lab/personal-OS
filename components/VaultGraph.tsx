'use client'

import dynamic from 'next/dynamic'
import { useMemo, useCallback, useRef, useState } from 'react'
import type { VaultItemType } from '@/lib/types'
import type { VaultItemListItem } from '@/app/(app)/vault/actions'

// Dynamic import prevents SSR crash — react-force-graph-2d uses browser APIs
const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

const TYPE_COLOR: Record<VaultItemType, string> = {
  credential:       '#f59e0b',
  skill:            '#3b82f6',
  agent:            '#8b5cf6',
  personal:         '#f43f5e',
  knowledge:        '#22c55e',
  git_push:         '#64748b',
  file_snapshot:    '#64748b',
  brain_dump_mirror:'#06b6d4',
  ab_conversation:  '#a855f7',
  build_spec:       '#10b981',
  agent_session:    '#f97316',
  decision_log:     '#84cc16',
  mcp_event:        '#64748b',
}

interface GraphNode {
  id: string
  name: string
  type: VaultItemType
  val: number
  degree: number
  color: string
  item: VaultItemListItem
  x?: number
  y?: number
}

interface GraphLink {
  source: string | GraphNode
  target: string | GraphNode
}

interface Props {
  items: VaultItemListItem[]
  search: string
  selectedId: string | null
  onSelect: (item: VaultItemListItem) => void
}

// Resolve a link endpoint to its node id (force-graph mutates source/target into node objects)
function endpointId(end: string | GraphNode): string {
  return typeof end === 'object' ? end.id : end
}

// Lighten a hex color toward white by amount (0..1) — used for the glowing core
function lighten(hex: string, amount: number): string {
  const n = parseInt(hex.slice(1), 16)
  const r = (n >> 16) & 0xff
  const g = (n >> 8) & 0xff
  const b = n & 0xff
  const lr = Math.round(r + (255 - r) * amount)
  const lg = Math.round(g + (255 - g) * amount)
  const lb = Math.round(b + (255 - b) * amount)
  return `rgb(${lr},${lg},${lb})`
}

export function VaultGraph({ items, search, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [hoverId, setHoverId] = useState<string | null>(null)

  const { graphData, adjacency } = useMemo(() => {
    const links: GraphLink[] = []
    const degree = new Map<string, number>()
    const adjacency = new Map<string, Set<string>>()

    for (const item of items) {
      degree.set(item.id, 0)
      adjacency.set(item.id, new Set())
    }

    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const shared = items[i].tags.filter(t => items[j].tags.includes(t))
        if (shared.length > 0) {
          links.push({ source: items[i].id, target: items[j].id })
          degree.set(items[i].id, (degree.get(items[i].id) ?? 0) + 1)
          degree.set(items[j].id, (degree.get(items[j].id) ?? 0) + 1)
          adjacency.get(items[i].id)!.add(items[j].id)
          adjacency.get(items[j].id)!.add(items[i].id)
        }
      }
    }

    const nodes: GraphNode[] = items.map(item => {
      const d = degree.get(item.id) ?? 0
      return {
        id: item.id,
        name: item.title,
        type: item.type,
        // Degree-based sizing: well-connected nodes read as hubs
        val: 1 + d,
        degree: d,
        color: TYPE_COLOR[item.type],
        item,
      }
    })

    return { graphData: { nodes, links }, adjacency }
  }, [items])

  // The set of nodes/links to keep bright. Hover takes priority over selection.
  const focusId = hoverId ?? selectedId
  const highlightNodes = useMemo(() => {
    if (!focusId) return null
    const set = new Set<string>([focusId])
    for (const n of adjacency.get(focusId) ?? []) set.add(n)
    return set
  }, [focusId, adjacency])

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = (3 + Math.sqrt(node.val) * 2.4)
      const isSelected = node.id === selectedId
      const isHovered = node.id === hoverId
      const searchMatch = search && node.name.toLowerCase().includes(search.toLowerCase())
      const isSearching = !!search

      // Dimming: search miss, or not in the hovered/selected neighborhood
      let opacity = 1
      if (isSearching) opacity = searchMatch ? 1 : 0.12
      else if (highlightNodes) opacity = highlightNodes.has(node.id) ? 1 : 0.12

      const x = node.x ?? 0
      const y = node.y ?? 0

      // Outer glow — radial gradient halo, brighter when focused
      const glowR = r * (isHovered || isSelected ? 3.2 : 2.2)
      const glow = ctx.createRadialGradient(x, y, r * 0.5, x, y, glowR)
      glow.addColorStop(0, node.color)
      glow.addColorStop(1, 'rgba(0,0,0,0)')
      ctx.globalAlpha = opacity * (isHovered || isSelected ? 0.5 : 0.28)
      ctx.beginPath()
      ctx.arc(x, y, glowR, 0, 2 * Math.PI)
      ctx.fillStyle = glow
      ctx.fill()

      // Node body — gradient from light core to type color for a 3D/glowing feel
      ctx.globalAlpha = opacity
      const body = ctx.createRadialGradient(x - r * 0.3, y - r * 0.3, r * 0.1, x, y, r)
      body.addColorStop(0, lighten(node.color, 0.55))
      body.addColorStop(1, node.color)
      ctx.beginPath()
      ctx.arc(x, y, r, 0, 2 * Math.PI)
      ctx.fillStyle = body
      ctx.fill()

      // Selection ring
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(x, y, r + 3.5, 0, 2 * Math.PI)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 1.5
        ctx.stroke()
      }

      // Label — show when zoomed in, or always for focused/hub nodes
      const isHub = node.degree >= 4
      const showLabel = globalScale > 1 || isHovered || isSelected || (isHub && globalScale > 0.55)
      if (showLabel) {
        const label = node.name.length > 22 ? node.name.slice(0, 20) + '…' : node.name
        const fontSize = Math.max(7, 11 / globalScale)
        ctx.font = `${fontSize}px ui-sans-serif, system-ui, sans-serif`
        ctx.textAlign = 'center'
        ctx.textBaseline = 'middle'
        const ly = y + r + fontSize * 0.9 + 2

        // Subtle text shadow for legibility over links
        ctx.fillStyle = 'rgba(0,0,0,0.6)'
        ctx.fillText(label, x + 0.6, ly + 0.6)
        ctx.fillStyle = isHovered || isSelected ? '#ffffff' : 'rgba(226,232,240,0.85)'
        ctx.fillText(label, x, ly)
      }

      ctx.globalAlpha = 1
    },
    [selectedId, hoverId, search, highlightNodes]
  )

  const linkColor = useCallback(
    (link: GraphLink) => {
      if (highlightNodes) {
        const s = endpointId(link.source)
        const t = endpointId(link.target)
        const lit = highlightNodes.has(s) && highlightNodes.has(t)
        return lit ? 'rgba(148,163,184,0.55)' : 'rgba(148,163,184,0.06)'
      }
      return 'rgba(148,163,184,0.12)'
    },
    [highlightNodes]
  )

  const linkWidth = useCallback(
    (link: GraphLink) => {
      if (!highlightNodes) return 1
      const s = endpointId(link.source)
      const t = endpointId(link.target)
      return highlightNodes.has(s) && highlightNodes.has(t) ? 1.6 : 0.6
    },
    [highlightNodes]
  )

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onSelect(node.item)
    },
    [onSelect]
  )

  const handleNodeHover = useCallback((node: GraphNode | null) => {
    setHoverId(node?.id ?? null)
    if (containerRef.current) {
      containerRef.current.style.cursor = node ? 'pointer' : 'default'
    }
  }, [])

  if (items.length === 0) {
    return (
      <div className="flex items-center justify-center h-96 rounded-xl border border-white/10 bg-white/3 text-sm text-gray-500">
        No vault items to display in graph.
      </div>
    )
  }

  return (
    <div ref={containerRef} className="rounded-xl border border-white/10 bg-gray-950 overflow-hidden" style={{ height: 560 }}>
      <ForceGraph2D
        graphData={graphData as { nodes: GraphNode[]; links: GraphLink[] }}
        nodeId="id"
        nodeLabel="name"
        nodeCanvasObject={nodeCanvasObject as never}
        nodeCanvasObjectMode={() => 'replace'}
        nodeRelSize={6}
        onNodeClick={handleNodeClick as never}
        onNodeHover={handleNodeHover as never}
        linkColor={linkColor as never}
        linkWidth={linkWidth as never}
        backgroundColor="#030712"
        width={containerRef.current?.offsetWidth ?? 800}
        height={560}
        cooldownTicks={100}
        d3VelocityDecay={0.3}
      />
    </div>
  )
}
