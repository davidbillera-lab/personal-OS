'use client'

import { useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { archiveDump, routeDump, promoteDump, reclassifyDump } from '@/app/(app)/inbox/actions'
import type { BrainDump, BrainDumpType, Project } from '@/lib/types'

const typeColors: Record<BrainDumpType, string> = {
  idea:           'bg-blue-100 text-blue-700',
  task:           'bg-yellow-100 text-yellow-700',
  bug:            'bg-red-100 text-red-700',
  decision:       'bg-purple-100 text-purple-700',
  kill_candidate: 'bg-orange-100 text-orange-700',
  unclassified:   'bg-slate-100 text-slate-600',
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

interface Props {
  dump: DumpWithProject
  projects: Pick<Project, 'id' | 'name'>[]
}

export function InboxItem({ dump, projects }: Props) {
  const [isPending, startTransition] = useTransition()

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
            onClick={() =>
              startTransition(() =>
                promoteDump(
                  dump.id,
                  dump.project_id,
                  dump.ai_summary ?? dump.raw_text.slice(0, 100)
                )
              )
            }
            className="rounded bg-foreground px-3 py-1 text-[11px] font-medium text-background hover:bg-foreground/80 disabled:opacity-50"
          >
            {isPending ? '…' : 'Promote to task'}
          </button>

          {/* Archive */}
          <button
            disabled={isPending}
            onClick={() => startTransition(() => archiveDump(dump.id))}
            className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
          >
            Archive
          </button>
        </div>
      </CardContent>
    </Card>
  )
}
