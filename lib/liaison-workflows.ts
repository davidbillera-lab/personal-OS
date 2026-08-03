export const JARVIS_WORKFLOW_TYPE = 'spec_build_qc_push'

export const LIAISON_WORKERS = [
  { id: 'hermes', role: 'specification', capability: 'Drafts and revises requirements and acceptance criteria.' },
  { id: 'claude', role: 'implementation', capability: 'Builds and fixes code in the approved repository workflow.' },
  { id: 'codex-qc', role: 'quality_control', capability: 'Independently reviews the candidate implementation.' },
] as const

export type LiaisonWorkerId = (typeof LIAISON_WORKERS)[number]['id']

export function isLiaisonWorker(value?: string | null): value is LiaisonWorkerId {
  return LIAISON_WORKERS.some(worker => worker.id === value)
}

export function validateLiaisonAssignment(
  status: string,
  requestText: string | null | undefined,
  worker: string,
): LiaisonWorkerId {
  if (!isLiaisonWorker(worker)) {
    throw new Error(`worker must be one of: ${LIAISON_WORKERS.map(item => item.id).join(', ')}`)
  }
  if (
    workflowTypeFromRequestText(requestText) === JARVIS_WORKFLOW_TYPE &&
    status === 'submitted' &&
    worker !== 'hermes'
  ) {
    throw new Error('Submitted Jarvis workflows must remain assigned to hermes until planning advances their state')
  }
  return worker
}

export type ResumePlan = {
  status: 'submitted' | 'queued'
  assigned_to: LiaisonWorkerId | null
  preferred_worker: 'hermes' | 'auto'
  phase: null
}

export function planRequestResume(
  status: string,
  requestText?: string | null,
  blocker?: string | null,
): ResumePlan {
  if (status === 'awaiting_approval') {
    throw new Error('Request is awaiting approval; resolve the exact approval instead of resuming it')
  }
  if (status === 'completed' || status === 'cancelled') {
    throw new Error(`Cannot resume terminal request with status '${status}'`)
  }
  if (status !== 'blocked' && status !== 'failed') {
    throw new Error(`Resume is only allowed from blocked or failed (current: '${status}')`)
  }
  if (blocker?.trimStart().startsWith('auto-classifier:')) {
    throw new Error(
      'This request is under a safety hold and cannot be resumed from the Liaison; it needs explicit operator clearance',
    )
  }

  if (workflowTypeFromRequestText(requestText) === JARVIS_WORKFLOW_TYPE) {
    return { status: 'submitted', assigned_to: 'hermes', preferred_worker: 'hermes', phase: null }
  }
  return { status: 'queued', assigned_to: null, preferred_worker: 'auto', phase: null }
}

export const LIAISON_INSTRUCTIONS = [
  'Mission Control is the system of record. Resolve spoken project names with mc_list_projects; never guess.',
  'Use mc_start_workflow for the Hermes-plan, Claude-build, Codex-review workflow. It records a submitted workflow only: do not say planning, building, QC, or pushing started unless mc_get_workflow_status proves it.',
  'Before any approval, fetch current workflow status and bind the decision to its exact attempt_id.',
  'Treat push as a working-branch push only. Never imply merge, deploy, spend, external send, or credential access.',
  'Report blockers plainly and return only evidence read from Mission Control.',
].join(' ')

export type WorkflowProject = {
  id: string
  name: string
  slug: string
}

export function buildWorkflowRequestText(
  project: WorkflowProject,
  outcome: string,
  constraints?: string,
): string {
  const lines = [
    `Workflow: ${JARVIS_WORKFLOW_TYPE}`,
    `Project: ${project.name} (${project.slug}; ${project.id})`,
    `Outcome: ${outcome.trim()}`,
  ]
  if (constraints?.trim()) lines.push(`Constraints: ${constraints.trim()}`)
  lines.push(
    'Required sequence: Hermes drafts the spec; Claude validates it against the repository and builds it; Codex independently reviews the exact commit; Mission Control holds any consequential action for David.',
    'Delivery boundary: working-branch push only after exact attempt/SHA approval; never merge or deploy automatically.',
  )
  return lines.join('\n')
}

export function workflowTitle(outcome: string, supplied?: string): string {
  const title = supplied?.trim() || `Jarvis: ${outcome.trim()}`
  return title.slice(0, 200)
}

export function workflowTypeFromRequestText(requestText?: string | null): string | null {
  return requestText?.startsWith(`Workflow: ${JARVIS_WORKFLOW_TYPE}\n`)
    ? JARVIS_WORKFLOW_TYPE
    : null
}
