'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import {
  runAdvisoryBoard,
  generateSpec,
  approveSpec,
  runCodexQC,
  markTaskDone,
  generateSuggestions,
  createProjectBrainDump,
} from '@/app/(app)/projects/[id]/actions'
import { ProjectChat } from '@/components/ProjectChat'
import type {
  Project,
  BrainDump,
  Task,
  ProjectChat as ProjectChatType,
  AgentHandoff,
  ProjectHealth,
  HealthStatus,
  CodexQcStatus,
} from '@/lib/types'

// ─── Constants ────────────────────────────────────────────────────────────────

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
  idea:           'bg-blue-900/40 text-blue-300',
  task:           'bg-yellow-900/40 text-yellow-300',
  bug:            'bg-red-900/40 text-red-300',
  decision:       'bg-purple-900/40 text-purple-300',
  kill_candidate: 'bg-orange-900/40 text-orange-300',
  unclassified:   'bg-gray-800 text-gray-400',
}

const QC_STATUS_COLOR: Record<CodexQcStatus, string> = {
  pending:       'bg-gray-700 text-gray-300',
  passed:        'bg-green-900/40 text-green-300',
  issues_found:  'bg-red-900/40 text-red-300',
  loop_detected: 'bg-orange-900/40 text-orange-300',
}

// ─── Types ────────────────────────────────────────────────────────────────────

type ActiveStage = 'dumps' | 'spec_review' | 'in_flight' | 'done' | 'mission_brief' | 'handoff_log'

interface Props {
  project: Project
  brainDumps: BrainDump[]
  tasks: Task[]
  doneTasks: Task[]
  initialChats: ProjectChatType[]
  claudeMd: string
  decisionsMd: string
  handoffs: AgentHandoff[]
  health: ProjectHealth | null
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

// ─── CodexQCForm inline component ────────────────────────────────────────────

function CodexQCForm({ taskId, projectId }: { taskId: string; projectId: string }) {
  const [diff, setDiff] = useState('')
  const [commitUrl, setCommitUrl] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ status: string; notes: string } | null>(null)
  const [error, setError] = useState<string | null>(null)

  function handleRun() {
    if (!diff.trim() || isPending) return
    setError(null)
    setResult(null)
    startTransition(async () => {
      const res = await runCodexQC(taskId, projectId, diff, commitUrl || undefined)
      if (res.error) {
        setError(res.error)
      } else {
        setResult({ status: res.status ?? '', notes: res.notes ?? '' })
      }
    })
  }

  return (
    <div className="flex flex-col gap-2 mt-2 border-t border-white/10 pt-2">
      <p className="text-[10px] text-gray-500 uppercase tracking-wide">Codex QC</p>
      <textarea
        value={diff}
        onChange={e => setDiff(e.target.value)}
        disabled={isPending}
        placeholder="Paste git diff here…"
        rows={4}
        className="resize-none rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
      />
      <input
        type="text"
        value={commitUrl}
        onChange={e => setCommitUrl(e.target.value)}
        disabled={isPending}
        placeholder="Commit URL (optional)"
        className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-gray-200 placeholder:text-gray-600 focus:outline-none focus:ring-1 focus:ring-white/20 disabled:opacity-50"
      />
      <button
        onClick={handleRun}
        disabled={isPending || !diff.trim()}
        className="self-start rounded bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20 disabled:opacity-40"
      >
        {isPending ? 'Running…' : 'Run Codex QC'}
      </button>
      {error && (
        <p className="text-[11px] text-red-400 bg-red-900/20 rounded px-2 py-1">{error}</p>
      )}
      {result && (
        <div className="rounded border border-white/10 bg-white/5 px-2 py-1.5 text-[11px] text-gray-300">
          <span className={`font-medium mr-1 ${result.status === 'passed' ? 'text-green-400' : 'text-red-400'}`}>
            {result.status === 'passed' ? 'Passed' : 'Issues Found'}
          </span>
          {result.notes}
        </div>
      )}
    </div>
  )
}

// ─── NewDumpForm ──────────────────────────────────────────────────────────────

function NewDumpForm({ projectId, onCreated }: { projectId: string; onCreated: () => void }) {
  const [text, setText] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState('')

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!text.trim()) return
    setLoading(true)
    setError('')
    const result = await createProjectBrainDump(projectId, text.trim())
    if (result.error) {
      setError(result.error)
      setLoading(false)
      return
    }
    setText('')
    setLoading(false)
    onCreated()
  }

  return (
    <form onSubmit={handleSubmit} className="space-y-3 mb-6">
      <textarea
        value={text}
        onChange={e => setText(e.target.value)}
        placeholder="Brain dump here — idea, task, bug, decision, kill candidate..."
        rows={4}
        className="w-full rounded-lg border border-white/10 bg-white/[0.04] px-3 py-2 text-sm text-white placeholder:text-gray-600 resize-none focus:outline-none focus:border-violet-500/50"
      />
      {error && <p className="text-xs text-red-400">{error}</p>}
      <button
        type="submit"
        disabled={loading || !text.trim()}
        className="px-4 py-1.5 rounded-md text-sm font-medium bg-violet-600 hover:bg-violet-500 text-white disabled:opacity-40"
      >
        {loading ? 'Saving...' : 'Submit Brain Dump'}
      </button>
    </form>
  )
}

// ─── DumpCard ─────────────────────────────────────────────────────────────────

function DumpCard({
  dump,
  project,
  claudeMd,
  decisionsMd,
}: {
  dump: BrainDump
  project: Project
  claudeMd: string
  decisionsMd: string
}) {
  const [isPendingAB, startAB] = useTransition()
  const [isPendingSpec, startSpec] = useTransition()
  const [abVerdict, setAbVerdict] = useState<string | null>(dump.ab_verdict ?? null)
  const [abReasoning, setAbReasoning] = useState<string | null>(dump.ab_reasoning ?? null)
  const [specError, setSpecError] = useState<string | null>(null)
  const [specDone, setSpecDone] = useState(false)

  function handleRunAB() {
    startAB(async () => {
      const res = await runAdvisoryBoard(dump.id, project.id)
      if (!('error' in res)) {
        setAbVerdict(res.verdict)
        setAbReasoning(res.reasoning)
      }
    })
  }

  function handleGenerateSpec() {
    setSpecError(null)
    startSpec(async () => {
      const res = await generateSpec(dump.id, project.id, claudeMd, decisionsMd)
      if ('error' in res && res.error) {
        setSpecError(res.error)
      } else {
        setSpecDone(true)
      }
    })
  }

  const verdict = abVerdict ?? dump.ab_verdict
  const reasoning = abReasoning ?? dump.ab_reasoning

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
      {/* Header row */}
      <div className="flex items-center gap-2 flex-wrap">
        {dump.classified_type && (
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${dumpTypeColors[dump.classified_type] ?? 'bg-gray-800 text-gray-400'}`}>
            {dump.classified_type.replace('_', ' ')}
          </span>
        )}
        {dump.project_id && (
          <span className="rounded px-1.5 py-0.5 text-[10px] bg-white/10 text-gray-400">
            project assigned
          </span>
        )}
        <span className="ml-auto text-[10px] text-gray-600">{timeSince(dump.created_at)}</span>
      </div>

      {/* Raw text */}
      <p className="text-xs text-gray-200 leading-snug whitespace-pre-wrap">{dump.raw_text}</p>

      {/* AB verdict */}
      {verdict && verdict !== 'pending' && (
        <div className="flex flex-col gap-1">
          <span className={`text-xs font-semibold ${verdict === 'keep' ? 'text-green-400' : 'text-red-400'}`}>
            {verdict === 'keep' ? 'KEEP ✓' : 'KILL ✗'}
          </span>
          {reasoning && (
            <p className="text-[11px] text-gray-400 leading-relaxed">{reasoning}</p>
          )}
        </div>
      )}

      {/* Actions */}
      <div className="flex items-center gap-2 flex-wrap pt-1">
        {!verdict || verdict === 'pending' ? (
          <button
            onClick={handleRunAB}
            disabled={isPendingAB}
            className="rounded bg-white/10 px-3 py-1 text-[11px] text-white hover:bg-white/20 disabled:opacity-40"
          >
            {isPendingAB ? 'Running…' : 'Run Advisory Board'}
          </button>
        ) : (
          <button
            onClick={handleRunAB}
            disabled={isPendingAB}
            className="rounded border border-white/10 px-3 py-1 text-[11px] text-gray-400 hover:text-white hover:border-white/30 disabled:opacity-40"
          >
            {isPendingAB ? 'Running…' : 'Re-run Advisory Board'}
          </button>
        )}

        {(verdict === 'keep') && !specDone && dump.status !== 'spec_generated' && (
          <button
            onClick={handleGenerateSpec}
            disabled={isPendingSpec}
            className="rounded bg-blue-700/60 px-3 py-1 text-[11px] text-blue-100 hover:bg-blue-700/80 disabled:opacity-40"
          >
            {isPendingSpec ? 'Generating…' : 'Approve → Generate Spec'}
          </button>
        )}

        {(specDone || dump.status === 'spec_generated') && (
          <span className="text-[11px] text-green-400">Spec generated ✓</span>
        )}
      </div>

      {specError && (
        <p className="text-[11px] text-red-400 bg-red-900/20 rounded px-2 py-1">{specError}</p>
      )}
    </div>
  )
}

// ─── TaskSpecCard (Spec Review stage) ─────────────────────────────────────────

function TaskSpecCard({ task, project }: { task: Task; project: Project }) {
  const [isPendingApprove, startApprove] = useTransition()
  const [isPendingDone, startDone] = useTransition()
  const [approveError, setApproveError] = useState<string | null>(null)
  const [approved, setApproved] = useState(false)
  const [markedDone, setMarkedDone] = useState(false)

  function handleApprove() {
    setApproveError(null)
    startApprove(async () => {
      const res = await approveSpec(task.id, project.id, project.local_path ?? undefined)
      if ('error' in res && res.error) {
        setApproveError(res.error)
      } else if ('vscodePath' in res && res.vscodePath) {
        window.location.href = res.vscodePath
        setApproved(true)
      } else {
        setApproved(true)
      }
    })
  }

  function handleMarkDone() {
    startDone(async () => {
      await markTaskDone(task.id, project.id)
      setMarkedDone(true)
    })
  }

  if (markedDone) return null

  return (
    <div className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
      <div className="flex items-center gap-2 flex-wrap">
        <p className="text-sm font-medium text-white">{task.title}</p>
        <span className="ml-auto text-[10px] text-gray-600">{timeSince(task.created_at)}</span>
      </div>

      <div className="flex items-center gap-2 flex-wrap">
        {task.tool && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-white/10 text-gray-300">
            {task.tool.replace('_', ' ')}
          </span>
        )}
        {task.model_tier != null && (
          <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-blue-900/40 text-blue-300">
            Tier {task.model_tier}
          </span>
        )}
      </div>

      {task.generated_spec && (
        <pre className="max-h-64 overflow-y-auto rounded border border-white/10 bg-black/30 p-2 text-[11px] text-gray-300 whitespace-pre-wrap leading-relaxed">
          {task.generated_spec}
        </pre>
      )}

      <div className="flex items-center gap-2 flex-wrap pt-1">
        {!approved ? (
          <button
            onClick={handleApprove}
            disabled={isPendingApprove}
            className="rounded bg-green-700/60 px-3 py-1 text-[11px] text-green-100 hover:bg-green-700/80 disabled:opacity-40"
          >
            {isPendingApprove ? 'Opening…' : 'Open in VS Code →'}
          </button>
        ) : (
          <span className="text-[11px] text-green-400">Approved — task in flight ✓</span>
        )}

        <button
          onClick={handleMarkDone}
          disabled={isPendingDone}
          className="rounded border border-white/10 px-3 py-1 text-[11px] text-gray-400 hover:text-white hover:border-white/30 disabled:opacity-40"
        >
          {isPendingDone ? '…' : 'Mark Done'}
        </button>
      </div>

      {approveError && (
        <p className="text-[11px] text-red-400 bg-red-900/20 rounded px-2 py-1">{approveError}</p>
      )}
    </div>
  )
}

// ─── Main component ───────────────────────────────────────────────────────────

export function ProjectWorkspaceTabs({
  project,
  brainDumps,
  tasks,
  doneTasks,
  initialChats,
  claudeMd,
  decisionsMd,
  handoffs,
  health,
}: Props) {
  const router = useRouter()
  const [activeStage, setActiveStage] = useState<ActiveStage>('dumps')
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

  // Derived counts for badges
  const unreviewedDumps = brainDumps.filter(d => d.status === 'inbox' || d.status === 'reviewed').length
  const specReviewTasks = tasks.filter(t => t.status === 'pending' && t.generated_spec != null).length
  const inFlightTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'review').length
  const doneCount = doneTasks.length

  const PIPELINE_STAGES: { key: ActiveStage; label: string; count: number }[] = [
    { key: 'dumps',       label: 'Dumps',       count: unreviewedDumps },
    { key: 'spec_review', label: 'Spec Review',  count: specReviewTasks },
    { key: 'in_flight',   label: 'In Flight',    count: inFlightTasks },
    { key: 'done',        label: 'Done',         count: doneCount },
  ]

  const CONTEXT_STAGES: { key: ActiveStage; label: string }[] = [
    { key: 'mission_brief', label: 'Mission Brief' },
    { key: 'handoff_log',   label: 'Handoff Log' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Page header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight text-white">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-gray-400">{project.description}</p>
          )}
        </div>
        <div className="flex items-center gap-2 shrink-0">
          {project.local_path && (
            <a
              href={`vscode://file/${project.local_path.replace(/\\/g, '/')}`}
              className="rounded border border-white/10 px-3 py-1.5 text-[11px] font-medium text-gray-400 hover:text-white hover:border-white/30"
            >
              Open in VS Code
            </a>
          )}
          <a
            href={`/projects/${project.id}/edit`}
            className="rounded border border-white/10 px-3 py-1.5 text-[11px] font-medium text-gray-400 hover:text-white hover:border-white/30"
          >
            Edit
          </a>
        </div>
      </div>

      {/* 3-column layout */}
      <div className="flex gap-0 items-start">

        {/* ── Left sidebar: 160px pipeline nav ── */}
        <div className="w-40 shrink-0 flex flex-col gap-1 pr-3 border-r border-white/10">
          {/* Pipeline stages */}
          {PIPELINE_STAGES.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setActiveStage(key)}
              className={[
                'flex items-center justify-between rounded px-2 py-1.5 text-xs font-medium transition-colors text-left w-full',
                activeStage === key
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5',
              ].join(' ')}
            >
              <span>{label}</span>
              {count > 0 && (
                <span className="rounded-full bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400 tabular-nums">
                  {count}
                </span>
              )}
            </button>
          ))}

          {/* Divider */}
          <div className="my-2 border-t border-white/10" />

          {/* Context links */}
          {CONTEXT_STAGES.map(({ key, label }) => (
            <button
              key={key}
              onClick={() => setActiveStage(key)}
              className={[
                'rounded px-2 py-1.5 text-xs font-medium transition-colors text-left w-full',
                activeStage === key
                  ? 'bg-white/10 text-white'
                  : 'text-gray-400 hover:text-white hover:bg-white/5',
              ].join(' ')}
            >
              {label}
            </button>
          ))}
        </div>

        {/* ── Main panel: flex-1 ── */}
        <div className="flex-1 min-w-0 px-5">

          {/* DUMPS */}
          {activeStage === 'dumps' && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white">Brain Dumps</h2>
              <NewDumpForm
                projectId={project.id}
                onCreated={() => router.refresh()}
              />
              {brainDumps.length === 0 ? (
                <p className="text-sm text-gray-500 py-12 text-center">
                  No brain dumps yet. Submit one above to get started.
                </p>
              ) : (
                brainDumps.map(dump => (
                  <DumpCard
                    key={dump.id}
                    dump={dump}
                    project={project}
                    claudeMd={claudeMd}
                    decisionsMd={decisionsMd}
                  />
                ))
              )}
            </div>
          )}

          {/* SPEC REVIEW */}
          {activeStage === 'spec_review' && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white">Spec Review</h2>
              {specReviewTasks === 0 ? (
                <p className="text-sm text-gray-500 py-12 text-center">
                  No specs pending review.
                </p>
              ) : (
                tasks
                  .filter(t => t.status === 'pending' && t.generated_spec != null)
                  .map(task => (
                    <TaskSpecCard key={task.id} task={task} project={project} />
                  ))
              )}
            </div>
          )}

          {/* IN FLIGHT */}
          {activeStage === 'in_flight' && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white">In Flight</h2>
              {inFlightTasks === 0 ? (
                <p className="text-sm text-gray-500 py-12 text-center">
                  No tasks in flight.
                </p>
              ) : (
                tasks
                  .filter(t => t.status === 'in_progress' || t.status === 'review')
                  .map(task => {
                    const relatedHandoff = handoffs.find(h => h.task_id === task.id)
                    return (
                      <div key={task.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-2">
                        <div className="flex items-center gap-2 flex-wrap">
                          <p className="text-sm font-medium text-white">{task.title}</p>
                          <span className="ml-auto text-[10px] text-gray-600">{timeSince(task.created_at)}</span>
                        </div>

                        <div className="flex items-center gap-2 flex-wrap">
                          {task.tool && (
                            <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-white/10 text-gray-300">
                              {task.tool.replace('_', ' ')}
                            </span>
                          )}
                          {task.codex_qc_status && (
                            <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${QC_STATUS_COLOR[task.codex_qc_status]}`}>
                              QC: {task.codex_qc_status.replace('_', ' ')}
                            </span>
                          )}
                        </div>

                        {task.codex_qc_notes && (
                          <p className="text-[11px] text-gray-400 leading-relaxed">{task.codex_qc_notes}</p>
                        )}

                        {relatedHandoff?.github_commit_url && (
                          <a
                            href={relatedHandoff.github_commit_url}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-[11px] text-blue-400 hover:text-blue-300"
                          >
                            View commit →
                          </a>
                        )}

                        <CodexQCForm taskId={task.id} projectId={project.id} />
                      </div>
                    )
                  })
              )}
            </div>
          )}

          {/* DONE */}
          {activeStage === 'done' && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white">Done</h2>
              {doneTasks.length === 0 ? (
                <p className="text-sm text-gray-500 py-12 text-center">
                  No completed tasks yet.
                </p>
              ) : (
                doneTasks.map(task => (
                  <div key={task.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <p className="text-sm font-medium text-white">{task.title}</p>
                      <span className="ml-auto text-[10px] text-gray-600">{timeSince(task.updated_at)}</span>
                    </div>
                    <div className="flex items-center gap-2 flex-wrap">
                      {task.tool && (
                        <span className="rounded-full px-2 py-0.5 text-[10px] font-medium bg-white/10 text-gray-300">
                          {task.tool.replace('_', ' ')}
                        </span>
                      )}
                      {task.codex_qc_status && (
                        <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${QC_STATUS_COLOR[task.codex_qc_status]}`}>
                          QC: {task.codex_qc_status.replace('_', ' ')}
                        </span>
                      )}
                    </div>
                  </div>
                ))
              )}
            </div>
          )}

          {/* MISSION BRIEF */}
          {activeStage === 'mission_brief' && (
            <div className="flex flex-col gap-6">
              <h2 className="text-sm font-semibold text-white">Mission Brief</h2>

              {/* Health indicators */}
              {health && (
                <div className="flex items-center gap-4 rounded-md border border-white/10 bg-white/5 px-4 py-2.5">
                  {([
                    { label: 'GitHub',   status: health.github_status },
                    { label: 'Vercel',   status: health.vercel_status },
                    { label: 'Supabase', status: health.supabase_status },
                  ] as { label: string; status: HealthStatus }[]).map(({ label, status }) => (
                    <div key={label} className="flex items-center gap-1.5">
                      <span className={`h-2 w-2 rounded-full ${HEALTH_DOT[status]}`} />
                      <span className="text-xs text-gray-400">{label}</span>
                      <span className="text-[10px] text-gray-600">{status}</span>
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
                  <div key={label} className="rounded-md border border-white/10 bg-white/5 px-3 py-2">
                    <p className="text-[10px] text-gray-500">{label}</p>
                    <p className="text-xs font-medium text-white">{value}</p>
                  </div>
                ))}
              </div>

              {project.next_action && (
                <div className="rounded-md bg-white/5 border border-white/10 px-3 py-2 text-sm">
                  <span className="font-medium text-white">Next: </span>
                  <span className="text-gray-400">{project.next_action}</span>
                </div>
              )}

              {project.blockers && (
                <div className="rounded-md bg-red-900/20 border border-red-500/20 px-3 py-2 text-sm">
                  <span className="font-medium text-red-400">Blocked: </span>
                  <span className="text-red-300">{project.blockers}</span>
                </div>
              )}

              {/* CLAUDE.md */}
              {claudeMd && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-white">CLAUDE.md</h3>
                  <div className="rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-gray-400 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {claudeMd}
                  </div>
                </div>
              )}

              {/* decisions.md */}
              {decisionsMd && (
                <div className="flex flex-col gap-2">
                  <h3 className="text-sm font-semibold text-white">decisions.md</h3>
                  <div className="rounded-md border border-white/10 bg-black/30 p-3 text-[11px] text-gray-400 leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                    {decisionsMd}
                  </div>
                </div>
              )}

              {/* AI Suggestions */}
              <div className="flex flex-col gap-2">
                <div className="flex items-center justify-between">
                  <h3 className="text-sm font-semibold text-white">AI Suggestions</h3>
                  <div className="flex items-center gap-2">
                    {project.suggestions_updated_at && (
                      <span className="text-[10px] text-gray-600">
                        {timeSince(project.suggestions_updated_at)}
                      </span>
                    )}
                    <button
                      disabled={isPending}
                      onClick={handleRefreshSuggestions}
                      className="rounded border border-white/10 px-3 py-1 text-[11px] text-gray-400 hover:text-white hover:border-white/30 disabled:opacity-50"
                    >
                      {isPending ? '…' : 'Refresh Suggestions'}
                    </button>
                  </div>
                </div>

                {suggestError && (
                  <p className="text-[11px] text-red-400 bg-red-900/20 rounded px-2 py-1">{suggestError}</p>
                )}

                {suggestionsText ? (
                  <div className="rounded-md border border-white/10 bg-white/5 p-3 text-[11px] text-gray-400 leading-relaxed whitespace-pre-wrap">
                    {suggestionsText}
                  </div>
                ) : (
                  <p className="text-[11px] text-gray-600 italic">
                    {isPending ? 'Generating suggestions…' : 'No suggestions yet. Click Refresh Suggestions to generate.'}
                  </p>
                )}
              </div>
            </div>
          )}

          {/* HANDOFF LOG */}
          {activeStage === 'handoff_log' && (
            <div className="flex flex-col gap-3">
              <h2 className="text-sm font-semibold text-white">Handoff Log</h2>
              {handoffs.length === 0 ? (
                <p className="text-sm text-gray-500 py-12 text-center">
                  No agent sessions yet for this project.
                </p>
              ) : (
                handoffs.map(h => (
                  <div key={h.id} className="rounded-lg border border-white/10 bg-white/5 p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${HANDOFF_STATUS_COLOR[h.status] ?? 'text-gray-400'}`}>
                        {h.agent_name}
                      </span>
                      <span className="rounded bg-white/10 px-1.5 py-0.5 text-[10px] text-gray-400">
                        {h.status.replace('_', ' ')}
                      </span>
                      <span className="ml-auto text-[10px] text-gray-600">{timeSince(h.started_at)}</span>
                    </div>
                    {h.task_description && (
                      <p className="text-xs text-gray-200 leading-snug">{h.task_description}</p>
                    )}
                    {h.outcome && (
                      <p className="text-[11px] text-gray-400">{h.outcome}</p>
                    )}
                    <div className="flex items-center gap-3 text-[10px] text-gray-600">
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

        {/* ── Right sidebar: Build Partner 288px ── */}
        <div className="w-72 shrink-0 sticky top-4 pl-4 border-l border-white/10">
          <div className="flex flex-col gap-2">
            <div className="flex items-center justify-between">
              <h2 className="text-sm font-semibold text-white">Build Partner</h2>
              {project.lead_model && (
                <span className="text-[10px] text-gray-600">{project.lead_model}</span>
              )}
            </div>
            <div className="rounded-lg border border-white/10 bg-white/5 p-3">
              <ProjectChat projectId={project.id} initialMessages={initialChats} />
            </div>
          </div>
        </div>

      </div>
    </div>
  )
}
