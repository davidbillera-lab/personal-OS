import { createServerSupabaseClient } from '@/lib/supabase'
import type { Project } from '@/lib/types'

export const dynamic = 'force-dynamic'

interface RunbookFile {
  name: string
  path: string
  html_url: string
}

async function fetchRunbookFiles(repoUrl: string, pat?: string): Promise<RunbookFile[]> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) return []
  const [, owner, repo] = match
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/docs/runbooks`
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    ...(pat ? { Authorization: `token ${pat}` } : {}),
  }
  try {
    const res = await fetch(apiUrl, { headers, next: { revalidate: 300 } })
    if (!res.ok) return []
    const data = await res.json()
    if (!Array.isArray(data)) return []
    return data
      .filter((e: { type: string; name: string }) => e.type === 'file' && e.name.endsWith('.md'))
      .map((e: { name: string; path: string; html_url: string }) => ({
        name: e.name,
        path: e.path,
        html_url: e.html_url,
      }))
  } catch {
    return []
  }
}

function formatRunbookName(filename: string): string {
  return filename.replace(/\.md$/, '').replace(/[-_]/g, ' ').replace(/^\d+[-_]?/, '')
}

const TIER_LABEL: Record<number, string> = { 1: 'Tier 1', 2: 'Tier 2', 3: 'Tier 3' }

export default async function RunbookPage() {
  const supabase = await createServerSupabaseClient()
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, tier, stage, repo_url, protected, status, blockers')
    .neq('stage', 'kill')
    .order('tier', { ascending: true })
    .order('name', { ascending: true })

  const all = (projects ?? []) as Project[]
  const pat = process.env.GITHUB_PAT

  const withRunbooks = await Promise.all(
    all
      .filter(p => p.repo_url)
      .map(async p => ({
        project: p,
        files: await fetchRunbookFiles(p.repo_url!, pat),
      }))
  )

  const noRepoProjects = all.filter(p => !p.repo_url)
  const hasRunbooks = withRunbooks.filter(({ files }) => files.length > 0)
  const missingRunbooks = withRunbooks.filter(({ files }) => files.length === 0)

  return (
    <div className="flex flex-col gap-6">
      <div>
        <h1 className="text-lg font-semibold text-white">Runbooks</h1>
        <p className="mt-1 text-sm text-gray-500">
          Step-by-step execution procedures — no code context required. Add{' '}
          <code className="rounded bg-white/5 px-1 py-0.5 text-[11px] text-violet-400">docs/runbooks/*.md</code>{' '}
          to any project repo to surface it here.
        </p>
      </div>

      {hasRunbooks.length === 0 ? (
        <div className="rounded-xl border border-white/10 bg-white/5 p-8 text-center">
          <p className="text-sm text-gray-400">No runbooks found in any project repo yet.</p>
          <p className="mt-2 text-xs text-gray-600">
            Protected (Tier 1) projects should have <code className="text-violet-400">docs/runbooks/</code> before the first paying tenant or handoff.
          </p>
        </div>
      ) : (
        <div className="flex flex-col gap-4">
          {hasRunbooks.map(({ project, files }) => (
            <div key={project.id} className="rounded-xl border border-white/10 bg-white/5 p-4">
              <div className="mb-3 flex items-center gap-2 flex-wrap">
                <h2 className="text-sm font-semibold text-white">{project.name}</h2>
                {project.protected && (
                  <span className="rounded-full bg-amber-500/10 px-2 py-0.5 text-[10px] font-medium text-amber-400 ring-1 ring-amber-500/20">
                    PROTECTED
                  </span>
                )}
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-500">
                  {TIER_LABEL[project.tier]}
                </span>
                <span className="rounded-full bg-white/[0.06] px-2 py-0.5 text-[10px] text-gray-500">
                  {project.stage}
                </span>
                <span className="ml-auto text-[11px] text-gray-600">
                  {files.length} runbook{files.length !== 1 ? 's' : ''}
                </span>
              </div>
              <div className="flex flex-col gap-0.5">
                {files.map(f => (
                  <a
                    key={f.path}
                    href={f.html_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="group flex items-center gap-2 rounded-lg px-3 py-2 hover:bg-white/[0.05]"
                  >
                    <span className="text-gray-600 group-hover:text-gray-400">📄</span>
                    <span className="flex-1 text-sm capitalize text-gray-300 group-hover:text-white">
                      {formatRunbookName(f.name)}
                    </span>
                    <span className="text-[10px] text-gray-600 group-hover:text-gray-500">
                      View on GitHub →
                    </span>
                  </a>
                ))}
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Projects missing runbooks */}
      {(missingRunbooks.length > 0 || noRepoProjects.length > 0) && (
        <div className="rounded-xl border border-white/[0.06] bg-white/[0.02] p-4">
          <h3 className="mb-3 text-xs font-semibold uppercase tracking-widest text-gray-600">
            Missing Runbooks
          </h3>
          <div className="flex flex-col gap-1">
            {missingRunbooks.map(({ project }) => (
              <div key={project.id} className="flex items-center gap-2 px-1 py-1 text-xs text-gray-600">
                <span className="text-gray-500">{project.name}</span>
                {project.protected && (
                  <span className="text-amber-600">⚠ protected — runbook needed</span>
                )}
                {!project.protected && (
                  <span className="text-gray-700">— add docs/runbooks/ to repo</span>
                )}
              </div>
            ))}
            {noRepoProjects.map(p => (
              <div key={p.id} className="flex items-center gap-2 px-1 py-1 text-xs text-gray-700">
                <span>{p.name}</span>
                <span>— no repo linked</span>
              </div>
            ))}
          </div>
        </div>
      )}
    </div>
  )
}
