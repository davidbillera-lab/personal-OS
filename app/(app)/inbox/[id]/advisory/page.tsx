import { notFound } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase'
import type { BrainDump, AbChat } from '@/lib/types'
import { AdvisoryBoardChat } from '@/components/AdvisoryBoardChat'

interface Props {
  params: Promise<{ id: string }>
}

export default async function AdvisoryBoardPage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminSupabaseClient()

  const { data: dump } = await supabase
    .from('brain_dumps')
    .select('*, projects(name)')
    .eq('id', id)
    .single()

  if (!dump) notFound()

  const { data: chats } = await supabase
    .from('ab_chats')
    .select('*')
    .eq('brain_dump_id', id)
    .order('created_at', { ascending: true })

  const typedDump = dump as BrainDump & { project_name?: string | null; projects?: { name: string } | null }
  const projectName = typedDump.projects?.name ?? null

  return (
    <AdvisoryBoardChat
      dump={{ ...typedDump, project_name: projectName }}
      chats={(chats ?? []) as AbChat[]}
    />
  )
}
