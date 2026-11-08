import type { Project, Task } from '@/lib/types'

// Dashboard "Send to agent" routes. Spec: specs/2026-11-06-mc-dashboard-agent-bridge.md
export type TaskRoute = 'hermes_plan' | 'codex' | 'claude'
export const TASK_ROUTES: TaskRoute[] = ['hermes_plan', 'codex', 'claude']

export const ROUTE_LABELS: Record<TaskRoute, string> = {
  hermes_plan: 'Hermes plans first',
  codex: 'Codex builds',
  claude: 'Claude builds',
}

const ROUTES: Record<TaskRoute, { status: 'submitted' | 'queued'; worker: 'hermes' | 'codex' | 'claude'; progress: string }> = {
  hermes_plan: { status: 'submitted', worker: 'hermes', progress: 'Sent from dashboard; waiting for Hermes to plan.' },
  codex: { status: 'queued', worker: 'codex', progress: 'Sent from dashboard; waiting for codex to pick it up.' },
  claude: { status: 'queued', worker: 'claude', progress: 'Sent from dashboard; waiting for claude to pick it up.' },
}

export type LinkedRequest = {
  id: string
  task_id: string
  status: string
  phase: string | null
  assigned_to: string | null
  latest_progress: string | null
  blocker: string | null
  result_summary: string | null
  artifact_refs: unknown
  plan_submitted_at: string | null
  plan: string | null
  plan_by: string | null
  updated_at: string
}

export const FINISHED_STATUSES = ['completed', 'failed', 'cancelled']

// Plain-English line for the task card (spec table "Request state -> Status line").
export function requestStatusLine(r: Pick<LinkedRequest, 'status' | 'assigned_to' | 'blocker' | 'plan_submitted_at'>): string {
  const worker = r.assigned_to ?? 'an agent'
  switch (r.status) {
    case 'submitted': return r.plan_submitted_at ? 'Plan ready, review it below' : 'Waiting for Hermes to plan'
    case 'queued': return `Waiting for ${worker} to pick it up`
    case 'claimed':
    case 'in_progress': return `${worker} is working`
    case 'blocked': return `Blocked: ${r.blocker ?? 'no reason given'}`
    case 'awaiting_approval': return 'Needs your approval'
    case 'completed': return 'Agent finished, run QC'
    case 'failed': return 'Failed, re-send available'
    case 'cancelled': return 'Cancelled, re-send available'
    default: return r.status
  }
}

// First pull-request URL in artifact_refs (strings or objects with url/href). The dispatcher
// stores [repoURL, sha], so a bare http(s) match would label the repo homepage "View PR".
export function firstPrUrl(refs: unknown): string | null {
  if (!Array.isArray(refs)) return null
  for (const ref of refs) {
    const candidate = typeof ref === 'string' ? ref
      : ref && typeof ref === 'object' ? ((ref as Record<string, unknown>).url ?? (ref as Record<string, unknown>).href) : null
    if (typeof candidate === 'string' && /^https?:\/\/\S+\/pull\/\d+/.test(candidate)) return candidate
  }
  return null
}

export function isTaskRoute(value: unknown): value is TaskRoute {
  return typeof value === 'string' && (TASK_ROUTES as string[]).includes(value)
}

export function routeWorker(route: TaskRoute): 'hermes' | 'codex' | 'claude' {
  return ROUTES[route].worker
}

export function buildTaskRequest(
  task: Pick<Task, 'id' | 'title' | 'generated_spec' | 'project_id'>,
  project: Pick<Project, 'id' | 'name' | 'repo_url'>,
  route: TaskRoute,
) {
  const spec = task.generated_spec?.trim()
  if (!spec) throw new Error('Task has no spec to send')
  const r = ROUTES[route]
  if (!r) throw new Error('Unknown route')

  const request_text = [
    `[dashboard task ${task.id}] ${task.title}`,
    `Project: ${project.name} (${project.repo_url ?? 'no repo on file'})`,
    'Sent from the Mission Control dashboard. The spec below is owner-approved.',
    '',
    'SPEC',
    spec,
    '',
    'When finished, complete this request through the normal worker interface with a result summary and the PR link. The operator runs QC from the dashboard.',
  ].join('\n')

  return {
    title: task.title.slice(0, 200),
    request_text,
    project_id: project.id,
    task_id: task.id,
    status: r.status,
    assigned_to: r.worker,
    preferred_worker: r.worker,
    source: 'dashboard',
    created_by: 'owner',
    priority: 'normal',
    latest_progress: r.progress,
  }
}
