import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { quickDump } from './actions'
import type { Project, AgentHandoff, ProjectStage } from '@/lib/types'

export const dynamic = 'force-dynamic'

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins  = Math.floor(diff / 60_000)
  const hours = Math.floor(diff / 3_600_000)
  const days  = Math.floor(diff / 86_400_000)
  if (mins < 60)  return `${mins}m ago`
  if (hours < 24) return `${hours}h ago`
  if (days === 1) return 'yesterday'
  return `${days}d ago`
}

const TIER_STYLES = {
  1: {
    label: 'Tier 1',
    sub: 'Protect & Accelerate',
    accent: 'text-purple-400',
    bar: 'bg-purple-500',
    empty: 'text-purple-400/50',
  },
  2: {
    label: 'Tier 2',
    sub: 'Active Builds',
    accent: 'text-blue-400',
    bar: 'bg-blue-500',
    empty: 'text-blue-400/50',
  },
  3: {
    label: 'Tier 3',
    sub: 'Personal & Long-shot',
    accent: 'text-gray-400',
    bar: 'bg-gray-500',
    empty: 'text-gray-400/50',
  },
} as const

const HANDOFF_STATUS: Record<string, string> = {
  in_progress: 'text-yellow-400',
  done:        'text-green-400',
  failed:      'text-red-400',
  review:      'text-blue-400',
}

const STAGE_BADGE: Record<ProjectStage, string> = {
  idea:  'bg-slate-700 text-slate-300',
  spec:  'bg-blue-900 text-blue-300',
  build: 'bg-yellow-900 text-yellow-300',
  ship:  'bg-green-900 text-green-300',
  scale: 'bg-emerald-900 text-emerald-300',
  kill:  'bg-red-900 text-red-300',
}

type PipelineCounts = { dumps: number; specReady: number; inFlight: number }

function PipelineCard({ project, counts }: { project: Project; counts: PipelineCounts }) {
  const stage = STAGE_BADGE[project.stage]
  const hasPipeline = counts.dumps + counts.specReady + counts.inFlight > 0
  return (
    <div className="flex flex-col gap-3 rounded-xl border border-white/10 bg-white/5 p-4 hover:bg-white/[0.07] transition-colors">
      {/* Header */}
      <div className="flex items-start justify-between gap-2">
        <div className="min-w-0">
          <p className="truncate text-sm font-semibold text-white leading-tight">
            {project.name}
            {project.protected && (
              <span className="ml-1.5 text-[10px] font-medium text-amber-400 tracking-wide">PROTECTED</span>
            )}
          </p>
        </div>
        <span className={`shrink-0 rounded-full px-2 py-0.5 text-[10px] font-medium ${stage}`}>
          {project.stage}
        </span>
      </div>

      {/* Pipeline summary */}
      <div className="text-[11px] text-gray-500">
        {hasPipeline ? (
          <span>
            <span className={counts.dumps > 0 ? 'text-gray-300' : ''}>{counts.dumps} dump{counts.dumps !== 1 ? 's' : ''}</span>
            {' · '}
            <span className={counts.specReady > 0 ? 'text-yellow-400' : ''}>{counts.specReady} spec ready</span>
            {' · '}
            <span className={counts.inFlight > 0 ? 'text-green-400' : ''}>{counts.inFlight} in flight</span>
          </span>
        ) : (
          <span>No active pipeline</span>
        )}
      </div>

      {/* Blocker */}
      {project.blockers && (
        <div className="rounded-md bg-red-950/50 px-2 py-1 text-[11px] text-red-400">
          <span className="font-medium">Blocked:</span> {project.blockers}
        </div>
      )}

      {/* Status note */}
      {project.status && !project.blockers && (
        <p className="text-[11px] text-gray-500 leading-snug line-clamp-2">{project.status}</p>
      )}

      {/* CTA */}
      <Link
        href={`/projects/${project.id}`}
        className="mt-auto inline-flex items-center gap-1 rounded-lg bg-white/10 px-3 py-1.5 text-[11px] font-medium text-white hover:bg-white/20 transition-colors w-fit"
      >
        Run Pipeline →
      </Link>
    </div>
  )
}

export default async function CommandCenter() {
  const supabase = await createServerSupabaseClient()

  const [
    { data: projects },
    { data: handoffs },
    { count: credCount },
    { count: specReadyCount },
    { data: taskCountRows },
    { data: dumpCountRows },
  ] = await Promise.all([
    supabase
      .from('projects')
      .select('*')
      .order('tier', { ascending: true })
      .order('last_update', { ascending: false }),
    supabase
      .from('agent_handoffs')
      .select('id, project_id, agent_name, task_description, status, started_at, completed_at, github_commit_url')
      .order('started_at', { ascending: false })
      .limit(8),
    supabase
      .from('credentials')
      .select('*', { count: 'exact', head: true }),
    supabase
      .from('tasks')
      .select('*', { count: 'exact', head: true })
      .not('generated_spec', 'is', null)
      .not('status', 'in', '("done","killed","review")'),
    // All tasks for pipeline count aggregation (just the fields we need)
    supabase
      .from('tasks')
      .select('project_id, status, generated_spec')
      .not('status', 'in', '("done","killed")'),
    // All brain_dumps for pipeline count aggregation
    supabase
      .from('brain_dumps')
      .select('project_id, status')
      .not('status', 'eq', 'archived')
      .not('project_id', 'is', null),
  ])

  const all     = (projects ?? []) as Project[]
  const allHO   = (handoffs ?? []) as AgentHandoff[]
  const activeAgents = allHO.filter(h => h.status === 'in_progress').length

  const tier1 = all.filter(p => p.tier === 1)
  const tier2 = all.filter(p => p.tier === 2)
  const tier3 = all.filter(p => p.tier === 3)

  // Build per-project pipeline counts
  const taskRows = (taskCountRows ?? []) as { project_id: string | null; status: string; generated_spec: string | null }[]
  const dumpRows = (dumpCountRows ?? []) as { project_id: string | null; status: string }[]

  const pipelineByProject = new Map<string, PipelineCounts>()

  for (const row of dumpRows) {
    if (!row.project_id) continue
    const entry = pipelineByProject.get(row.project_id) ?? { dumps: 0, specReady: 0, inFlight: 0 }
    entry.dumps++
    pipelineByProject.set(row.project_id, entry)
  }

  for (const row of taskRows) {
    if (!row.project_id) continue
    const entry = pipelineByProject.get(row.project_id) ?? { dumps: 0, specReady: 0, inFlight: 0 }
    if (row.status === 'pending' && row.generated_spec) entry.specReady++
    if (row.status === 'in_progress') entry.inFlight++
    pipelineByProject.set(row.project_id, entry)
  }

  return (
    <div className="flex flex-col gap-6">

      {/* Brain dump quick input */}
      <form action={quickDump} className="flex flex-col gap-2 sm:flex-row sm:items-end">
        <Textarea
          name="text"
          placeholder="Brain dump anything — idea, bug, task, decision… Haiku classifies it."
          className="min-h-[56px] flex-1 resize-none text-sm"
          required
        />
        <Button type="submit" className="shrink-0">Dump it</Button>
      </form>

      {/* Health summary bar */}
      <div className="flex flex-wrap gap-3 rounded-xl border border-white/10 bg-white/5 px-4 py-3 text-sm">
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${activeAgents > 0 ? 'bg-green-400 shadow-[0_0_6px_theme(colors.green.400)]' : 'bg-gray-600'}`} />
          <span className="text-gray-400">
            {activeAgents} active agent{activeAgents !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-white/10">|</span>
        <div className="flex items-center gap-2">
          <span className={`h-2 w-2 rounded-full ${(specReadyCount ?? 0) > 0 ? 'bg-yellow-400' : 'bg-gray-600'}`} />
          <span className="text-gray-400">
            {specReadyCount ?? 0} spec-ready task{(specReadyCount ?? 0) !== 1 ? 's' : ''}
          </span>
        </div>
        <span className="text-white/10">|</span>
        <div className="flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-purple-400" />
          <Link href="/vault" className="text-gray-400 hover:text-purple-300">
            {credCount ?? 0} credential{(credCount ?? 0) !== 1 ? 's' : ''} in vault
          </Link>
        </div>
      </div>

      {/* Projects header */}
      <div className="flex items-center justify-between">
        <h2 className="text-sm font-semibold text-white">Projects</h2>
        <Link
          href="/projects/new"
          className="rounded border border-white/10 px-3 py-1.5 text-[11px] font-medium text-gray-400 hover:border-white/30 hover:text-white"
        >
          + New Project
        </Link>
      </div>

      {/* Three-tier project grid */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">
        {([1, 2, 3] as const).map(tier => {
          const items = tier === 1 ? tier1 : tier === 2 ? tier2 : tier3
          const s = TIER_STYLES[tier]
          return (
            <section key={tier} className="flex flex-col gap-3">
              <div className="flex items-center gap-2">
                <div className={`h-3 w-0.5 rounded-full ${s.bar}`} />
                <span className={`text-xs font-semibold uppercase tracking-widest ${s.accent}`}>
                  {s.label}
                </span>
                <span className="text-xs text-gray-600">{s.sub}</span>
              </div>
              {items.length === 0 ? (
                <p className={`text-xs ${s.empty}`}>No projects.</p>
              ) : (
                items.map(p => <PipelineCard key={p.id} project={p} counts={pipelineByProject.get(p.id) ?? { dumps: 0, specReady: 0, inFlight: 0 }} />)
              )}
            </section>
          )
        })}
      </div>

      {/* Bottom panels */}
      <div className="grid grid-cols-1 gap-4 lg:grid-cols-2">

        {/* Agent Activity */}
        <div className="rounded-xl border border-white/10 bg-white/5 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Agent Activity</h3>
          </div>
          {allHO.length === 0 ? (
            <p className="text-xs text-gray-600">No agent sessions yet.</p>
          ) : (
            <div className="flex flex-col gap-2">
              {allHO.map(h => (
                <div key={h.id} className="flex items-start justify-between gap-2 rounded-lg bg-white/5 px-3 py-2">
                  <div className="min-w-0 flex-1">
                    <div className="flex items-center gap-2">
                      <span className={`text-xs font-medium ${HANDOFF_STATUS[h.status] ?? 'text-gray-400'}`}>
                        {h.agent_name}
                      </span>
                      <span className="rounded bg-white/5 px-1.5 py-0.5 text-[10px] text-gray-500">
                        {h.status}
                      </span>
                    </div>
                    {h.task_description && (
                      <p className="mt-0.5 truncate text-[11px] text-gray-500">{h.task_description}</p>
                    )}
                  </div>
                  <span className="shrink-0 text-[10px] text-gray-600">
                    {timeSince(h.started_at)}
                  </span>
                </div>
              ))}
            </div>
          )}
        </div>

        {/* Vault Quick View */}
        <div className="rounded-xl border border-purple-500/20 bg-purple-900/10 p-4">
          <div className="mb-3 flex items-center justify-between">
            <h3 className="text-sm font-semibold text-white">Credentials Vault</h3>
            <Link href="/vault" className="text-xs text-purple-400 hover:text-purple-300">Manage →</Link>
          </div>
          <p className="text-sm text-gray-400">
            {(credCount ?? 0) === 0
              ? 'No credentials stored yet.'
              : `${credCount} key${(credCount ?? 0) !== 1 ? 's' : ''} encrypted at rest.`}
          </p>
          <p className="mt-1 text-xs text-gray-600">
            Agents access keys via <code className="text-purple-400">mc_get_credential</code> over MCP.
            Values are never shown in list view.
          </p>
          <Link
            href="/vault"
            className="mt-3 inline-block rounded-lg bg-purple-600/20 px-3 py-1.5 text-xs text-purple-300 hover:bg-purple-600/30"
          >
            + Add Credential
          </Link>
        </div>

      </div>
    </div>
  )
}
