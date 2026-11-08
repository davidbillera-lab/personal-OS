import { notFound } from 'next/navigation'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { ProjectWorkspaceTabs } from '@/components/ProjectWorkspaceTabs'
import { getProjectHealth } from '@/lib/health'
import type { AgentHandoff, KillCriteriaCheck } from '@/lib/types'
import type { LinkedRequest } from '@/lib/task-request'

interface Props {
  params: Promise<{ id: string }>
}

export default async function ProjectWorkspacePage({ params }: Props) {
  const { id } = await params
  const supabase = createAdminSupabaseClient()

  const [
    { data: project },
    { data: brainDumps },
    { data: tasks },
    { data: chats },
    { data: handoffs },
    { data: doneTasks },
    { data: killChecks },
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase.from('brain_dumps').select('*').eq('project_id', id).order('created_at', { ascending: false }),
    supabase.from('tasks').select('*').eq('project_id', id).not('status', 'in', '("done","killed")').order('created_at', { ascending: false }),
    supabase.from('project_chats').select('*').eq('project_id', id).order('created_at', { ascending: true }).limit(50),
    supabase.from('agent_handoffs').select('*').eq('project_id', id).order('started_at', { ascending: false }).limit(20),
    supabase.from('tasks').select('*').eq('project_id', id).eq('status', 'done').order('updated_at', { ascending: false }).limit(20),
    supabase.from('kill_criteria_checks').select('*').eq('project_id', id).order('created_at', { ascending: false }).limit(10),
  ])

  if (!project) notFound()

  const health = await getProjectHealth(id).catch(() => null)

  // Newest linked agent request per open task (read-through; nothing is copied into tasks).
  const taskIds = (tasks ?? []).map(t => t.id)
  const linkedRequests: Record<string, LinkedRequest> = {}
  if (taskIds.length > 0) {
    const { data: requests } = await supabase
      .from('mc_requests')
      .select('id, task_id, status, phase, assigned_to, latest_progress, blocker, result_summary, artifact_refs, plan_submitted_at, plan, plan_by, updated_at')
      .in('task_id', taskIds)
      .order('created_at', { ascending: false })
    for (const r of (requests ?? []) as LinkedRequest[]) {
      if (!linkedRequests[r.task_id]) linkedRequests[r.task_id] = r
    }
  }

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
      doneTasks={doneTasks ?? []}
      initialChats={chats ?? []}
      claudeMd={claudeMd}
      decisionsMd={decisionsMd}
      handoffs={(handoffs ?? []) as AgentHandoff[]}
      health={health}
      killCriteriaChecks={(killChecks ?? []) as KillCriteriaCheck[]}
      linkedRequests={linkedRequests}
    />
  )
}
