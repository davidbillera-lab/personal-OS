import { describe, expect, it } from 'vitest'
import { buildTaskRequest, isTaskRoute } from '@/lib/task-request'

const task = { id: 't-1', title: 'Build the thing', generated_spec: '# Spec\nDo it.', project_id: 'p-1' }
const project = { id: 'p-1', name: 'Mission Control', repo_url: 'https://github.com/x/y' }

describe('buildTaskRequest', () => {
  it.each([
    ['hermes_plan', 'submitted', 'hermes'],
    ['codex', 'queued', 'codex'],
    ['claude', 'queued', 'claude'],
  ] as const)('%s route sets status/assigned_to/preferred_worker', (route, status, worker) => {
    const row = buildTaskRequest(task, project, route)
    expect(row.status).toBe(status)
    expect(row.assigned_to).toBe(worker)
    expect(row.preferred_worker).toBe(worker)
    expect(row.source).toBe('dashboard')
    expect(row.created_by).toBe('owner')
  })

  it('throws when the task has no spec', () => {
    expect(() => buildTaskRequest({ ...task, generated_spec: null }, project, 'codex')).toThrow('no spec')
    expect(() => buildTaskRequest({ ...task, generated_spec: '   ' }, project, 'codex')).toThrow('no spec')
  })

  it('truncates the title to 200 characters', () => {
    const row = buildTaskRequest({ ...task, title: 'x'.repeat(250) }, project, 'codex')
    expect(row.title).toHaveLength(200)
  })

  it('carries task_id and project_id and embeds the spec', () => {
    const row = buildTaskRequest(task, { ...project, repo_url: null }, 'hermes_plan')
    expect(row.task_id).toBe('t-1')
    expect(row.project_id).toBe('p-1')
    expect(row.request_text).toContain('[dashboard task t-1] Build the thing')
    expect(row.request_text).toContain('(no repo on file)')
    expect(row.request_text).toContain('SPEC\n# Spec\nDo it.')
  })

  it('rejects unknown routes', () => {
    expect(isTaskRoute('codex')).toBe(true)
    expect(isTaskRoute('dispatcher')).toBe(false)
  })
})
