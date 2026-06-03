'use client'

import dynamic from 'next/dynamic'
import { useMemo, useCallback, useRef } from 'react'
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
  color: string
  item: VaultItemListItem
  x?: number
  y?: number
}

interface GraphLink {
  source: string
  target: string
}

interface Props {
  items: VaultItemListItem[]
  search: string
  selectedId: string | null
  onSelect: (item: VaultItemListItem) => void
}

export function VaultGraph({ items, search, selectedId, onSelect }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = items.map(item => ({
      id: item.id,
      name: item.title,
      type: item.type,
      val: Math.max(1, item.tags.length) + 1,
      color: TYPE_COLOR[item.type],
      item,
    }))

    const links: GraphLink[] = []
    for (let i = 0; i < items.length; i++) {
      for (let j = i + 1; j < items.length; j++) {
        const shared = items[i].tags.filter(t => items[j].tags.includes(t))
        if (shared.length > 0) {
          links.push({ source: items[i].id, target: items[j].id })
        }
      }
    }

    return { nodes, links }
  }, [items])

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = Math.sqrt(node.val) * 4
      const isSelected = node.id === selectedId
      const searchMatch = search && node.name.toLowerCase().includes(search.toLowerCase())
      const isSearching = !!search
      const opacity = isSearching ? (searchMatch ? 1 : 0.15) : 1

      ctx.globalAlpha = opacity

      // Node circle
      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.fill()

      // Selection ring
      if (isSelected) {
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, r + 3, 0, 2 * Math.PI)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      // Label (only when zoomed in enough)
      if (globalScale > 0.8) {
        const label = node.name.length > 20 ? node.name.slice(0, 18) + '…' : node.name
        const fontSize = Math.max(8, 12 / globalScale)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.85)'
        ctx.textAlign = 'center'
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + fontSize + 2)
      }

      ctx.globalAlpha = 1
    },
    [selectedId, search]
  )

  const handleNodeClick = useCallback(
    (node: GraphNode) => {
      onSelect(node.item)
    },
    [onSelect]
  )

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
        onNodeClick={handleNodeClick as never}
        linkColor={() => 'rgba(255,255,255,0.1)'}
        linkWidth={1}
        backgroundColor="#030712"
        width={containerRef.current?.offsetWidth ?? 800}
        height={560}
        cooldownTicks={80}
      />
    </div>
  )
}
