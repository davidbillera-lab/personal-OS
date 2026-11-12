'use server'

import { createAdminSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import { classifyBrainDump } from '@/lib/classify'
import { captureToVault } from '@/lib/vault'
import { requireOwner } from '@/lib/owner'
import {
  applyOwnerAction,
  CONFLICT_MESSAGE,
  planOwnerApprovePlan,
  recordOwnerAudit,
  validateRequestId,
  type OwnerRequestRow,
} from '@/lib/owner-requests'
import { buildTaskRequest, isTaskRoute, routeWorker } from '@/lib/task-request'
import { runCodexQCCore, rerunCodexQCCore, type QcResult } from '@/lib/codex-qc'
import { fetchGitHubPrDiff, parsePrUrl } from '@/lib/github'
import { revalidatePath } from 'next/cache'

// Every export here is a public POST endpoint, and proxy.ts only checks sign-in, so each one refuses non-owners.
// Never throws on refusal: Next redacts thrown server-action errors in production.
const NOT_AUTHORIZED = { ok: false as const, error: 'Not authorized' }
async function isOwner(): Promise<boolean> {
  try {
    await requireOwner()
    return true
  } catch {
    return false
  }
}

export async function runAdvisoryBoard(dumpId: string, projectId: string) {
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
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
  let result: { text: string; model: string; cost_usd: number }
  try {
    result = await routeTask({
      prompt, system, complexity_tier: 1, purpose: 'advisory_board',
      project_id: projectId, brain_dump_id: dumpId, supabase,
    })
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  let verdict: 'keep' | 'kill' = 'keep'
  let reasoning = ''
  try {
    const cleaned = result.text.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim()
    const parsed = JSON.parse(cleaned)
    verdict = (['keep', 'kill'] as const).includes(parsed.verdict) ? parsed.verdict : 'keep'
    reasoning = parsed.reasoning ?? ''
  } catch { reasoning = result.text }
  await supabase.from('brain_dumps').update({ ab_verdict: verdict, ab_reasoning: reasoning }).eq('id', dumpId)
  revalidatePath(`/projects/${projectId}`)
  return { verdict, reasoning }
}

export async function generateSpec(dumpId: string, projectId: string, claudeMd: string, decisionsMd: string) {
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
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
  let result: { text: string; model: string; cost_usd: number }
  try {
    result = await routeTask({ prompt, system, complexity_tier: 2, purpose: 'spec_generation', project_id: projectId, brain_dump_id: dumpId, supabase })
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
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
  await captureToVault({
    type: 'build_spec',
    title: `Spec: ${dump.raw_text.slice(0, 80)}`,
    content: specContent,
    project_id: projectId,
    source_table: 'tasks',
    source_id: task.id,
    capture_source: 'spec_gen',
    tags: ['spec'],
    metadata: { spec_path: specPath },
  })
  await supabase.from('brain_dumps').update({ status: 'spec_generated' }).eq('id', dumpId)
  revalidatePath(`/projects/${projectId}`)
  return { task, specContent, specPath }
}

export async function approveSpec(taskId: string, projectId: string, localPath?: string) {
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
  const { data: task } = await supabase.from('tasks').select('title, spec_path, generated_spec').eq('id', taskId).single()
  if (!task) return { error: 'Task not found' }
  const { error: updateError } = await supabase.from('tasks').update({ status: 'in_progress' }).eq('id', taskId)
  if (updateError) return { error: updateError.message }
  const { error: handoffError } = await supabase.from('agent_handoffs').insert({
    project_id: projectId, task_id: taskId, agent_name: 'Claude Code',
    task_description: task.title, spec_path: task.spec_path, status: 'in_progress',
  })
  if (handoffError) return { error: handoffError.message }
  await captureToVault({
    type: 'agent_session',
    title: `Claude Code: ${task.title.slice(0, 80)}`,
    content: `Task: ${task.title}\n\nSpec path: ${task.spec_path ?? '(none)'}`,
    project_id: projectId,
    source_table: 'agent_handoffs',
    capture_source: 'agent_handoff',
    tags: ['agent', 'Claude Code', 'in_progress'],
    metadata: { task_id: taskId, spec_path: task.spec_path },
  })
  revalidatePath(`/projects/${projectId}`)
  const vscodePath = localPath ? `vscode://file/${localPath.replace(/\\/g, '/')}` : null
  return { ok: true, vscodePath }
}

export type SendTaskResult =
  | { ok: true; requestId: string; warning?: string }
  | { ok: false; error: string; requestId?: string }

// Dashboard -> agent queue bridge. Spec: specs/2026-11-06-mc-dashboard-agent-bridge.md
// Never throws: Next redacts thrown server-action errors in production.
export async function sendTaskToAgent(taskId: string, projectId: string, route: string): Promise<SendTaskResult> {
  const tool = 'owner_send_task'
  try {
    const supabase = createAdminSupabaseClient()
    const refuse = async (error: string, requestId: string | null = null): Promise<SendTaskResult> => {
      await recordOwnerAudit(supabase, { tool, ok: false, error, request_id: requestId, detail: { task_id: taskId, route } })
      return requestId ? { ok: false, error, requestId } : { ok: false, error }
    }

    try {
      await requireOwner()
    } catch {
      return refuse('Not authorized')
    }
    if (!isTaskRoute(route)) return refuse('Unknown route')
    try {
      validateRequestId(taskId)
      validateRequestId(projectId)
    } catch {
      return refuse('Invalid task or project id')
    }

    const [{ data: task, error: taskError }, { data: project, error: projectError }] = await Promise.all([
      supabase.from('tasks').select('id, title, status, generated_spec, project_id')
        .eq('id', taskId).eq('project_id', projectId).maybeSingle(),
      supabase.from('projects').select('id, name, repo_url').eq('id', projectId).maybeSingle(),
    ])
    if (taskError || projectError) return refuse(`Lookup failed: ${(taskError ?? projectError)!.message}`)
    if (!task || !project) return refuse('Task not found')
    if (task.status === 'done' || task.status === 'killed') return refuse(`Task is ${task.status}`)

    let row: ReturnType<typeof buildTaskRequest>
    try {
      row = buildTaskRequest(task, project, route)
    } catch (err) {
      return refuse((err as Error).message)
    }

    const { data: created, error: insertError } = await supabase.from('mc_requests').insert(row).select('id').single()
    if (insertError) {
      if (insertError.code === '23505') {
        const { data: live } = await supabase.from('mc_requests').select('id')
          .eq('task_id', taskId).not('status', 'in', '("completed","failed","cancelled")').maybeSingle()
        return refuse('This task already has a live request.', live?.id ?? null)
      }
      return refuse(`Could not create request: ${insertError.message}`)
    }

    // The card reads the request, not the task, so a failed task write loses nothing.
    let warning: string | undefined
    const { data: moved, error: taskUpdateError } = await supabase.from('tasks')
      .update({ status: 'in_progress', agent_assigned_to: routeWorker(route) })
      .eq('id', taskId).eq('status', task.status).select('id').maybeSingle()
    if (!taskUpdateError && !moved) {
      // The task changed after our read. If it was closed meanwhile, the new request must not stay live.
      const { data: now } = await supabase.from('tasks').select('status').eq('id', taskId).maybeSingle()
      if (!now || now.status === 'done' || now.status === 'killed') {
        const { data: undone } = await supabase.from('mc_requests')
          .update({ status: 'cancelled', latest_progress: 'Task was closed while sending; request cancelled.' })
          .eq('id', created.id).eq('status', row.status).select('id').maybeSingle()
        return refuse(undone
          ? 'Task was closed while sending; the request was cancelled.'
          : 'Task was closed while sending and the request is already live; close it in the queue.', created.id)
      }
    }
    if (taskUpdateError || !moved) warning = 'Request created, but the task status could not be updated.'

    await recordOwnerAudit(supabase, {
      tool, ok: true, request_id: created.id,
      detail: { task_id: taskId, request_id: created.id, route, ...(warning ? { warning } : {}) },
    })
    revalidatePath(`/projects/${projectId}`)
    revalidatePath('/queue')
    return warning ? { ok: true, requestId: created.id, warning } : { ok: true, requestId: created.id }
  } catch (err) {
    console.error(`[owner] ${tool} failed:`, err)
    return { ok: false, error: 'Action failed unexpectedly; refresh and try again.' }
  }
}

export type ApprovePlanResult = { ok: true } | { ok: false; error: string }

// Approve a Hermes plan from the task card: hands the row to the chosen builder, plan kept.
// Same compare-and-set as the /queue owner actions. Never throws.
export async function approvePlan(input: {
  id: string; projectId: string; expectedStatus: string; expectedUpdatedAt: string; builder: string
}): Promise<ApprovePlanResult> {
  const tool = 'owner_approve_plan'
  let id: string
  try {
    id = validateRequestId(input?.id)
  } catch (err) {
    return { ok: false, error: (err as Error).message }
  }
  try {
    const supabase = createAdminSupabaseClient()
    const refuse = async (error: string, detail?: Record<string, unknown>): Promise<ApprovePlanResult> => {
      await recordOwnerAudit(supabase, { tool, ok: false, error, request_id: id, detail })
      return { ok: false, error }
    }
    if (!(await isOwner())) return refuse(NOT_AUTHORIZED.error)
    if (typeof input.expectedStatus !== 'string' || typeof input.expectedUpdatedAt !== 'string') return refuse('Missing expected version')

    const { data, error } = await supabase.from('mc_requests')
      .select('id,task_id,status,updated_at,assigned_to,attempt_id,phase,plan,plan_submitted_at,plan_by,blocker,result_summary,approval_required,reviewed_sha,workspace_ref')
      .eq('id', id).maybeSingle()
    if (error) return refuse(`Lookup failed: ${error.message}`)
    if (!data) return refuse('Request not found')
    const row = data as unknown as OwnerRequestRow & { task_id: string | null }
    if (row.status !== input.expectedStatus || row.updated_at !== input.expectedUpdatedAt) return refuse(CONFLICT_MESSAGE)

    const planned = planOwnerApprovePlan(row, input.builder)
    if (!planned.ok) return refuse(planned.reason, { task_id: row.task_id, builder: input.builder })
    const applied = await applyOwnerAction(supabase, id, input.expectedStatus, input.expectedUpdatedAt, planned.updates, {
      tool, detail: { task_id: row.task_id, ...planned.detail },
    })
    if (!applied.ok) return { ok: false, error: applied.error }
    if (input.projectId) revalidatePath(`/projects/${input.projectId}`)
    revalidatePath('/queue')
    return { ok: true }
  } catch (err) {
    console.error(`[owner] ${tool} failed:`, err)
    return { ok: false, error: 'Action failed unexpectedly; refresh and try again.' }
  }
}

// With an empty diff and a PR URL as commitUrl, the PR's diff is fetched from GitHub.
async function ownerRunQc(taskId: string, projectId: string, diff: string, commitUrl: string | undefined, rerun: boolean): Promise<QcResult | typeof NOT_AUTHORIZED> {
  const tool = 'owner_run_qc'
  try {
    const supabase = createAdminSupabaseClient()
    if (!(await isOwner())) {
      await recordOwnerAudit(supabase, { tool, ok: false, error: NOT_AUTHORIZED.error, request_id: null, detail: { task_id: taskId, rerun } })
      return NOT_AUTHORIZED
    }
    let source = diff
    let reviewedSha: string | undefined
    if (!source.trim() && commitUrl && parsePrUrl(commitUrl)) {
      try {
        ({ diff: source, headSha: reviewedSha } = await fetchGitHubPrDiff(commitUrl))
      } catch (err) {
        const error = `Could not fetch the PR diff: ${err instanceof Error ? err.message : String(err)}`
        await recordOwnerAudit(supabase, { tool, ok: false, error, request_id: null, detail: { task_id: taskId, rerun } })
        return { error }
      }
    }
    const res = await (rerun ? rerunCodexQCCore : runCodexQCCore)(taskId, projectId, source, commitUrl, reviewedSha)
    const ran = 'model' in res
    await recordOwnerAudit(supabase, {
      tool, ok: ran, error: ran ? undefined : res.error, request_id: null,
      detail: { task_id: taskId, rerun, reviewed_sha: reviewedSha ?? null, model: ran ? res.model : null, verdict: ran ? res.verdict : null },
    })
    return res
  } catch (err) {
    console.error(`[owner] ${tool} failed:`, err)
    return { error: 'QC failed unexpectedly; refresh and try again.' }
  }
}

export async function runCodexQC(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  return ownerRunQc(taskId, projectId, diff, commitUrl, false)
}

export async function rerunCodexQCOnSpec(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  return ownerRunQc(taskId, projectId, diff, commitUrl, true)
}

export type RepoEntry = { name: string; type: 'file' | 'dir'; path: string; html_url: string }

export async function fetchRepoContents(
  repoUrl: string,
  path: string = ''
): Promise<{ entries?: RepoEntry[]; error?: string }> {
  if (!(await isOwner())) return NOT_AUTHORIZED
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
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
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
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
  const { error } = await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId)
  if (error) return { error: error.message }
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

export async function archiveProject(projectId: string) {
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
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

export async function generateSuggestions(projectId: string) {
  if (!(await isOwner())) return { ...NOT_AUTHORIZED, suggestions: null }
  const supabase = createAdminSupabaseClient()
  const { data: project } = await supabase.from('projects')
    .select('id, name, stage, status, next_action, blockers, description').eq('id', projectId).single()
  if (!project) return { error: 'Project not found', suggestions: null }
  // project.id (from the DB, not the caller) is safe inside the or() filter.
  const { data: recentDumps } = await supabase.from('brain_dumps')
    .select('raw_text, classified_type, ab_verdict').or(`project_id.eq.${project.id},is_global.eq.true`)
    .order('created_at', { ascending: false }).limit(5)
  const prompt = `Project: ${project.name}\nStage: ${project.stage}\nStatus: ${project.status ?? 'none'}\nNext action: ${project.next_action ?? 'none'}\nBlockers: ${project.blockers ?? 'none'}\n\nRecent brain dumps:\n${(recentDumps ?? []).map(d => `- [${d.classified_type ?? 'unclassified'}${d.ab_verdict ? `, AB: ${d.ab_verdict}` : ''}] ${d.raw_text}`).join('\n')}\n\nGive 3 concrete, actionable suggestions for what the operator should tackle next on this project. Be specific. No fluff.`
  let result: { text: string; model: string; cost_usd: number }
  try {
    result = await routeTask({ prompt, complexity_tier: 2, purpose: 'project_suggestions', project_id: projectId, supabase })
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}`, suggestions: null }
  }
  await supabase.from('projects').update({ lead_suggestions: result.text, suggestions_updated_at: new Date().toISOString() }).eq('id', projectId)
  revalidatePath(`/projects/${projectId}`)
  return { suggestions: result.text, error: null }
}

export async function sendChatMessage(projectId: string, text: string, focusedContext?: string) {
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
  const { data: project } = await supabase.from('projects')
    .select('name, stage, status, next_action, blockers, description').eq('id', projectId).single()
  if (!project) return { error: 'Project not found' }
  await supabase.from('project_chats').insert({ project_id: projectId, role: 'user', content: text, model: null })
  const system = `You are an AI assistant helping an operator manage and grow a portfolio project. Be concise, direct, and actionable. The project context is:\n\nProject: ${project.name}\nStage: ${project.stage}\nStatus: ${project.status ?? 'none'}\nNext action: ${project.next_action ?? 'none'}\nBlockers: ${project.blockers ?? 'none'}${focusedContext ? `\n\nOperator's current focus:\n${focusedContext}` : ''}`
  let result: { text: string; model: string; cost_usd: number }
  try {
    result = await routeTask({ prompt: text, system, complexity_tier: 2, purpose: 'project_chat', project_id: projectId, supabase })
  } catch (err) {
    return { error: `Model call failed: ${err instanceof Error ? err.message : String(err)}` }
  }
  await supabase.from('project_chats').insert({ project_id: projectId, role: 'assistant', content: result.text, model: result.model })
  revalidatePath(`/projects/${projectId}`)
  return { reply: result.text }
}

export async function createProjectBrainDump(
  projectId: string,
  rawText: string
): Promise<{ id?: string; error?: string }> {
  if (!(await isOwner())) return NOT_AUTHORIZED
  const supabase = createAdminSupabaseClient()
  const { data, error } = await supabase
    .from('brain_dumps')
    .insert({
      project_id: projectId,
      raw_text: rawText,
      status: 'inbox',
      classified_type: null,
    })
    .select('id')
    .single()
  if (error) return { error: error.message }

  const dumpId = data.id
  await classifyBrainDump(dumpId, rawText, supabase).catch(console.error)
  await runAdvisoryBoard(dumpId, projectId).catch(console.error)
  await captureToVault({
    type: 'brain_dump_mirror',
    title: rawText.slice(0, 120),
    content: rawText,
    project_id: projectId,
    source_table: 'brain_dumps',
    source_id: dumpId,
    capture_source: 'brain_dump',
    tags: ['inbox'],
  })
  revalidatePath(`/projects/${projectId}`)
  return { id: dumpId }
}
