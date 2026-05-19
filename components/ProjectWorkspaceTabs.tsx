'use client'

import { useState, useTransition } from 'react'
import { generateSuggestions } from '@/app/(app)/projects/[id]/actions'
import { ProjectChat } from '@/components/ProjectChat'
import type { Project, BrainDump, Task, ProjectChat as ProjectChatType, AgentHandoff, ProjectHealth, HealthStatus } from '@/lib/types'

const TABS = [
  { key: 'mission_brief', label: 'Mission Brief' },
  { key: 'brain_dumps',   label: 'Brain Dumps' },
  { key: 'tasks',         label: 'Tasks' },
  { key: 'handoff_log',   label: 'Handoff Log' },
] as const

type TabKey = typeof TABS[number]['key']

const HEALTH_DOT: Record<HealthStatus, string> = {
  ok:      'bg-green-400',
  warn:    'bg-yellow-400',
  error:   'bg-red-400',
  unknown: 'bg-gray-500',
}

const HANDOFF_STATUS_COLOR: Record<string, string> = {
  in_progress: 'text-yellow-400',
  done:        'text-green-400',
  failed:      'text-red-400',
  review:      'text-blue-400',
}

const dumpTypeColors: Record<string, string> = {
  idea:          'bg-blue-100 text-blue-700',
  task:          'bg-yellow-100 text-yellow-700',
  bug:           'bg-red-100 text-red-700',
  decision:      'bg-purple-100 text-purple-700',
  kill_candidate:'bg-orange-100 text-orange-700',
  unclassified:  'bg-slate-100 text-slate-600',
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

interface Props {
  project: Project
  brainDumps: BrainDump[]
  tasks: Task[]
  initialChats: ProjectChatType[]
  claudeMd: string
  decisionsMd: string
  handoffs: AgentHandoff[]
  health: ProjectHealth | null
}

export function ProjectWorkspaceTabs({ project, brainDumps, tasks, initialChats, claudeMd, decisionsMd, handoffs, health }: Props) {
  const [activeTab, setActiveTab] = useState<TabKey>('mission_brief')

  const [isPending, startTransition] = useTransition()
  const [suggestionsText, setSuggestionsText] = useState(project.lead_suggestions ?? '')
  const [suggestError, setSuggestError] = useState<string | null>(null)

  function handleRefreshSuggestions() {
    setSuggestError(null)
    startTransition(async () => {
      const result = await generateSuggestions(project.id)
      if (result.error) {
        setSuggestError(result.error)
      } else {
        setSuggestionsText(result.suggestions ?? '')
      }
    })
  }

  return (
    <div className="flex flex-col gap-6">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project.local_path && (
            <a
              href={`vscode://file/${project.local_path.replace(/\\/g, '/')}`}
              className="rounded border border-input px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40"
            >
              Open in VS Code
            </a>
          )}
          <a
            href={`/projects/${project.id}/edit`}
            className="rounded border border-input px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40"
          >
            Edit
          </a>
        </div>
      </div>

      {/* 2-column layout: tabs on left, chat always on right */}
      <div className="flex gap-6 items-start">
        {/* Left: tabbed content */}
        <div className="flex flex-col gap-4 flex-1 min-w-0">
          {/* Tab nav */}
          <div className="flex gap-1 border-b border-border">
            {TABS.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setActiveTab(key)}
                className={[
                  'px-3 py-1.5 text-sm font-medium rounded-t-md -mb-px border border-transparent transition-colors',
                  activeTab === key
                    ? 'border-border border-b-background bg-background text-foreground'
                    : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {activeTab === 'mission_brief' && (
            <div className="flex flex-col gap-6">
              {/* Health indicators */}
              {health && (
                <div className="flex items-center gap-4 rounded-md border border-border bg-muted/30 px-4 py-2.5">
                  {([
                    { label: 'GitHub',   status: health.github_status },
                    { label: 'Vercel',   status: health.vercel_status },
                    { label: 'Supabase', status: health.supabase_status },
                  ] as { label: string; status: HealthStatus }[]).map(({ label, status }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[status]}`} />
                      <span className="text-xs text-muted-foreground">{label}</span>
                      <span className="text-[10px] text-muted-foreground/50">{status}</span>
                    </div>
                  ))}
                </div>
              )}

              {/* Metadata grid */}
              <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
                {[
                  { label: 'Stage',  value: project.stage },
                  { label: 'Tier',   value: `Tier ${project.tier}` },
                  { label: 'Status', value: project.status ?? '—' },
                  { label: 'Kill',   value: project.kill_criteria_status ?? '—' },
                ].map(({ label, value }) => (
                  <div key={label} className="rounded-md border border-border bg-muted/30 px-3 py-2">
                    <p className="text-[10px] text-muted-foreground">{label}</p>
                    <p className="text-xs font-medium text-foreground">{value}</p>
                  </div>
                ))}
              </div>

              {project.next_action && (
                <div className="rounded-md bg-muted px-3 py-2 text-sm">
                  <span className="font-medium text-foreground">Next: </span>
                  <span className="text-muted-foreground">{project.next_action}</span>
                </div>
              )}

              {project.blockers && (
                <div className="rounded-md bg-red-50 px-3 py-2 text-sm">
                  <span className="font-medium text-red-700">Blocked: </span>
                  <span className="text-red-600">{project.blockers}</span>
                </div>
              )}

              {/* CLAUDE.md */}
              {claudeMd && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">CLAUDE.md</h2>
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {claudeMd}
                  </div>
                </div>
              )}

              {/* decisions.md */}
              {decisionsMd && (
                <div className="flex flex-col gap-2">
                  <h2 className="text-sm font-semibold">decisions.md</h2>
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {decisionsMd}
                  </div>
                </div>
              )}

              {/* AI Suggestions */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h2 className="text-sm font-semibold">AI Suggestions</h2>
                  <div className="flex items-center gap-2">
                    {project.suggestions_updated_at && (
                      <span className="text-[10px] text-muted-foreground/60">
                        {timeSince(project.suggestions_updated_at)}
                      </span>
                    )}
                    <button
                      disabled={isPending}
                      onClick={handleRefreshSuggestions}
                      className="rounded border border-input px-3 py-1 text-[11px] text-muted-foreground hover:text-foreground hover:border-foreground/40 disabled:opacity-50"
                    >
                      {isPending ? '…' : 'Refresh Suggestions'}
                    </button>
                  </div>
                </div>

                {suggestError && (
                  <p className="text-[11px] text-red-600 bg-red-50 rounded px-2 py-1">{suggestError}</p>
                )}

                {suggestionsText ? (
                  <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">
                    {suggestionsText}
                  </div>
                ) : (
                  <p className="text-[11px] text-muted-foreground/60 italic">
                    {isPending ? 'Generating suggestions…' : 'No suggestions yet. Click Refresh Suggestions to generate.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {activeTab === 'brain_dumps' && (
            <div className="flex flex-col gap-3">
              {brainDumps.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No brain dumps for this project yet.
                </p>
              ) : (
                brainDumps.map(dump => (
                  <div key={dump.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
                    <div className="flex items-center gap-2 flex-wrap">
                      {dump.classified_type && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${dumpTypeColors[dump.classified_type] ?? 'bg-slate-100 text-slate-600'}`}>
                          {dump.classified_type.replace('_', ' ')}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground/60">{timeSince(dump.created_at)}</span>
                    </div>
                    <p className="text-xs text-foreground leading-snug whitespace-pre-wrap">{dump.raw_text}</p>
                    {dump.ai_summary && (
                      <p className="text-[11px] text-muted-foreground italic">{dump.ai_summary}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'tasks' && (
            <div className="flex flex-col gap-3">
              {tasks.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No pending tasks. Head to <span className="font-medium text-foreground">Orchestrate</span> to manage tasks.
                </p>
              ) : (
                tasks.map(task => (
                  <div key={task.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      {task.recommended_tool && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-slate-100 text-slate-700">
                          {task.recommended_tool}
                        </span>
                      )}
                      {task.complexity_tier != null && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-100 text-blue-700">
                          Tier {task.complexity_tier}
                        </span>
                      )}
                      <span className="ml-auto text-[10px] text-muted-foreground/60">{timeSince(task.created_at)}</span>
                    </div>
                    <p className="text-sm font-medium leading-snug">{task.title}</p>
                    {task.description && (
                      <p className="text-[11px] text-muted-foreground">{task.description}</p>
                    )}
                  </div>
                ))
              )}
            </div>
          )}

          {activeTab === 'handoff_log' && (
            <div className="flex flex-col gap-3">
              {handoffs.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-12">
                  No agent sessions yet for this project.
                </p>
              ) : (
                handoffs.map(h => (
                  <div key={h.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${HANDOFF_STATUS_COLOR[h.status] ?? 'text-muted-foreground'}`}>
                        {h.agent_name}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {h.status.replace('_', ' ')}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground/60">{timeSince(h.started_at)}</span>
                    </div>
                    {h.task_description && (
                      <p className="text-xs text-foreground leading-snug">{h.task_description}</p>
                    )}
                    {h.outcome && (
                      <p className="text-[11px] text-muted-foreground">{h.outcome}</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-muted-foreground/60">
                      {h.completed_at && (
                        <span>Completed {timeSince(h.completed_at)}</span>
                      )}
                      {h.github_commit_url && (
                        <a
                          href={h.github_commit_url}
                          target="_blank"
                          rel="noopener noreferrer"
                          className="text-blue-400 hover:text-blue-300"
                        >
                          View commit →
                        </a>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}
        </div>

        {/* Right: always-visible chat panel */}
        <div className="w-[360px] shrink-0 sticky top-4">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold">Build Partner</h2>
              {project.lead_model && (
                <span className="text-[10px] text-muted-foreground/60">{project.lead_model}</span>
              )}
            </div>
            <div className="rounded-md border border-border bg-card p-3">
              <ProjectChat projectId={project.id} initialMessages={initialChats} />
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
