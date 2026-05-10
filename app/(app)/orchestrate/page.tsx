import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase'
import { OrchestrateItem } from '@/components/OrchestrateItem'
import type { Task, Project } from '@/lib/types'

const TABS = [
  { key: 'pending',    label: 'Pending' },
  { key: 'spec_ready', label: 'Spec Ready' },
  { key: 'done',       label: 'Done' },
]

interface Props {
  searchParams: Promise<{ tab?: string }>
}

export default async function OrchestratePage({ searchParams }: Props) {
  const { tab } = await searchParams
  const activeTab = (tab && TABS.some(t => t.key === tab)) ? tab : 'pending'

  const supabase = await createServerSupabaseClient()

  const [{ data: projects }, { data: tasks }] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase.from('tasks').select('*').order('created_at', { ascending: false }),
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

      {filtered.length === 0 ? (
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
