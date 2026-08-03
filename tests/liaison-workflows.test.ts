import { describe, expect, it } from 'vitest'
import {
  buildWorkflowRequestText,
  isLiaisonWorker,
  JARVIS_WORKFLOW_TYPE,
  LIAISON_INSTRUCTIONS,
  planRequestResume,
  validateLiaisonAssignment,
  workflowTitle,
  workflowTypeFromRequestText,
} from '@/lib/liaison-workflows'
import { isToolAllowed, toolsForScope } from '@/lib/mcp-tools'

describe('Jarvis Liaison contract', () => {
  it('advertises only the approved Liaison surface', () => {
    const names = toolsForScope('liaison').map(tool => tool.name).sort()
    expect(names).toEqual([
      'mc_assign_request',
      'mc_get_project_summary',
      'mc_get_request',
      'mc_get_request_status',
      'mc_get_result',
      'mc_get_workflow_result',
      'mc_get_workflow_status',
      'mc_list_pending_approvals',
      'mc_list_projects',
      'mc_list_recent_requests',
      'mc_list_workers',
      'mc_queue_status',
      'mc_respond_approval',
      'mc_resume_request',
      'mc_start_workflow',
      'mc_submit_request',
      'mc_whats_stalled',
    ])
    expect(isToolAllowed('mc_start_workflow', 'liaison')).toBe(true)
    expect(isToolAllowed('mc_claim_request', 'liaison')).toBe(false)
    expect(isToolAllowed('mc_get_credential', 'liaison')).toBe(false)
    expect(isToolAllowed('mc_write_vault', 'liaison')).toBe(false)
  })

  it('restricts Liaison assignment to the fixed worker policy', () => {
    expect(isLiaisonWorker('hermes')).toBe(true)
    expect(isLiaisonWorker('claude')).toBe(true)
    expect(isLiaisonWorker('codex-qc')).toBe(true)
    expect(isLiaisonWorker('full')).toBe(false)
    expect(isLiaisonWorker('claude; deploy')).toBe(false)
    expect(validateLiaisonAssignment('submitted', 'Legacy request', 'claude')).toBe('claude')
    expect(() => validateLiaisonAssignment(
      'submitted',
      `Workflow: ${JARVIS_WORKFLOW_TYPE}\nProject: Mission Control`,
      'claude',
    )).toThrow('must remain assigned to hermes')
  })

  it('resumes Jarvis workflows through Hermes without bypassing planning', () => {
    const requestText = `Workflow: ${JARVIS_WORKFLOW_TYPE}\nProject: Mission Control`
    expect(planRequestResume('blocked', requestText)).toEqual({
      status: 'submitted',
      assigned_to: 'hermes',
      preferred_worker: 'hermes',
      phase: null,
    })
    expect(planRequestResume('failed', 'Legacy request')).toEqual({
      status: 'queued',
      assigned_to: null,
      preferred_worker: 'auto',
      phase: null,
    })
  })

  it('does not use resume to bypass approval or restart terminal work', () => {
    expect(() => planRequestResume('awaiting_approval', 'Legacy request')).toThrow('resolve the exact approval')
    expect(() => planRequestResume('completed', 'Legacy request')).toThrow('terminal request')
    expect(() => planRequestResume('cancelled', 'Legacy request')).toThrow('terminal request')
    expect(() => planRequestResume('in_progress', 'Legacy request')).toThrow('only allowed from blocked or failed')
  })

  it('does not resume an auto-classifier safety hold', () => {
    expect(() => planRequestResume(
      'blocked',
      'Legacy request',
      'auto-classifier: dangerous operation requires operator review',
    )).toThrow('under a safety hold')
    expect(() => planRequestResume(
      'failed',
      `Workflow: ${JARVIS_WORKFLOW_TYPE}\nProject: Mission Control`,
      '  auto-classifier: novel dangerous request',
    )).toThrow('explicit operator clearance')
  })

  it('creates a deterministic, bounded workflow handoff', () => {
    const text = buildWorkflowRequestText(
      { id: 'project-123', name: 'Mission Control', slug: 'mission-control' },
      'Build the remote voice liaison',
      'Do not merge or deploy',
    )

    expect(text).toContain(`Workflow: ${JARVIS_WORKFLOW_TYPE}`)
    expect(text).toContain('Project: Mission Control (mission-control; project-123)')
    expect(text).toContain('Outcome: Build the remote voice liaison')
    expect(text).toContain('Hermes drafts the spec')
    expect(text).toContain('Claude validates it')
    expect(text).toContain('Codex independently reviews')
    expect(text).toContain('working-branch push only')
    expect(text).toContain('never merge or deploy automatically')
  })

  it('keeps voice-facing titles concise', () => {
    expect(workflowTitle('  Test the workflow  ')).toBe('Jarvis: Test the workflow')
    expect(workflowTitle('ignored', '  Named workflow  ')).toBe('Named workflow')
    expect(workflowTitle('x'.repeat(300))).toHaveLength(200)
  })

  it('does not mislabel legacy requests as Jarvis workflows', () => {
    expect(workflowTypeFromRequestText(`Workflow: ${JARVIS_WORKFLOW_TYPE}\nProject: MC`)).toBe(JARVIS_WORKFLOW_TYPE)
    expect(workflowTypeFromRequestText('Build this directly')).toBeNull()
    expect(workflowTypeFromRequestText(null)).toBeNull()
  })

  it('instructs the coordinator to resolve names and report evidence only', () => {
    expect(LIAISON_INSTRUCTIONS).toContain('never guess')
    expect(LIAISON_INSTRUCTIONS).toContain('do not say planning, building, QC, or pushing started')
    expect(LIAISON_INSTRUCTIONS).toContain('exact attempt_id')
    expect(LIAISON_INSTRUCTIONS).toContain('Never imply merge, deploy, spend, external send, or credential access')
  })
})
