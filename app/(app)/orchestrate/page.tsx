import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase'
import { OrchestrateItem } from '@/components/OrchestrateItem'
import type { Task, Project, AgentHandoff } from '@/lib/types'

const TABS = [
  { key: 'pending',    label: 'Pending' },
  { key: 'spec_ready', label: 'Spec Ready' },
  { key: 'done',       label: 'Done' },
  { key: 'handoffs',   label: 'Handoff Log' },
]

const handoffStatusColors: Record<string, string> = {
  in_progress: 'bg-blue-100 text-blue-700',
  done:        'bg-green-100 text-green-700',
  review:      'bg-yellow-100 text-yellow-700',
  failed:      'bg-red-100 text-red-700',
}

function formatDate(iso: string | null): string {
  if (!iso) return '—'
  return new Date(iso).toLocaleString('en-US', {
    month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit',
  })
}

interface Props {
  searchParams: Promise<{ tab?: string }>
}

export default async function OrchestratePage({ searchParams }: Props) {
  const { tab } = await searchParams
  const activeTab = (tab && TABS.some(t => t.key === tab)) ? tab : 'pending'

  const supabase = await createServerSupabaseClient()

  const [{ data: projects }, { data: tasks }, { data: handoffs }] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
    supabase.from('agent_handoffs').select('*').order('created_at', { ascending: false }),
  ])

  const projectMap = new Map((projects ?? []).map(p => [p.id, p.name]))

  const filtered = (tasks ?? [])
    .map(t => ({
      ...t,
      project_name: t.project_id ? (projectMap.get(t.project_id) ?? null) : null,
    }))
    .filter(t => {
      if (activeTab === 'pending')    return !t.generated_spec && t.status !== 'done' && t.status !== 'killed'
      if (activeTab === 'spec_ready') return !!t.generated_spec && t.status !== 'done' && t.status !== 'killed'
      if (activeTab === 'done')       return t.status === 'done' || t.status === 'killed'
      return false
    }) as (Task & { project_name: string | null })[]

  return (
    <div className="flex flex-col gap-6">
      <h1 className="text-2xl font-bold tracking-tight">Build Orchestration</h1>

      {/* Tab nav */}
      <div className="flex gap-1 border-b border-border">
        {TABS.map(({ key, label }) => (
          <Link
            key={key}
            href={`?tab=${key}`}
            className={[
              'px-3 py-1.5 text-sm font-medium rounded-t-md -mb-px border border-transparent transition-colors',
              activeTab === key
                ? 'border-border border-b-background bg-background text-foreground'
                : 'text-muted-foreground hover:text-foreground',
            ].join(' ')}
          >
            {label}
          </Link>
        ))}
      </div>

      {activeTab === 'handoffs' ? (
        (handoffs ?? []).length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-12">No agent handoffs yet.</p>
        ) : (
          <div className="flex flex-col gap-2">
            {(handoffs as AgentHandoff[]).map(h => (
              <div key={h.id} className="rounded-lg border border-border bg-card px-4 py-3 flex flex-col gap-1.5">
                <div className="flex items-center gap-2 flex-wrap">
                  <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${handoffStatusColors[h.status] ?? 'bg-slate-100 text-slate-600'}`}>
                    {h.status.replace('_', ' ')}
                  </span>
                  <span className="text-[11px] font-semibold text-foreground">{h.agent_name}</span>
                  {h.project_id && projectMap.get(h.project_id) && (
                    <span className="text-[10px] text-muted-foreground">{projectMap.get(h.project_id)}</span>
                  )}
                  <span className="ml-auto text-[10px] text-muted-foreground/60">{formatDate(h.started_at)}</span>
                </div>
                {h.task_description && (
                  <p className="text-[11px] text-foreground/80 leading-snug">{h.task_description}</p>
                )}
                {h.outcome && (
                  <p className="text-[11px] text-muted-foreground italic">{h.outcome}</p>
                )}
                {h.github_commit_url && (
                  <a
                    href={h.github_commit_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="text-[11px] text-blue-600 hover:underline truncate"
                  >
                    {h.github_commit_url}
                  </a>
                )}
                {h.completed_at && (
                  <p className="text-[10px] text-muted-foreground/60">Completed {formatDate(h.completed_at)}</p>
                )}
              </div>
            ))}
          </div>
        )
      ) : filtered.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No tasks in this tab yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {filtered.map(task => (
            <OrchestrateItem
              key={task.id}
              task={task}
              projects={projects ?? []}
            />
          ))}
        </div>
      )}
    </div>
  )
}
