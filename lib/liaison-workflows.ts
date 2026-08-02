export const JARVIS_WORKFLOW_TYPE = 'spec_build_qc_push'

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
