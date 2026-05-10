'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'

export async function generateSpec(taskId: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: task } = await supabase
    .from('tasks')
    .select('*, projects(name, repo_url)')
    .eq('id', taskId)
    .single()

  if (!task) return { error: 'Task not found' }

  const project = task.projects as { name: string; repo_url: string | null } | null
  let claudeMd = ''
  let decisionsMd = ''

  if (project?.repo_url) {
    const pat = process.env.GITHUB_PAT
    const rawBase = project.repo_url
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      + '/main'
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {}

    const [claudeRes, decisionsRes] = await Promise.allSettled([
      fetch(`${rawBase}/CLAUDE.md`, { headers }),
      fetch(`${rawBase}/decisions.md`, { headers }),
    ])

    if (claudeRes.status === 'fulfilled' && claudeRes.value.ok) {
      claudeMd = (await claudeRes.value.text()).slice(0, 6000)
    }
    if (decisionsRes.status === 'fulfilled' && decisionsRes.value.ok) {
      decisionsMd = (await decisionsRes.value.text()).slice(0, 3000)
    }
  }

  const system = `You are a build orchestration assistant for a portfolio operating system.
Given a task and project context, produce a structured implementation spec.
Output valid JSON with exactly these fields:
{
  "spec": "markdown string with Goal, Context, Acceptance Criteria, and Notes sections",
  "recommended_tool": "Claude Code" | "Codex" | "Manus" | "Lovable",
  "recommended_model": "model ID string",
  "complexity_tier": 1 | 2 | 3 | 4
}`

  const prompt = [
    `Task: ${task.title}`,
    task.description ? `Description: ${task.description}` : '',
    `Project: ${project?.name ?? 'Unknown'}`,
    claudeMd ? `\n## CLAUDE.md\n${claudeMd}` : '',
    decisionsMd ? `\n## decisions.md\n${decisionsMd}` : '',
  ].filter(Boolean).join('\n')

  const callArgs = {
    prompt,
    system,
    purpose: 'spec_generation',
    project_id: task.project_id ?? undefined,
    task_id: taskId,
    supabase,
  }

  let raw: string | undefined
  let usedModel = 'claude-sonnet-4-6'

  try {
    const result = await routeTask({ ...callArgs, complexity_tier: 2 })
    raw = result.text
    usedModel = result.model
  } catch (err1) {
    console.error('[generateSpec] Sonnet failed, escalating to Codex:', err1)
    try {
      const result = await routeTask({ ...callArgs, complexity_tier: 4, model: 'codex-mini-latest' })
      raw = result.text
      usedModel = result.model
    } catch (err2) {
      console.error('[generateSpec] Codex failed, escalating to Opus:', err2)
      try {
        const result = await routeTask({ ...callArgs, complexity_tier: 3, model: 'claude-opus-4-7' })
        raw = result.text
        usedModel = result.model
      } catch (err3) {
        console.error('[generateSpec] All models failed:', err3)
        return {
          error: 'Spec generation failed across Sonnet, Codex, and Opus. Check model_costs table and console logs — regroup and re-plan.',
        }
      }
    }
  }

  let parsed: {
    spec: string
    recommended_tool: string
    recommended_model: string
    complexity_tier: number
  }
  try {
    const jsonMatch = raw!.match(/\{[\s\S]*\}/)
    parsed = JSON.parse(jsonMatch?.[0] ?? raw!)
  } catch {
    return { error: `Model returned non-JSON output (model: ${usedModel}). Try regenerating.` }
  }

  await supabase
    .from('tasks')
    .update({
      generated_spec: parsed.spec,
      recommended_tool: parsed.recommended_tool,
      recommended_model: parsed.recommended_model,
      complexity_tier: parsed.complexity_tier,
      status: 'in_progress',
    })
    .eq('id', taskId)

  revalidatePath('/orchestrate')
  return {}
}

export async function markDone(taskId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.from('tasks').update({ status: 'done' }).eq('id', taskId)
  revalidatePath('/orchestrate')
}

export async function archiveTask(taskId: string): Promise<void> {
  const supabase = await createServerSupabaseClient()
  await supabase.from('tasks').update({ status: 'killed' }).eq('id', taskId)
  revalidatePath('/orchestrate')
}
