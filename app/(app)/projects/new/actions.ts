'use server'

import { redirect } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase'
import type { ProjectStage, ProjectTier } from '@/lib/types'

export async function createProject(formData: FormData) {
  const supabase = await createServerSupabaseClient()

  const name = (formData.get('name') as string).trim()
  const tier = parseInt(formData.get('tier') as string) as ProjectTier
  const stage = formData.get('stage') as ProjectStage
  const isProtected = formData.get('protected') === 'true'
  const description = (formData.get('description') as string | null)?.trim() || null
  const repo_url = (formData.get('repo_url') as string | null)?.trim() || null
  const local_path = (formData.get('local_path') as string | null)?.trim() || null
  const status = (formData.get('status') as string | null)?.trim() || null
  const next_action = (formData.get('next_action') as string | null)?.trim() || null
  const blockers = (formData.get('blockers') as string | null)?.trim() || null
  const exit_thesis = (formData.get('exit_thesis') as string | null)?.trim() || null
  const lead_model = (formData.get('lead_model') as string | null)?.trim() || null

  const slug = name.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')

  const { data, error } = await supabase
    .from('projects')
    .insert({
      name,
      slug,
      tier,
      stage,
      protected: isProtected,
      description,
      repo_url,
      local_path,
      status,
      next_action,
      blockers,
      exit_thesis,
      lead_model,
      last_update: new Date().toISOString(),
    })
    .select('id')
    .single()

  if (error || !data) {
    throw new Error(error?.message ?? 'Failed to create project')
  }

  redirect(`/projects/${data.id}`)
}
