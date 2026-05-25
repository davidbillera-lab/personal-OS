'use client'

import dynamic from 'next/dynamic'
import { useMemo, useCallback, useRef, useState } from 'react'
import type { BrainDump, Task, AgentHandoff } from '@/lib/types'

const ForceGraph2D = dynamic(() => import('react-force-graph-2d'), { ssr: false })

// ─── Colors ───────────────────────────────────────────────────────────────────

const NODE_COLOR = {
  dump_idea:           '#3b82f6',
  dump_task:           '#f59e0b',
  dump_bug:            '#ef4444',
  dump_decision:       '#8b5cf6',
  dump_kill_candidate: '#f97316',
  dump_unclassified:   '#6b7280',
  task_pending:        '#f59e0b',
  task_in_progress:    '#f97316',
  task_review:         '#0ea5e9',
  task_done:           '#22c55e',
  handoff:             '#9ca3af',
}

// ─── Types ────────────────────────────────────────────────────────────────────

type NodeKind = 'dump' | 'task' | 'handoff'

interface GraphNode {
  id: string
  kind: NodeKind
  label: string
  sublabel?: string
  color: string
  val: number
  x?: number
  y?: number
  // original data
  dump?: BrainDump
  task?: Task
  handoff?: AgentHandoff
}

interface GraphLink {
  source: string
  target: string
}

interface SelectedNode {
  kind: NodeKind
  label: string
  sublabel?: string
  body?: string
  meta?: string
}

interface Props {
  brainDumps: BrainDump[]
  tasks: Task[]
  doneTasks: Task[]
  handoffs: AgentHandoff[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function dumpColor(dump: BrainDump): string {
  const key = `dump_${dump.classified_type ?? 'unclassified'}` as keyof typeof NODE_COLOR
  return NODE_COLOR[key] ?? NODE_COLOR.dump_unclassified
}

function taskColor(task: Task): string {
  const key = `task_${task.status}` as keyof typeof NODE_COLOR
  return NODE_COLOR[key] ?? NODE_COLOR.task_pending
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── Legend item ──────────────────────────────────────────────────────────────

function Dot({ color, label }: { color: string; label: string }) {
  return (
    <div className="flex items-center gap-1.5">
      <span className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: color }} />
      <span className="text-[10px] text-gray-500">{label}</span>
    </div>
  )
}

// ─── Component ────────────────────────────────────────────────────────────────

export function ProjectGraph({ brainDumps, tasks, doneTasks, handoffs }: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const [selected, setSelected] = useState<SelectedNode | null>(null)

  const allTasks = useMemo(() => [...tasks, ...doneTasks], [tasks, doneTasks])

  const graphData = useMemo(() => {
    const nodes: GraphNode[] = []
    const links: GraphLink[] = []

    // Dump nodes
    for (const dump of brainDumps) {
      nodes.push({
        id: `dump:${dump.id}`,
        kind: 'dump',
        label: dump.ai_summary
          ? dump.ai_summary.slice(0, 40)
          : dump.raw_text.slice(0, 40),
        sublabel: dump.classified_type ?? 'unclassified',
        color: dumpColor(dump),
        val: 2,
        dump,
      })
    }

    // Task nodes
    for (const task of allTasks) {
      nodes.push({
        id: `task:${task.id}`,
        kind: 'task',
        label: task.title.slice(0, 40),
        sublabel: task.status.replace(/_/g, ' '),
        color: taskColor(task),
        val: 3,
        task,
      })

      // dump → task edge
      if (task.brain_dump_id) {
        links.push({ source: `dump:${task.brain_dump_id}`, target: `task:${task.id}` })
      }
    }

    // Handoff nodes
    for (const h of handoffs) {
      nodes.push({
        id: `handoff:${h.id}`,
        kind: 'handoff',
        label: h.agent_name,
        sublabel: h.status.replace(/_/g, ' '),
        color: NODE_COLOR.handoff,
        val: 1.5,
        handoff: h,
      })

      // task → handoff edge
      if (h.task_id) {
        links.push({ source: `task:${h.task_id}`, target: `handoff:${h.id}` })
      }
    }

    return { nodes, links }
  }, [brainDumps, allTasks, handoffs])

  const nodeCanvasObject = useCallback(
    (node: GraphNode, ctx: CanvasRenderingContext2D, globalScale: number) => {
      const r = Math.sqrt(node.val) * 5
      const isSelected = selected?.label === node.label && selected?.sublabel === node.sublabel

      ctx.beginPath()
      ctx.arc(node.x ?? 0, node.y ?? 0, r, 0, 2 * Math.PI)
      ctx.fillStyle = node.color
      ctx.fill()

      if (isSelected) {
        ctx.beginPath()
        ctx.arc(node.x ?? 0, node.y ?? 0, r + 3, 0, 2 * Math.PI)
        ctx.strokeStyle = '#ffffff'
        ctx.lineWidth = 2
        ctx.stroke()
      }

      if (globalScale > 0.7) {
        const label = node.label.length > 22 ? node.label.slice(0, 20) + '…' : node.label
        const fontSize = Math.max(7, 11 / globalScale)
        ctx.font = `${fontSize}px sans-serif`
        ctx.fillStyle = 'rgba(255,255,255,0.8)'
        ctx.textAlign = 'center'
        ctx.fillText(label, node.x ?? 0, (node.y ?? 0) + r + fontSize + 2)
      }
    },
    [selected]
  )

  const handleNodeClick = useCallback((node: GraphNode) => {
    if (node.dump) {
      setSelected({
        kind: 'dump',
        label: node.dump.ai_summary ?? node.dump.raw_text.slice(0, 80),
        sublabel: `${node.dump.classified_type ?? 'unclassified'} · ${timeSince(node.dump.created_at)}`,
        body: node.dump.raw_text,
        meta: node.dump.ab_verdict ? `Advisory: ${node.dump.ab_verdict}` : undefined,
      })
    } else if (node.task) {
      setSelected({
        kind: 'task',
        label: node.task.title,
        sublabel: `${node.task.status.replace(/_/g, ' ')} · ${timeSince(node.task.created_at)}`,
        body: node.task.description ?? node.task.generated_spec?.slice(0, 300) ?? undefined,
        meta: node.task.agent_assigned_to ? `Agent: ${node.task.agent_assigned_to}` : undefined,
      })
    } else if (node.handoff) {
      setSelected({
        kind: 'handoff',
        label: node.handoff.agent_name,
        sublabel: `${node.handoff.status.replace(/_/g, ' ')} · ${timeSince(node.handoff.started_at)}`,
        body: node.handoff.outcome ?? undefined,
        meta: node.handoff.github_commit_url ? `Commit: ${node.handoff.github_commit_url}` : undefined,
      })
    }
  }, [])

  const totalNodes = graphData.nodes.length
  if (totalNodes === 0) {
    return (
      <div className="flex items-center justify-center h-96 rounded-xl border border-white/10 bg-white/3 text-sm text-gray-500">
        No data yet — add brain dumps and tasks to see the graph.
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-3">
      {/* Legend */}
      <div className="flex flex-wrap gap-3 px-1">
        <Dot color={NODE_COLOR.dump_idea}           label="Dump: idea" />
        <Dot color={NODE_COLOR.dump_task}            label="Dump: task" />
        <Dot color={NODE_COLOR.dump_bug}             label="Dump: bug" />
        <Dot color={NODE_COLOR.dump_decision}        label="Dump: decision" />
        <Dot color={NODE_COLOR.task_pending}         label="Task: pending" />
        <Dot color={NODE_COLOR.task_in_progress}     label="Task: in flight" />
        <Dot color={NODE_COLOR.task_review}          label="Task: review" />
        <Dot color={NODE_COLOR.task_done}            label="Task: done" />
        <Dot color={NODE_COLOR.handoff}              label="Agent handoff" />
      </div>

      <div className="flex gap-3 items-start">
        {/* Graph canvas */}
        <div
          ref={containerRef}
          className="flex-1 rounded-xl border border-white/10 bg-gray-950 overflow-hidden"
          style={{ height: 520 }}
        >
          <ForceGraph2D
            graphData={graphData as { nodes: GraphNode[]; links: GraphLink[] }}
            nodeId="id"
            nodeLabel="label"
            nodeCanvasObject={nodeCanvasObject as never}
            nodeCanvasObjectMode={() => 'replace'}
            onNodeClick={handleNodeClick as never}
            linkColor={() => 'rgba(255,255,255,0.12)'}
            linkWidth={1.5}
            backgroundColor="#030712"
            width={containerRef.current?.offsetWidth ?? 700}
            height={520}
            cooldownTicks={100}
            linkDirectionalArrowLength={4}
            linkDirectionalArrowRelPos={1}
          />
        </div>

        {/* Detail panel */}
        {selected && (
          <div className="w-56 shrink-0 rounded-xl border border-white/10 bg-white/5 p-4 flex flex-col gap-2">
            <div className="flex items-start justify-between gap-1">
              <div>
                <p className="text-xs font-semibold text-white leading-snug">{selected.label}</p>
                {selected.sublabel && (
                  <p className="text-[10px] text-gray-500 mt-0.5">{selected.sublabel}</p>
                )}
              </div>
              <button
                onClick={() => setSelected(null)}
                className="text-gray-600 hover:text-gray-400 shrink-0 text-xs leading-none mt-0.5"
              >
                ✕
              </button>
            </div>
            {selected.body && (
              <p className="text-[11px] text-gray-400 leading-relaxed border-t border-white/10 pt-2 max-h-64 overflow-y-auto whitespace-pre-wrap">
                {selected.body.slice(0, 600)}{selected.body.length > 600 ? '…' : ''}
              </p>
            )}
            {selected.meta && (
              <p className="text-[10px] text-gray-600 font-mono break-all border-t border-white/10 pt-2">
                {selected.meta}
              </p>
            )}
          </div>
        )}
      </div>

      <p className="text-[10px] text-gray-700 px-1">
        {totalNodes} nodes · {graphData.links.length} connections · click a node to inspect
      </p>
    </div>
  )
}
