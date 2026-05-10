import { createServerSupabaseClient } from '@/lib/supabase'
import { ProjectCard } from '@/components/ProjectCard'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { quickDump } from './actions'
import type { Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

export default async function DashboardPage() {
  const supabase = await createServerSupabaseClient()

  const { data: projects } = await supabase
    .from('projects')
    .select('*')
    .order('tier', { ascending: true })
    .order('name', { ascending: true })

  const all = (projects ?? []) as Project[]

  const tier1 = all.filter(p => p.tier === 1)
  const tier2 = all.filter(p => p.tier === 2)
  const tier3 = all.filter(p => p.tier === 3)

  return (
    <div className="space-y-8">

      {/* Brain dump quick input */}
      <section>
        <form action={quickDump} className="flex flex-col gap-2 sm:flex-row sm:items-end">
          <Textarea
            name="text"
            placeholder="Brain dump anything — idea, bug, task, decision… Haiku classifies it."
            className="min-h-[60px] flex-1 resize-none text-sm"
            required
          />
          <Button type="submit" className="shrink-0">
            Dump it
          </Button>
        </form>
      </section>

      {/* Three-tier project layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-3">

        {/* Tier 1 — Protect & Accelerate */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Tier 1
            </span>
            <span className="text-xs text-muted-foreground/60">Protect &amp; Accelerate</span>
          </div>
          {tier1.length === 0 ? (
            <p className="text-xs text-muted-foreground">No projects.</p>
          ) : (
            tier1.map(p => <ProjectCard key={p.id} project={p} />)
          )}
        </section>

        {/* Tier 2 — Active Builds */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Tier 2
            </span>
            <span className="text-xs text-muted-foreground/60">Active Builds</span>
          </div>
          {tier2.length === 0 ? (
            <p className="text-xs text-muted-foreground">No projects.</p>
          ) : (
            tier2.map(p => <ProjectCard key={p.id} project={p} />)
          )}
        </section>

        {/* Tier 3 — Personal & Long-shot */}
        <section className="flex flex-col gap-3">
          <div className="flex items-center gap-2">
            <span className="text-xs font-semibold uppercase tracking-widest text-muted-foreground">
              Tier 3
            </span>
            <span className="text-xs text-muted-foreground/60">Personal &amp; Long-shot</span>
          </div>
          {tier3.length === 0 ? (
            <p className="text-xs text-muted-foreground">No projects.</p>
          ) : (
            tier3.map(p => <ProjectCard key={p.id} project={p} />)
          )}
        </section>

      </div>
    </div>
  )
}
