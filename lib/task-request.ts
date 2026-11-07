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
