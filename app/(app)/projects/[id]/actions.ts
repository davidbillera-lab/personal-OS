'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import { revalidatePath } from 'next/cache'

export async function runAdvisoryBoard(dumpId: string, projectId: string) {
  const supabase = await createServerSupabaseClient()
  const { data: dump } = await supabase
    .from('brain_dumps')
    .select('raw_text, classified_type, ai_summary')
    .eq('id', dumpId)
    .single()
  const { data: project } = await supabase
    .from('projects')
    .select('name, stage, status, next_action, blockers')
    .eq('id', projectId)
    .single()
  if (!dump || !project) return { error: 'Dump or project not found' }
  const system = `You are the Advisory Board for a solo AI-native holdco operator. Give honest kill/keep verdicts on ideas — no sugarcoating.

Apply four kill criteria: Functionality (solves a real problem?), Efficiency (right solution?), Scalability (grows without proportional work?), Time-to-revenue (realistic return timeline?).

Respond ONLY with valid JSON:
{"verdict": "keep" | "kill", "reasoning": "Full argument. If kill: why it won't work specifically. If keep: what makes it worth building and what to watch for."}`
  const prompt = `Project: ${project.name} (Stage: ${project.stage})
Status: ${project.status ?? 'none'}
Next action: ${project.next_action ?? 'none'}
Blockers: ${project.blockers ?? 'none'}

Brain dump (type: ${dump.classified_type ?? 'unclassified'}):
"${dump.raw_text}"`
  const result = await routeTask({
    prompt, system, complexity_tier: 1, purpose: 'advisory_board',
    project_id: projectId, brain_dump_id: dumpId, supabase,
  })
  let verdict: 'keep' | 'kill' = 'keep'
  let reasoning = ''
  try {
    const parsed = JSON.parse(result.text)
    verdict = (['keep', 'kill'] as const).includes(parsed.verdict) ? parsed.verdict : 'keep'
    reasoning = parsed.reasoning ?? ''
  } catch { reasoning = result.text }
  await supabase.from('brain_dumps').update({ ab_verdict: verdict, ab_reasoning: reasoning }).eq('id', dumpId)
  revalidatePath(`/projects/${projectId}`)
  return { verdict, reasoning }
}

export async function generateSpec(dumpId: string, projectId: string, claudeMd: string, decisionsMd: string) {
  const supabase = await createServerSupabaseClient()
  const { data: dump } = await supabase.from('brain_dumps')
    .select('raw_text, classified_type, ai_summary, ab_verdict, ab_reasoning')
    .eq('id', dumpId).single()
  if (!dump) return { error: 'Dump not found' }
  const system = `You are a technical spec writer for an AI-native operator. Write a concise, context-loaded implementation spec.

The spec must include:
1. Task description (plain English — what to build and why)
2. Relevant context (project stage, status, blockers)
3. Files likely involved (best guess from the task description)
4. Recommended model tier (1–4) with reasoning
5. Recommended tool (claude_code / codex / cursor) with reasoning
6. Acceptance criteria (how to know it's done)

Be specific. No fluff. The engineer reading this has zero context about the project.`
  const prompt = `CLAUDE.md:\n${claudeMd || '(not available)'}\n\ndecisions.md:\n${decisionsMd || '(not available)'}\n\nBrain dump:\n"${dump.raw_text}"\n\nAdvisory Board verdict: ${dump.ab_verdict ?? 'none'} — ${dump.ab_reasoning ?? ''}\n\nGenerate the implementation spec.`
  const result = await routeTask({ prompt, system, complexity_tier: 2, purpose: 'spec_generation', project_id: projectId, brain_dump_id: dumpId, supabase })
  const specContent = result.text
  const today = new Date().toISOString().slice(0, 10)
  const slug = dump.raw_text.toLowerCase().replace(/[^a-z0-9\s-]/g, '').replace(/\s+/g, '-').slice(0, 60)
  const specPath = `docs/superpowers/plans/${today}-${slug}.md`
  const tier = dump.classified_type === 'bug' ? 1 : 2
  const tool = 'claude_code'
  const { data: task, error } = await supabase.from('tasks').insert({
    project_id: projectId, brain_dump_id: dumpId,
    title: dump.raw_text.slice(0, 120), description: dump.ai_summary,
    complexity_tier: tier, recommended_tool: tool, tool, model_tier: tier,
    generated_spec: specContent, spec_path: specPath, status: 'pending',
  }).select().single()
  if (error) return { error: error.message }
  await supabase.from('brain_dumps').update({ status: 'spec_generated' }).eq('id', dumpId)
  revalidatePath(`/projects/${projectId}`)
  return { task, specContent, specPath }
}

export async function approveSpec(taskId: string, projectId: string, localPath?: string) {
  const supabase = await createServerSupabaseClient()
  const { data: task } = await supabase.from('tasks').select('title, spec_path, generated_spec').eq('id', taskId).single()
  if (!task) return { error: 'Task not found' }
  const { error: updateError } = await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', taskId)
  if (updateError) return { error: updateError.message }
  const { error: handoffError } = await supabase.from('agent_handoffs').insert({
    project_id: projectId, task_id: taskId, agent_name: 'Claude Code',
    task_description: task.title, spec_path: task.spec_path, status: 'in_progress',
  })
  if (handoffError) return { error: handoffError.message }
  revalidatePath(`/projects/${projectId}`)
  const vscodePath = localPath ? `vscode://file/${localPath.replace(/\\/g, '/')}` : null
  return { ok: true, vscodePath }
}

export async function runCodexQC(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  const supabase = await createServerSupabaseClient()
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
  const result = await routeTask({ prompt, system, complexity_tier: 4, model: 'gpt-4o', purpose: 'codex_qc', project_id: projectId, task_id: taskId, supabase })
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

export async function rerunCodexQCOnSpec(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  const supabase = await createServerSupabaseClient()
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
  const result = await routeTask({ prompt, system, complexity_tier: 4, model: 'gpt-4o', purpose: 'codex_qc_rerun', project_id: projectId, task_id: taskId, supabase })
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

export type RepoEntry = { name: string; type: 'file' | 'dir'; path: string; html_url: string }

export async function fetchRepoContents(
  repoUrl: string,
  path: string = ''
): Promise<{ entries?: RepoEntry[]; error?: string }> {
  const match = repoUrl.match(/github\.com\/([^/]+)\/([^/]+)/)
  if (!match) return { error: 'Invalid GitHub URL' }
  const [, owner, repo] = match
  const apiUrl = `https://api.github.com/repos/${owner}/${repo}/contents/${path}`
  const pat = process.env.GITHUB_PAT
  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    ...(pat ? { Authorization: `token ${pat}` } : {}),
  }
  try {
    const res = await fetch(apiUrl, { headers, next: { revalidate: 60 } })
    if (!res.ok) return { error: `GitHub API error: ${res.status}` }
    const data = await res.json()
    if (!Array.isArray(data)) return { error: 'Unexpected response from GitHub' }
    const entries: RepoEntry[] = data
      .filter((e: { type: string }) => e.type === 'file' || e.type === 'dir')
      .map((e: { name: string; type: string; path: string; html_url: string }) => ({
        name: e.name,
        type: e.type as 'file' | 'dir',
        path: e.path,
        html_url: e.html_url,
      }))
      .sort((a: RepoEntry, b: RepoEntry) => {
        if (a.type === b.type) return a.name.localeCompare(b.name)
        return a.type === 'dir' ? -1 : 1
      })
    return { entries }
  } catch {
    return { error: 'Failed to fetch repo contents' }
  }
}

export async function updateAgentHandoff(
  handoffId: string,
  projectId: string,
  fields: { status?: string; outcome?: string; github_commit_url?: string }
) {
  const supabase = await createServerSupabaseClient()
  const update: Record<string, string | null> = {}
  if (fields.status !== undefined) update.status = fields.status
  if (fields.outcome !== undefined) update.outcome = fields.outcome
  if (fields.github_commit_url !== undefined) update.github_commit_url = fields.github_commit_url || null
  if (fields.status === 'done') update.completed_at = new Date().toISOString()
  const { error } = await supabase.from('agent_handoffs').update(update).eq('id', handoffId)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function markTaskDone(taskId: string, projectId: string) {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function archiveProject(projectId: string) {
  const supabase = await createServerSupabaseClient()
  // Kill all pending/in-progress tasks so they don't linger
  await supabase
    .from('tasks')
    .update({ status: 'killed' })
    .eq('project_id', projectId)
    .in('status', ['pending', 'in_progress', 'review'])
  // Mark any open handoffs as done
  await supabase
    .from('agent_handoffs')
    .update({ status: 'done', completed_at: new Date().toISOString() })
    .eq('project_id', projectId)
    .eq('status', 'in_progress')
  const { error } = await supabase
    .from('projects')
    .update({ stage: 'kill', status: 'Archived.' })
    .eq('id', projectId)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  return { ok: true }
}

export async function runProjectShipAdvisoryBoard(projectId: string) {
  const supabase = await createServerSupabaseClient()

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

  const result = await routeTask({
    prompt, system, complexity_tier: 2, purpose: 'ship_advisory_board',
    project_id: projectId, supabase,
  })

  let verdict: 'keep' | 'kill' = 'keep'
  let reasoning = ''
  try {
    const parsed = JSON.parse(result.text)
    verdict = (['keep', 'kill'] as const).includes(parsed.verdict) ? parsed.verdict : 'keep'
    reasoning = parsed.reasoning ?? ''
  } catch { reasoning = result.text }

  await supabase.from('projects').update({ ship_ab_verdict: verdict, ship_ab_reasoning: reasoning }).eq('id', projectId)
  revalidatePath(`/projects/${projectId}`)
  revalidatePath('/')
  return { verdict, reasoning }
}

export async function generateSuggestions(projectId: string) {
  const supabase = await createServerSupabaseClient()
  const { data: project } = await supabase.from('projects')
    .select('name, stage, status, next_action, blockers, description').eq('id', projectId).single()
  if (!project) return { error: 'Project not found', suggestions: null }
  const { data: recentDumps } = await supabase.from('brain_dumps')
    .select('raw_text, classified_type, ab_verdict').eq('project_id', projectId)
    .order('created_at', { ascending: false }).limit(5)
  const prompt = `Project: ${project.name}\nStage: ${project.stage}\nStatus: ${project.status ?? 'none'}\nNext action: ${project.next_action ?? 'none'}\nBlockers: ${project.blockers ?? 'none'}\n\nRecent brain dumps:\n${(recentDumps ?? []).map(d => `- [${d.classified_type ?? 'unclassified'}${d.ab_verdict ? `, AB: ${d.ab_verdict}` : ''}] ${d.raw_text}`).join('\n')}\n\nGive 3 concrete, actionable suggestions for what the operator should tackle next on this project. Be specific. No fluff.`
  const result = await routeTask({ prompt, complexity_tier: 2, purpose: 'project_suggestions', project_id: projectId, supabase })
  await supabase.from('projects').update({ lead_suggestions: result.text, suggestions_updated_at: new Date().toISOString() }).eq('id', projectId)
  revalidatePath(`/projects/${projectId}`)
  return { suggestions: result.text, error: null }
}

export async function sendChatMessage(projectId: string, text: string) {
  const supabase = await createServerSupabaseClient()
  const { data: project } = await supabase.from('projects')
    .select('name, stage, status, next_action, blockers, description').eq('id', projectId).single()
  if (!project) return { error: 'Project not found' }
  await supabase.from('project_chats').insert({ project_id: projectId, role: 'user', content: text, model: null })
  const system = `You are an AI assistant helping an operator manage and grow a portfolio project. Be concise, direct, and actionable. The project context is:\n\nProject: ${project.name}\nStage: ${project.stage}\nStatus: ${project.status ?? 'none'}\nNext action: ${project.next_action ?? 'none'}\nBlockers: ${project.blockers ?? 'none'}`
  const result = await routeTask({ prompt: text, system, complexity_tier: 2, purpose: 'project_chat', project_id: projectId, supabase })
  await supabase.from('project_chats').insert({ project_id: projectId, role: 'assistant', content: result.text, model: result.model })
  revalidatePath(`/projects/${projectId}`)
  return { reply: result.text }
}

export async function createProjectBrainDump(
  projectId: string,
  rawText: string
): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('brain_dumps')
    .insert({
      project_id: projectId,
      raw_text: rawText,
      status: 'inbox',
      classified_type: 'idea',
    })
    .select('id')
    .single()
  if (error) return { error: error.message }
  revalidatePath(`/projects/${projectId}`)
  return { id: data.id }
}
