'use server'

import { revalidatePath } from 'next/cache'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import type { BrainDumpType, IdeaValidationResult } from '@/lib/types'
import { captureToVault } from '@/lib/vault'
import { classifyBrainDump } from '@/lib/classify'

async function validateIdea(rawText: string, summary: string | null): Promise<IdeaValidationResult> {
  const supabase = createAdminSupabaseClient()
  const prompt = `Evaluate this idea against four kill criteria. Be direct and honest.

Idea: "${summary ?? rawText}"

Answer in valid JSON:
{
  "verdict": "proceed" or "flag",
  "reason": "one sentence explanation — if flagging, say exactly why it fails",
  "is_internal": true if this is an internal efficiency/productivity tool (not a scalable product)
}

Kill criteria (flag if 2+ fail):
1. Plausible path to working functionality with current AI tools?
2. Can be built efficiently — not requiring months of custom engineering?
3. Has scale potential, OR is a legitimate internal tool (both are acceptable)?
4. No obvious fatal flaw before building?

Internal tools are fine — only flag if the idea itself is incoherent or impossible.`

  try {
    const result = await routeTask({
      prompt,
      complexity_tier: 1,
      purpose: 'idea_validation',
      supabase,
    })
    const json = JSON.parse(result.text.replace(/```json\n?|\n?```/g, '').trim())
    return {
      verdict: json.verdict === 'flag' ? 'flag' : 'proceed',
      reason: json.reason ?? '',
      is_internal: Boolean(json.is_internal),
    }
  } catch {
    return { verdict: 'proceed', reason: '', is_internal: false }
  }
}

export async function archiveDump(id: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  await supabase
    .from('brain_dumps')
    .update({ status: 'archived' })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function routeDump(id: string, projectId: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  await supabase
    .from('brain_dumps')
    .update({ project_id: projectId, status: 'actioned' })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function promoteDump(
  id: string,
  projectId: string | null,
  title: string,
  rawText: string,
  aiSummary: string | null
): Promise<{ warn?: string }> {
  const validation = await validateIdea(rawText, aiSummary)
  if (validation.verdict === 'flag' && !validation.is_internal) {
    return { warn: validation.reason }
  }
  const supabase = createAdminSupabaseClient()
  await supabase.from('tasks').insert({
    brain_dump_id: id,
    project_id: projectId,
    title,
    status: 'pending',
  })
  await supabase
    .from('brain_dumps')
    .update({ status: 'actioned' })
    .eq('id', id)
  revalidatePath('/inbox')
  return {}
}

export async function promoteDumpAnyway(
  id: string,
  projectId: string | null,
  title: string
): Promise<void> {
  const supabase = createAdminSupabaseClient()
  await supabase.from('tasks').insert({
    brain_dump_id: id,
    project_id: projectId,
    title,
    status: 'pending',
  })
  await supabase
    .from('brain_dumps')
    .update({ status: 'actioned' })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function reclassifyDump(id: string, newType: BrainDumpType): Promise<void> {
  const supabase = createAdminSupabaseClient()
  await supabase
    .from('brain_dumps')
    .update({ classified_type: newType })
    .eq('id', id)
  revalidatePath('/inbox')
}

export async function generateSpecAction(
  taskId: string,
  dumpId: string,
  rawText: string,
  projectId: string | null
): Promise<{ ok: boolean; error?: string }> {
  const supabase = createAdminSupabaseClient()
  try {
    const result = await routeTask({
      prompt: `Generate an agent-ready implementation spec for this task:\n\n${rawText}\n\nInclude: objective, inputs/outputs, recommended approach, files to touch, verification steps.`,
      complexity_tier: 2,
      purpose: 'spec_generation',
      project_id: projectId ?? undefined,
      task_id: taskId,
      supabase,
    })
    await supabase
      .from('tasks')
      .update({
        generated_spec: result.text,
        recommended_tool: 'claude_code',
        recommended_model: result.model,
        complexity_tier: 2,
      })
      .eq('id', taskId)
    await captureToVault({
      type: 'build_spec',
      title: `Spec: ${rawText.slice(0, 80)}`,
      content: result.text,
      project_id: projectId ?? null,
      source_table: 'tasks',
      source_id: taskId,
      capture_source: 'spec_gen',
      tags: ['spec', result.model],
      metadata: { model: result.model, complexity_tier: 2 },
    })
    await supabase
      .from('brain_dumps')
      .update({ status: 'spec_generated' })
      .eq('id', dumpId)
    revalidatePath('/inbox')
    return { ok: true }
  } catch (e) {
    return { ok: false, error: String(e) }
  }
}

export async function submitDump(rawText: string): Promise<void> {
  const supabase = createAdminSupabaseClient()
  const trimmed = rawText.trim()
  if (!trimmed) return

  const { data, error } = await supabase
    .from('brain_dumps')
    .insert({ raw_text: trimmed, status: 'inbox' })
    .select('id')
    .single()

  if (error || !data) return

  await classifyBrainDump(data.id, trimmed, supabase)
  revalidatePath('/inbox')
}
