'use client'

import { useState, useTransition } from 'react'
import { Card, CardContent } from '@/components/ui/card'
import { generateSpec, markDone, archiveTask, claimTask, completeTask } from '@/app/(app)/orchestrate/actions'
import type { Task, Project } from '@/lib/types'

const AGENTS = ['Claude Code', 'Codex', 'Manus', 'Lovable', 'Cursor'] as const

type TaskWithProject = Task & { project_name: string | null }

interface Props {
  task: TaskWithProject
  projects: Pick<Project, 'id' | 'name'>[]
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

const tierColors: Record<number, string> = {
  1: 'bg-green-100 text-green-700',
  2: 'bg-blue-100 text-blue-700',
  3: 'bg-orange-100 text-orange-700',
  4: 'bg-red-100 text-red-700',
}

export function OrchestrateItem({ task, projects }: Props) {
  const [isPending, startTransition] = useTransition()
  const [specError, setSpecError] = useState<string | null>(null)
  const [commitUrl, setCommitUrl] = useState('')
  const [showComplete, setShowComplete] = useState(false)

  const projectName =
    task.project_name ??
    projects.find(p => p.id === task.project_id)?.name ??
    null
  const hasSpec = !!task.generated_spec

  function handleGenerateSpec() {
    setSpecError(null)
    startTransition(async () => {
      const result = await generateSpec(task.id)
      if (result.error) setSpecError(result.error)
    })
  }

  function buildCopyPrompt(): string {
    return [
      `# Task: ${task.title}`,
      projectName ? `Project: ${projectName}` : '',
      '',
      task.generated_spec ?? '',
      '',
      '---',
      `Recommended tool: ${task.recommended_tool ?? 'TBD'}`,
      `Model: ${task.recommended_model ?? 'TBD'} (Tier ${task.complexity_tier ?? '?'})`,
    ].join('\n')
  }

  return (
    <Card className="flex flex-col gap-0">
      <CardContent className="pt-4 flex flex-col gap-3">
        {/* Header badges */}
        <div className="flex items-center gap-2 flex-wrap">
          {task.recommended_tool && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700">
              {task.recommended_tool}
            </span>
          )}
          {task.complexity_tier != null && (
            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${tierColors[task.complexity_tier] ?? 'bg-slate-100 text-slate-700'}`}>
              Tier {task.complexity_tier}
            </span>
          )}
          {task.agent_assigned_to && (
            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-emerald-100 text-emerald-700">
              {task.agent_assigned_to}
            </span>
          )}
          {projectName && (
            <span className="text-[10px] font-medium text-foreground/70">{projectName}</span>
          )}
          <span className="ml-auto text-[10px] text-muted-foreground/60">{timeSince(task.created_at)}</span>
        </div>

        {/* Title */}
        <p className="text-sm font-medium leading-snug">{task.title}</p>

        {/* Spec content */}
        {hasSpec && (
          <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
            {task.generated_spec}
          </div>
        )}

        {/* Error */}
        {specError && (
          <p className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">{specError}</p>
        )}

        {/* Actions */}
        <div className="flex items-center gap-2 flex-wrap">
          {!hasSpec ? (
            <button
              disabled={isPending}
              onClick={handleGenerateSpec}
              className="rounded bg-foreground px-3 py-1 text-[11px] font-medium text-background hover:bg-foreground/80 disabled:opacity-50"
            >
              {isPending ? '…' : 'Generate Spec'}
            </button>
          ) : (
            <>
              <button
                disabled={isPending}
                onClick={() => navigator.clipboard.writeText(buildCopyPrompt())}
                className="rounded bg-foreground px-3 py-1 text-[11px] font-medium text-background hover:bg-foreground/80 disabled:opacity-50"
              >
                Copy Prompt
              </button>

              {/* Claim — only show if not yet claimed */}
              {!task.agent_assigned_to && (
                <select
                  disabled={isPending}
                  defaultValue=""
                  onChange={e => {
                    const agent = e.target.value
                    if (agent) startTransition(() => claimTask(task.id, agent))
                  }}
                  className="rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground disabled:opacity-50"
                >
                  <option value="">Claim for agent…</option>
                  {AGENTS.map(a => (
                    <option key={a} value={a}>{a}</option>
                  ))}
                </select>
              )}

              {/* Complete — only show if claimed */}
              {task.agent_assigned_to && !showComplete && (
                <button
                  disabled={isPending}
                  onClick={() => setShowComplete(true)}
                  className="rounded border border-emerald-300 px-3 py-1 text-[11px] text-emerald-700 hover:bg-emerald-50 disabled:opacity-50"
                >
                  Complete
                </button>
              )}

              <button
                disabled={isPending}
                onClick={handleGenerateSpec}
                className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
              >
                Regenerate
              </button>
              <button
                disabled={isPending}
                onClick={() => startTransition(() => markDone(task.id))}
                className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
              >
                Mark Done
              </button>
            </>
          )}
          <button
            disabled={isPending}
            onClick={() => startTransition(() => archiveTask(task.id))}
            className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
          >
            Archive
          </button>
        </div>

        {/* Complete flow */}
        {showComplete && (
          <div className="flex items-center gap-2">
            <input
              type="text"
              value={commitUrl}
              onChange={e => setCommitUrl(e.target.value)}
              placeholder="GitHub commit URL (optional)"
              className="flex-1 rounded border border-input bg-background px-2 py-1 text-[11px] text-foreground placeholder:text-muted-foreground/50"
            />
            <button
              disabled={isPending}
              onClick={() => {
                setShowComplete(false)
                startTransition(() => completeTask(task.id, commitUrl))
              }}
              className="rounded bg-emerald-700 px-3 py-1 text-[11px] font-medium text-white hover:bg-emerald-800 disabled:opacity-50"
            >
              {isPending ? '…' : 'Confirm'}
            </button>
            <button onClick={() => setShowComplete(false)} className="text-[11px] text-muted-foreground hover:text-foreground">
              Cancel
            </button>
          </div>
        )}
      </CardContent>
    </Card>
  )
}
