import Link from 'next/link'
import { createServerSupabaseClient } from '@/lib/supabase'
import { ProjectCard } from '@/components/ProjectCard'
import { Textarea } from '@/components/ui/textarea'
import { Button } from '@/components/ui/button'
import { quickDump } from './actions'
import type { Project, AgentHandoff } from '@/lib/types'

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

export default async function CommandCenter() {
  const supabase = await createServerSupabaseClient()

  const [
    { data: projects },
    { data: handoffs },
    { count: credCount },
    { count: specReadyCount },
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
  ])

  const all     = (projects ?? []) as Project[]
  const allHO   = (handoffs ?? []) as AgentHandoff[]
  const activeAgents = allHO.filter(h => h.status === 'in_progress').length

  const tier1 = all.filter(p => p.tier === 1)
  const tier2 = all.filter(p => p.tier === 2)
  const tier3 = all.filter(p => p.tier === 3)

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
        <div className="ml-auto">
          <Link href="/orchestrate" className="text-xs text-gray-500 hover:text-white">
            Orchestrate →
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
                items.map(p => <ProjectCard key={p.id} project={p} />)
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
            <Link href="/orchestrate" className="text-xs text-gray-500 hover:text-white">View all →</Link>
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
