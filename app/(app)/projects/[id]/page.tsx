import { notFound } from 'next/navigation'
import { createServerSupabaseClient } from '@/lib/supabase'
import { ProjectWorkspaceTabs } from '@/components/ProjectWorkspaceTabs'
import { getProjectHealth } from '@/lib/health'
import type { AgentHandoff } from '@/lib/types'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectWorkspacePage({ params }: Props) {
  const { id } = await params
  const supabase = await createServerSupabaseClient()

  const [
    { data: project },
    { data: brainDumps },
    { data: tasks },
    { data: chats },
    { data: handoffs },
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase.from('brain_dumps').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('project_id', id).not('status', 'in', '("done","killed")').order('created_at', { ascending: false }),
    supabase.from('project_chats').select('*').eq('project_id', id).order('created_at', { ascending: true }).limit(50),
    supabase.from('agent_handoffs').select('*').eq('project_id', id).order('started_at', { ascending: false }).limit(20),
  ])

  if (!project) notFound()

  const health = await getProjectHealth(id)

  let claudeMd = ''
  let decisionsMd = ''

  if (project.repo_url) {
    const pat = process.env.GITHUB_PAT
    const rawBase = project.repo_url
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      + '/main'
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {}

    const [cRes, dRes] = await Promise.allSettled([
      fetch(`${rawBase}/CLAUDE.md`, { headers }),
      fetch(`${rawBase}/decisions.md`, { headers }),
    ])

    if (cRes.status === 'fulfilled' && cRes.value.ok) claudeMd = await cRes.value.text()
    if (dRes.status === 'fulfilled' && dRes.value.ok) decisionsMd = await dRes.value.text()
  }

  return (
    <ProjectWorkspaceTabs
      project={project}
      brainDumps={brainDumps ?? []}
      tasks={tasks ?? []}
      initialChats={chats ?? []}
      claudeMd={claudeMd}
      decisionsMd={decisionsMd}
      handoffs={(handoffs ?? []) as AgentHandoff[]}
      health={health}
    />
  )
}
