'use client'

import { useState, useTransition } from 'react'
import Link from 'next/link'
import { Card, CardContent } from '@/components/ui/card'
import { archiveDump, routeDump, promoteDump, promoteDumpAnyway, reclassifyDump, generateSpecAction } from '@/app/(app)/inbox/actions'
import type { BrainDump, BrainDumpType, Project } from '@/lib/types'

const typeColors: Record<BrainDumpType, string> = {
  idea:           'bg-blue-900/50 text-blue-400',
  task:           'bg-yellow-900/50 text-yellow-400',
  bug:            'bg-red-900/50 text-red-400',
  decision:       'bg-purple-900/50 text-purple-400',
  kill_candidate: 'bg-orange-900/50 text-orange-400',
  unclassified:   'bg-slate-800 text-slate-400',
}

const ALL_TYPES: BrainDumpType[] = ['idea', 'task', 'bug', 'decision', 'kill_candidate', 'unclassified']

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

type DumpWithProject = BrainDump & { project_name?: string | null }

type TaskRef = {
  id: string
  brain_dump_id: string | null
  generated_spec: string | null
  recommended_tool: string | null
  recommended_model: string | null
  complexity_tier: number | null
  status: string
}

interface Props {
  dump: DumpWithProject
  projects: Pick<Project, 'id' | 'name'>[]
  task?: TaskRef
}

export function InboxItem({ dump, projects, task }: Props) {
  const [isPending, startTransition] = useTransition()
  const [specPending, startSpecTransition] = useTransition()
  const [warn, setWarn] = useState<string | null>(null)
  const [copied, setCopied] = useState(false)
  const [specOpen, setSpecOpen] = useState(false)

  const displayText = dump.ai_summary ?? dump.raw_text
  const confidence = dump.classification_confidence != null
    ? `${Math.round(dump.classification_confidence * 100)}%`
    : null

  return (
    <Card className="flex flex-col gap-0">
      <CardContent className="pt-4 flex flex-col gap-3">
        {/* Header row */}
        <div className="flex items-center gap-2 flex-wrap">
          {dump.classified_type && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${typeColors[dump.classified_type]}`}>
              {dump.classified_type.replace('_', ' ')}
            </span>
          )}
          {confidence && (
            <span className="text-[10px] text-muted-foreground">{confidence} confidence</span>
          )}
          {dump.project_name && (
            <span className="text-[10px] font-medium text-foreground/70">{dump.project_name}</span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/60">{timeSince(dump.created_at)}</span>
        </div>

        {/* Body */}
        <p className="text-sm leading-snug line-clamp-2 text-foreground">
          {displayText}
        </p>

        {/* Action row */}
        <div className="flex items-center gap-2 flex-wrap">
          {/* Reclassify */}
          <select
            disabled={isPending}
            defaultValue={dump.classified_type ?? ''}
            onChange={e => {
              const val = e.target.value as BrainDumpType
              startTransition(() => reclassifyDump(dump.id, val))
            }}
            className="rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
          >
            <option value="" disabled>Reclassify…</option>
            {ALL_TYPES.map(t => (
              <option key={t} value={t}>{t.replace('_', ' ')}</option>
            ))}
          </select>

          {/* Route to project */}
          <select
            disabled={isPending}
            defaultValue={dump.project_id ?? ''}
            onChange={e => {
              const val = e.target.value
              if (val) startTransition(() => routeDump(dump.id, val))
            }}
            className="rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
          >
            <option value="">Route to project…</option>
            {projects.map(p => (
              <option key={p.id} value={p.id}>{p.name}</option>
            ))}
          </select>

          {/* Promote */}
          <button
            disabled={isPending}
            onClick={() => {
              setWarn(null)
              startTransition(async () => {
                const result = await promoteDump(
                  dump.id,
                  dump.project_id,
                  dump.ai_summary ?? dump.raw_text.slice(0, 100),
                  dump.raw_text,
                  dump.ai_summary
                )
                if (result.warn) setWarn(result.warn)
              })
            }}
            className="rounded bg-foreground px-3 py-1 text-[11px] font-medium text-background hover:bg-foreground/80 disabled:opacity-50"
          >
            {isPending ? '…' : 'Promote to task'}
          </button>

          {/* Advisory Board */}
          <Link
            href={`/inbox/${dump.id}/advisory`}
            className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            Advisory Board
          </Link>

          {/* Archive */}
          <button
            disabled={isPending}
            onClick={() => startTransition(() => archiveDump(dump.id))}
            className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
          >
            Archive
          </button>
        </div>

        {/* Validation warning */}
        {warn && (
          <div className="rounded-md bg-yellow-50 border border-yellow-200 px-3 py-2 flex flex-col gap-1.5">
            <p className="text-[11px] text-yellow-800">
              <span className="font-semibold">Flagged: </span>{warn}
            </p>
            <div className="flex items-center gap-2">
              <button
                disabled={isPending}
                onClick={() => {
                  setWarn(null)
                  startTransition(() =>
                    promoteDumpAnyway(
                      dump.id,
                      dump.project_id,
                      dump.ai_summary ?? dump.raw_text.slice(0, 100)
                    )
                  )
                }}
                className="rounded bg-yellow-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-yellow-800 disabled:opacity-50"
              >
                {isPending ? '…' : 'Promote anyway'}
              </button>
              <button
                onClick={() => setWarn(null)}
                className="text-[11px] text-yellow-700 hover:text-yellow-900"
              >
                Dismiss
              </button>
            </div>
          </div>
        )}

        {/* Generate Spec button — shown when task exists but spec not yet generated */}
        {task && !task.generated_spec && (
          <button
            disabled={specPending}
            onClick={() => {
              startSpecTransition(async () => {
                await generateSpecAction(task.id, dump.id, dump.raw_text, dump.project_id)
              })
            }}
            className="self-start rounded bg-violet-600 px-3 py-1 text-[11px] font-medium text-white hover:bg-violet-700 disabled:opacity-50"
          >
            {specPending ? 'Generating…' : 'Generate Spec'}
          </button>
        )}

        {/* Spec panel — shown when spec has been generated */}
        {task?.generated_spec && (
          <div className="rounded-lg border border-violet-500/30 bg-violet-950/30 p-3 flex flex-col gap-2">
            <div className="flex items-center gap-2 flex-wrap">
              <span className="text-[10px] font-semibold text-violet-400 uppercase tracking-wide">Spec Ready</span>
              {task.recommended_tool && (
                <span className="rounded bg-violet-900/50 px-1.5 py-0.5 text-[10px] text-violet-300">
                  {task.recommended_tool.replace('_', ' ')}
                </span>
              )}
              {task.recommended_model && (
                <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-400">
                  {task.recommended_model}
                </span>
              )}
              <div className="ml-auto flex items-center gap-2">
                <button
                  onClick={async () => {
                    await navigator.clipboard.writeText(task.generated_spec ?? '')
                    setCopied(true)
                    setTimeout(() => setCopied(false), 2000)
                  }}
                  className="text-[10px] text-violet-400 hover:text-violet-300"
                >
                  {copied ? 'Copied!' : 'Copy'}
                </button>
                <button
                  onClick={() => setSpecOpen(o => !o)}
                  className="text-[10px] text-gray-500 hover:text-gray-300"
                >
                  {specOpen ? 'Hide' : 'Show'}
                </button>
              </div>
            </div>
            {specOpen && (
              <pre className="max-h-48 overflow-y-auto rounded bg-black/40 p-2 text-[10px] text-gray-300 whitespace-pre-wrap leading-relaxed">
                {task.generated_spec}
              </pre>
            )}
          </div>
        )}
      </CardContent>
    </Card>
  )
}
