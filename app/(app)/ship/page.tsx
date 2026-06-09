import { createAdminSupabaseClient } from '@/lib/supabase'
import { ShipChecklist } from '@/components/ShipChecklist'
import type { Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

const STAGE_LABEL: Record<string, string> = {
  build: 'Build',
  ship: 'Ship',
  scale: 'Scale',
}

const STAGE_COLOR: Record<string, string> = {
  build: 'text-blue-400 bg-blue-500/10 ring-blue-500/20',
  ship: 'text-violet-400 bg-violet-500/10 ring-violet-500/20',
  scale: 'text-green-400 bg-green-500/10 ring-green-500/20',
}

export default async function ShipPage() {
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from('projects')
    .select('*')
    .in('stage', ['build', 'ship', 'scale'])
    .order('tier', { ascending: true })
    .order('name', { ascending: true })

  const projects = (data ?? []) as Project[]

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Ship Pipeline</h1>
        <p className="mt-1 text-sm text-gray-500">
          Every project in build, ship, or scale — with its launch checklist and deploy controls.
        </p>
      </div>

      {projects.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-gray-400">No projects in build, ship, or scale stage.</p>
          <p className="mt-2 text-xs text-gray-600">
            Advance a project to the build stage from its workspace to see it here.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {projects.map(project => (
            <div key={project.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              {/* Header */}
              <div className="mb-4 flex items-start gap-2 flex-wrap">
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2 flex-wrap">
                    <h2 className="text-sm font-semibold text-white">{project.name}</h2>
                    {project.protected && (
                      <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20">
                        PROTECTED
                      </span>
                    )}
                    <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ring-1 ${STAGE_COLOR[project.stage] ?? 'text-gray-400 bg-white/5 ring-white/10'}`}>
                      {STAGE_LABEL[project.stage] ?? project.stage}
                    </span>
                    <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-500">
                      Tier {project.tier}
                    </span>
                  </div>
                  {project.description && (
                    <p className="mt-1 text-xs text-gray-500 line-clamp-1">{project.description}</p>
                  )}
                </div>
                <div className="flex items-center gap-2 flex-shrink-0">
                  {project.vercel_url && (
                    <a
                      href={project.vercel_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      Live ↗
                    </a>
                  )}
                  {project.repo_url && (
                    <a
                      href={project.repo_url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="rounded-md bg-white/5 border border-white/10 px-2 py-1 text-[11px] text-gray-400 hover:text-white hover:bg-white/10 transition-colors"
                    >
                      Repo ↗
                    </a>
                  )}
                </div>
              </div>

              {/* Advisory Board pre-ship verdict */}
              {project.ship_ab_verdict && (
                <div className={`mb-3 rounded-lg border px-3 py-2 text-xs ${
                  project.ship_ab_verdict === 'keep'
                    ? 'border-green-500/20 bg-green-500/5 text-green-300'
                    : project.ship_ab_verdict === 'kill'
                    ? 'border-red-500/20 bg-red-500/5 text-red-300'
                    : 'border-white/10 bg-white/5 text-gray-400'
                }`}>
                  <span className="font-semibold uppercase tracking-widest text-[10px] mr-2">
                    AB Pre-Ship:
                  </span>
                  <span className="font-medium">
                    {project.ship_ab_verdict === 'keep' ? 'Ready to Ship' : project.ship_ab_verdict === 'kill' ? 'Do Not Ship' : 'Pending'}
                  </span>
                  {project.ship_ab_reasoning && (
                    <p className="mt-1 text-[10px] text-gray-500 leading-snug">{project.ship_ab_reasoning}</p>
                  )}
                </div>
              )}

              {/* Checklist */}
              <ShipChecklist project={project} />
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
