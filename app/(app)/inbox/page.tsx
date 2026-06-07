import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase'
import { InboxItem } from '@/components/InboxItem'
import { InboxCapture } from '@/components/InboxCapture'
import type { BrainDump, BrainDumpStatus, Project } from '@/lib/types'

const tabFilters: Record<string, BrainDumpStatus[]> = {
  active:   ['inbox', 'reviewed'],
  all:      ['inbox', 'reviewed', 'actioned', 'archived', 'spec_generated'],
  actioned: ['actioned', 'spec_generated'],
  archived: ['archived'],
}

const TABS = [
  { key: 'active',   label: 'Active' },
  { key: 'all',      label: 'All' },
  { key: 'actioned', label: 'Actioned' },
  { key: 'archived', label: 'Archived' },
]

interface Props {
  searchParams: Promise<{ tab?: string }>
}

export default async function InboxPage({ searchParams }: Props) {
  const { tab } = await searchParams
  const activeTab = (tab && tab in tabFilters) ? tab : 'active'
  const statuses = tabFilters[activeTab]

  const supabase = await createServerSupabaseClient()

  const [{ data: projects }, { data: dumps }, { data: taskRows }] = await Promise.all([
    supabase.from('projects').select('id, name').order('name'),
    supabase
      .from('brain_dumps')
      .select('*')
      .in('status', statuses)
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id, brain_dump_id, generated_spec, recommended_tool, recommended_model, complexity_tier, status')
      .not('brain_dump_id', 'is', null),
  ])

  const projectMap = new Map((projects ?? []).map(p => [p.id, p.name]))

  const dumpsWithProject = (dumps ?? []).map(d => ({
    ...d,
    project_name: d.project_id ? (projectMap.get(d.project_id) ?? null) : null,
  })) as (BrainDump & { project_name: string | null })[]

  const taskByDumpId = new Map<string, { id: string; brain_dump_id: string | null; generated_spec: string | null; recommended_tool: string | null; recommended_model: string | null; complexity_tier: number | null; status: string }>()
  for (const t of (taskRows ?? [])) {
    if (t.brain_dump_id) taskByDumpId.set(t.brain_dump_id, t)
  }

  return (
    <div className="flex flex-col gap-6">
      <div className="flex items-center justify-between">
        <h1 className="text-lg font-semibold text-white">Inbox</h1>
        <span className="text-xs text-gray-500">{dumpsWithProject.length} item{dumpsWithProject.length !== 1 ? 's' : ''}</span>
      </div>

      <InboxCapture />

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

      {/* Dump list */}
      {dumpsWithProject.length === 0 ? (
        <p className="text-sm text-muted-foreground text-center py-12">
          No dumps in this tab yet.
        </p>
      ) : (
        <div className="flex flex-col gap-3">
          {dumpsWithProject.map(dump => (
            <InboxItem
              key={dump.id}
              dump={dump}
              projects={projects ?? []}
              task={taskByDumpId.get(dump.id)}
            />
          ))}
        </div>
      )}
    </div>
  )
}
