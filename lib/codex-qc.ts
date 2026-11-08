import { createAdminSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import { revalidatePath } from 'next/cache'

// Unguarded QC core: no 'use server', so it is never a public endpoint. Callers authorize first:
// the owner-gated wrappers in app/(app)/projects/[id]/actions.ts, or mc_complete_task (MCP key).

export async function runCodexQCCore(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  const supabase = createAdminSupabaseClient()
  const { data: task } = await supabase.from('tasks').select('title, generated_spec').eq('id', taskId).single()
  if (!task) return { error: 'Task not found' }
  const system = `You are a code reviewer. Review the diff against the original spec.

Check for:
1. Correctness — does the code do what the spec asked?
2. Regressions — does anything look broken that wasn't touched?
3. Scope adherence — did the agent go out of scope or leave things undone?
4. Code quality — anything obviously wrong?

Respond ONLY with valid JSON:
{"status": "passed" | "issues_found", "notes": "If passed: confirm what was verified. If issues_found: list each issue clearly."}`
  const prompt = `Original spec:\n${task.generated_spec ?? '(no spec recorded)'}\n\nGit diff:\n${diff}\n\nCommit: ${commitUrl ?? 'not provided'}`
  let result: Awaited<ReturnType<typeof routeTask>>
  try {
    result = await routeTask({ prompt, system, complexity_tier: 4, model: 'gpt-4o', purpose: 'codex_qc', project_id: projectId, task_id: taskId, supabase })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'QC model call failed' }
  }
  let status: 'passed' | 'issues_found' = 'passed'
  let notes = ''
  try {
    const parsed = JSON.parse(result.text)
    status = (['passed', 'issues_found'] as const).includes(parsed.status) ? parsed.status : 'issues_found'
    notes = parsed.notes ?? ''
  } catch { notes = result.text }
  await supabase.from('tasks').update({ codex_qc_status: status, codex_qc_notes: notes, status: status === 'passed' ? 'done' : 'review' }).eq('id', taskId)
  if (commitUrl && status === 'passed') {
    await supabase.from('agent_handoffs').update({ status: 'done', github_commit_url: commitUrl, completed_at: new Date().toISOString() }).eq('task_id', taskId)
  }
  if (status === 'passed') {
    await runProjectShipAdvisoryBoard(projectId)
  }
  revalidatePath(`/projects/${projectId}`)
  return { status, notes }
}

export async function rerunCodexQCCore(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  const supabase = createAdminSupabaseClient()
  const { data: task } = await supabase
    .from('tasks')
    .select('title, generated_spec, codex_qc_status')
    .eq('id', taskId)
    .single()
  if (!task) return { error: 'Task not found' }

  const wasAlreadyIssues = task.codex_qc_status === 'issues_found'

  const system = `You are a code reviewer. Review the diff against the original spec.

Check for:
1. Correctness — does the code do what the spec asked?
2. Regressions — does anything look broken that wasn't touched?
3. Scope adherence — did the agent go out of scope or leave things undone?
4. Code quality — anything obviously wrong?

Respond ONLY with valid JSON:
{"status": "passed" | "issues_found", "notes": "If passed: confirm what was verified. If issues_found: list each issue clearly."}`
  const prompt = `Original spec:\n${task.generated_spec ?? '(no spec recorded)'}\n\nGit diff:\n${diff}\n\nCommit: ${commitUrl ?? 'not provided'}`
  let result: Awaited<ReturnType<typeof routeTask>>
  try {
    result = await routeTask({ prompt, system, complexity_tier: 4, model: 'gpt-4o', purpose: 'codex_qc_rerun', project_id: projectId, task_id: taskId, supabase })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'QC model call failed' }
  }
  let newStatus: 'passed' | 'issues_found' = 'passed'
  let notes = ''
  try {
    const parsed = JSON.parse(result.text)
    newStatus = (['passed', 'issues_found'] as const).includes(parsed.status) ? parsed.status : 'issues_found'
    notes = parsed.notes ?? ''
  } catch { notes = result.text }

  const finalStatus = wasAlreadyIssues && newStatus === 'issues_found' ? 'loop_detected' : newStatus
  await supabase.from('tasks').update({
    codex_qc_status: finalStatus,
    codex_qc_notes: notes,
    status: finalStatus === 'passed' ? 'done' : 'review',
  }).eq('id', taskId)
  if (commitUrl && finalStatus === 'passed') {
    await supabase.from('agent_handoffs').update({ status: 'done', github_commit_url: commitUrl, completed_at: new Date().toISOString() }).eq('task_id', taskId)
  }
  if (finalStatus === 'passed') {
    await runProjectShipAdvisoryBoard(projectId)
  }
  revalidatePath(`/projects/${projectId}`)
  return { status: finalStatus as 'passed' | 'issues_found' | 'loop_detected', notes }
}

export async function runProjectShipAdvisoryBoard(projectId: string) {
  const supabase = createAdminSupabaseClient()

  // Only run if all tasks are done — bail fast for intermediate completions
  const { count } = await supabase
    .from('tasks')
    .select('id', { count: 'exact', head: true })
    .eq('project_id', projectId)
    .not('status', 'in', '("done","killed")')
  if ((count ?? 1) > 0) return { skipped: true }

  const { data: project } = await supabase
    .from('projects')
    .select('name, stage, status, next_action, blockers, description')
    .eq('id', projectId)
    .single()
  if (!project) return { error: 'Project not found' }

  const { data: tasks } = await supabase
    .from('tasks')
    .select('title, generated_spec, codex_qc_notes, codex_qc_status')
    .eq('project_id', projectId)
    .eq('status', 'done')

  const taskSummary = (tasks ?? [])
    .map(t => `- ${t.title}${t.codex_qc_notes ? ` (QC: ${t.codex_qc_notes})` : ''}`)
    .join('\n')

  const system = `You are the Advisory Board for a solo AI-native holdco operator. Evaluate whether this project is ready to ship — meaning it is complete, stable, and worth launching publicly. Give an honest verdict.

Apply four kill criteria: Functionality (solves a real problem?), Efficiency (right solution?), Scalability (grows without proportional work?), Time-to-revenue (realistic return timeline?).

Respond ONLY with valid JSON:
{"verdict": "keep" | "kill", "reasoning": "Full argument. If keep: what makes it ship-ready and what to watch after launch. If kill: why it should not ship."}`

  const prompt = `Project: ${project.name} (Stage: ${project.stage})
Status: ${project.status ?? 'none'}
Description: ${project.description ?? 'none'}
Next action: ${project.next_action ?? 'none'}
Blockers: ${project.blockers ?? 'none'}

All build tasks completed:
${taskSummary || '(no tasks recorded)'}

All tasks are done. Is this project ready to ship?`

  let result: Awaited<ReturnType<typeof routeTask>>
  try {
    result = await routeTask({
      prompt, system, complexity_tier: 2, purpose: 'ship_advisory_board',
      project_id: projectId, supabase,
    })
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'Ship advisory board model call failed' }
  }

  let verdict: 'keep' | 'kill' = 'keep'
  let reasoning = ''
  try {
    const cleaned = result.text.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim()
    const parsed = JSON.parse(cleaned)
    verdict = (['keep', 'kill'] as const).includes(parsed.verdict) ? parsed.verdict : 'keep'
    reasoning = parsed.reasoning ?? ''
  } catch { reasoning = result.text }

  await supabase.from('projects').update({ ship_ab_verdict: verdict, ship_ab_reasoning: reasoning }).eq('id', projectId)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  return { verdict, reasoning }
}
