import { createAdminSupabaseClient } from '@/lib/supabase'
import { HealthStatus, ProjectHealth } from '@/lib/types'

const CACHE_TTL_MS = 5 * 60 * 1000 // 5 minutes

async function checkGitHub(repoUrl: string | null): Promise<HealthStatus> {
  if (!repoUrl) return 'unknown'
  try {
    // Convert https://github.com/owner/repo → API URL for latest commit
    const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
    if (!match) return 'unknown'
    const [, owner, repo] = match
    const cleanRepo = repo.replace(/\.git$/, '')
    const res = await fetch(
      `https://api.github.com/repos/${owner}/${cleanRepo}/commits?per_page=1`,
      {
        headers: process.env.GITHUB_PAT
          ? { Authorization: `token ${process.env.GITHUB_PAT}` }
          : {},
        next: { revalidate: 0 },
      }
    )
    if (res.status === 200) return 'ok'
    if (res.status === 403 || res.status === 429) return 'warn'
    return 'error'
  } catch {
    return 'error'
  }
}

async function checkVercel(vercelUrl: string | null): Promise<HealthStatus> {
  if (!vercelUrl) return 'unknown'
  try {
    const res = await fetch(vercelUrl, { method: 'HEAD', next: { revalidate: 0 } })
    if (res.ok) return 'ok'
    if (res.status >= 500) return 'error'
    return 'warn'
  } catch {
    return 'error'
  }
}

function checkSupabase(supabaseProjectId: string | null): HealthStatus {
  // We don't call the Supabase management API — just report ok if an ID is recorded
  return supabaseProjectId ? 'ok' : 'unknown'
}

export async function getProjectHealth(projectId: string): Promise<ProjectHealth | null> {
  const supabase = createAdminSupabaseClient()

  // Return cached result if fresh
  const { data: cached } = await supabase
    .from('project_health')
    .select('*')
    .eq('project_id', projectId)
    .single()

  if (cached) {
    const age = Date.now() - new Date(cached.checked_at).getTime()
    if (age < CACHE_TTL_MS) return cached as ProjectHealth
  }

  // Fetch project fields needed for health checks
  const { data: project } = await supabase
    .from('projects')
    .select('repo_url, vercel_url, supabase_project_id, github_repo')
    .eq('id', projectId)
    .single()

  if (!project) return null

  const repoUrl = project.github_repo ?? project.repo_url
  const [github_status, vercel_status] = await Promise.all([
    checkGitHub(repoUrl),
    checkVercel(project.vercel_url),
  ])
  const supabase_status = checkSupabase(project.supabase_project_id)

  const { data: upserted } = await supabase
    .from('project_health')
    .upsert(
      { project_id: projectId, github_status, vercel_status, supabase_status, checked_at: new Date().toISOString() },
      { onConflict: 'project_id' }
    )
    .select()
    .single()

  return (upserted as ProjectHealth | null) ?? null
}
