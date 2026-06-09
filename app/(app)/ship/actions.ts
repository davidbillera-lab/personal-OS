'use server'

import { createAdminSupabaseClient } from '@/lib/supabase'
import { revalidatePath } from 'next/cache'

export async function updateShipChecklistItem(
  projectId: string,
  key: string,
  checked: boolean
): Promise<{ ok?: boolean; error?: string }> {
  const supabase = createAdminSupabaseClient()
  const { data: project } = await supabase
    .from('projects')
    .select('ship_checklist')
    .eq('id', projectId)
    .single()
  if (!project) return { error: 'Project not found' }
  const current = (project.ship_checklist as Record<string, boolean>) ?? {}
  const updated = { ...current, [key]: checked }
  const { error } = await supabase
    .from('projects')
    .update({ ship_checklist: updated })
    .eq('id', projectId)
  if (error) return { error: error.message }
  revalidatePath('/ship')
  return { ok: true }
}

export async function triggerGitHubWorkflow(
  repoUrl: string,
  workflow: string,
  ref: string = 'main'
): Promise<{ ok?: boolean; error?: string }> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+?)(?:\.git)?$/)
  if (!match) return { error: 'Invalid GitHub repo URL' }
  const [, owner, repo] = match
  const pat = process.env.GITHUB_PAT
  if (!pat) return { error: 'GITHUB_PAT not configured' }
  const res = await fetch(
    `https://api.github.com/repos/${owner}/${repo}/actions/workflows/${workflow}/dispatches`,
    {
      method: 'POST',
      headers: {
        Accept: 'application/vnd.github+json',
        Authorization: `token ${pat}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ ref }),
    }
  )
  if (!res.ok) {
    const body = await res.json().catch(() => ({}))
    return { error: (body as { message?: string }).message ?? `GitHub API error: ${res.status}` }
  }
  return { ok: true }
}
