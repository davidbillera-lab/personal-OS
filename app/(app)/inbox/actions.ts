'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase'
import type { BrainDumpType } from '@/lib/types'

export async function archiveDump(id: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase
    .from('brain_dumps')
    .update({ status: 'archived' })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function routeDump(id: string, projectId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase
    .from('brain_dumps')
    .update({ project_id: projectId, status: 'actioned' })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function promoteDump(
  id: string,
  projectId: string | null,
  title: string
): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.from('tasks').insert({
    brain_dump_id: id,
    project_id: projectId,
    title,
    status: 'pending',
  })
  await supabase
    .from('brain_dumps')
    .update({ status: 'actioned' })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function reclassifyDump(id: string, newType: BrainDumpType): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase
    .from('brain_dumps')
    .update({ classified_type: newType })
    .eq('id', id)
  revalidatePath('/inbox')
}
