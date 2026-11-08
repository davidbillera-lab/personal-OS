import { createAdminSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import { revalidatePath } from 'next/cache'

// Unguarded QC core: no 'use server', so it is never a public endpoint. Callers authorize first:
// the owner-gated wrappers in app/(app)/projects/[id]/actions.ts, or mc_complete_task (MCP key).
// Reviewer prompt ported from the CodexQC skill (codex-qc.mjs). Spec: specs/2026-11-08-mc-dashboard-step2-plans-and-qc.md

export const QC_MODEL = 'gpt-6.1-sol'
export const QC_FALLBACK_MODEL = 'gpt-5.5'
export const MAX_DIFF_CHARS = 300_000
const MAX_REPORT_TOKENS = 9000

export const REVIEWER_PROMPT = `You are an independent senior staff software engineer performing a SECOND-OPINION quality-control review for an AI-native business operator who builds every project as a clean, transferable, SELLABLE asset (default exit: acquisition / Flippa / Empire Flippers).

You are NOT the author of this code and you do NOT edit it. Your sole job is to OBSERVE AND REPORT. A separate engineer (Claude Code) will make any fixes. Be direct, specific, and honest — the operator values "this won't work because X" over encouragement. No padding.

Review through these lenses (the operator's four kill criteria + craft):
1. FUNCTIONALITY — bugs, logic errors, broken edge cases, race conditions, incorrect async, missing error handling, security holes (secret leakage, injection, authz gaps).
2. EFFICIENCY — wasteful queries/renders, N+1s, unnecessary API/model calls, cost leaks (especially LLM token waste), blocking work.
3. SCALABILITY — statefulness that breaks horizontally, missing rate limits, schema/index problems, anything that won't survive growth.
4. SELLABILITY / TRANSFERABILITY — founder-dependent magic, undocumented coupling, poor separation of concerns, things that would scare a technical acquirer.

For EVERY issue give: file:line (best effort) · severity · what's wrong · why it matters · suggested direction (do NOT write the full fix — that's Claude's job; point the way).

Output STRICT markdown in this shape:

# Codex QC Review — <verdict>
**Verdict:** SHIP ✅  |  FIX-FIRST ⚠️  |  RECONSIDER ⛔  (pick one)
**One-line summary:** ...

## 🔴 Blocking (must fix before merge/ship)
## 🟠 Should-fix (important, not blocking)
## 🟡 Nits (polish / style)
## 🏗️ Architecture & sellability notes
## ✅ What's solid (brief — genuine strengths only)

If a section has no items, write "_None._". Reference real file paths/lines from the provided material. Do not invent issues to fill space.`

export type QcVerdict = 'SHIP' | 'FIX-FIRST' | 'RECONSIDER'

// Reads the **Verdict:** line. Exactly one verdict word must be present; an echoed template
// ("SHIP | FIX-FIRST | RECONSIDER"), a missing line or garbage yields null.
export function parseVerdict(report: string): QcVerdict | null {
  const line = report.match(/\*\*Verdict:?\*\*:?\s*(.+)/i)?.[1]
  if (!line) return null
  const found = (['SHIP', 'FIX-FIRST', 'RECONSIDER'] as const).filter(v => new RegExp(`\\b${v}\\b`, 'i').test(line))
  return found.length === 1 ? found[0] : null
}

// Only an explicit SHIP passes. Anything unparseable must never mark a task done.
export function qcStatusFor(report: string): 'passed' | 'issues_found' {
  return parseVerdict(report) === 'SHIP' ? 'passed' : 'issues_found'
}

function isModelUnavailable(err: unknown): boolean {
  const e = err as { status?: number; code?: string; message?: string }
  return e?.status === 404 || e?.code === 'model_not_found'
    || /model.*(does not exist|not found|not available|do not have access)/i.test(e?.message ?? '')
}

export type QcResult =
  | { status: 'passed' | 'issues_found' | 'loop_detected'; notes: string; model: string; verdict: QcVerdict | null; error?: undefined }
  | { error: string }

async function runQc(taskId: string, projectId: string, diff: string, commitUrl: string | undefined, rerun: boolean): Promise<QcResult> {
  if (!diff.trim()) return { error: 'The diff is empty; nothing to review.' }
  if (diff.length > MAX_DIFF_CHARS) {
    return { error: `The diff is ${diff.length.toLocaleString()} characters, over the ${MAX_DIFF_CHARS.toLocaleString()} limit. Review it with /CodexQC locally or split the PR.` }
  }
  const supabase = createAdminSupabaseClient()
  const { data: task } = await supabase.from('tasks').select('title, generated_spec, codex_qc_status').eq('id', taskId).single()
  if (!task) return { error: 'Task not found' }

  const prompt = `Original spec:\n${task.generated_spec ?? '(no spec recorded)'}\n\nChange under review: ${commitUrl ?? 'not provided'}\n\nGit diff:\n${diff}`
  const call = (model: string) => routeTask({
    prompt, system: REVIEWER_PROMPT, complexity_tier: 4, model, no_fallback: true, max_tokens: MAX_REPORT_TOKENS,
    purpose: rerun ? 'codex_qc_rerun' : 'codex_qc', project_id: projectId, task_id: taskId, supabase,
  })
  let result: Awaited<ReturnType<typeof routeTask>>
  try {
    try {
      result = await call(QC_MODEL)
    } catch (err) {
      if (!isModelUnavailable(err)) throw err
      result = await call(QC_FALLBACK_MODEL)
    }
  } catch (err) {
    return { error: err instanceof Error ? err.message : 'QC model call failed' }
  }

  const verdict = parseVerdict(result.text)
  const status = qcStatusFor(result.text)
  const finalStatus = rerun && task.codex_qc_status === 'issues_found' && status === 'issues_found' ? 'loop_detected' : status
  const notes = `_Reviewed by ${result.model}_\n\n${result.text}`
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
  return { status: finalStatus, notes, model: result.model, verdict }
}

export function runCodexQCCore(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  return runQc(taskId, projectId, diff, commitUrl, false)
}

// Re-run keeps loop detection: issues_found twice in a row becomes loop_detected.
export function rerunCodexQCCore(taskId: string, projectId: string, diff: string, commitUrl?: string) {
  return runQc(taskId, projectId, diff, commitUrl, true)
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
