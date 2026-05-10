import type { SupabaseClient } from '@supabase/supabase-js'
import { routeTask } from './models/router'
import { callOpenAI } from './models/openai'
import { calcCost } from './models/pricing'
import type { BrainDumpType } from './types'

const VALID_TYPES: BrainDumpType[] = ['idea', 'task', 'bug', 'decision', 'kill_candidate', 'unclassified']

interface ClassifyResult {
  type: BrainDumpType
  confidence: number
  project_slug: string | null
  summary: string
}

function buildPrompt(rawText: string, projectLines: string): string {
  return `You are a brain-dump classifier for a portfolio OS. Classify the input into one of:
idea | task | bug | decision | kill_candidate | unclassified

Active projects:
${projectLines}

Input: "${rawText}"

Respond with ONLY valid JSON (no markdown, no explanation):
{"type":"<type>","confidence":<0.0-1.0>,"project_slug":"<slug or null>","summary":"<one sentence>"}`
}

function parseResult(text: string): ClassifyResult | null {
  try {
    // Strip markdown code fences if present
    const cleaned = text.replace(/^```[a-z]*\n?/m, '').replace(/```$/m, '').trim()
    const parsed = JSON.parse(cleaned)
    if (!VALID_TYPES.includes(parsed.type)) return null
    return {
      type: parsed.type as BrainDumpType,
      confidence: typeof parsed.confidence === 'number' ? Math.max(0, Math.min(1, parsed.confidence)) : 0.5,
      project_slug: typeof parsed.project_slug === 'string' ? parsed.project_slug : null,
      summary: typeof parsed.summary === 'string' ? parsed.summary : '',
    }
  } catch {
    return null
  }
}

export async function classifyBrainDump(
  id: string,
  rawText: string,
  supabase: SupabaseClient
): Promise<void> {
  // Fetch project list for context
  const { data: projects } = await supabase.from('projects').select('id, name, slug')
  const projectLines = (projects ?? []).map((p: { slug: string; name: string }) => `${p.slug}: ${p.name}`).join('\n') || '(no projects yet)'

  const prompt = buildPrompt(rawText, projectLines)

  // Tier 1 (Haiku) classification
  const { text: haikusText } = await routeTask({
    prompt,
    complexity_tier: 1,
    purpose: 'classify_brain_dump',
    brain_dump_id: id,
    supabase,
  })

  let primary = parseResult(haikusText)
  if (!primary) {
    primary = { type: 'unclassified', confidence: 0, project_slug: null, summary: '' }
  }

  let finalType = primary.type
  let finalConfidence = primary.confidence

  // Accountability check: GPT-4o-mini cross-checks when confidence is low
  if (primary.confidence < 0.75) {
    try {
      const gptResult = await callOpenAI(prompt, 'gpt-4o-mini')
      const gptCost = calcCost('gpt-4o-mini', gptResult.tokens_in, gptResult.tokens_out)

      await supabase.from('model_costs').insert({
        model: 'gpt-4o-mini',
        provider: 'openai',
        tokens_in: gptResult.tokens_in,
        tokens_out: gptResult.tokens_out,
        cost_usd: gptCost,
        purpose: 'accountability_check',
        brain_dump_id: id,
        project_id: null,
        task_id: null,
      })

      const gpt = parseResult(gptResult.text)
      if (gpt && gpt.type !== primary.type) {
        // Disagreement: flag unclassified, take the lower confidence
        finalType = 'unclassified'
        finalConfidence = Math.min(primary.confidence, gpt.confidence)
      }
    } catch {
      // Accountability check failed — proceed with Haiku result
    }
  }

  // Resolve project_slug → project_id
  let resolvedProjectId: string | null = null
  if (primary.project_slug && projects) {
    const match = (projects as { id: string; slug: string }[]).find(p => p.slug === primary!.project_slug)
    resolvedProjectId = match?.id ?? null
  }

  // Update the brain_dump row
  await supabase.from('brain_dumps').update({
    classified_type: finalType,
    classification_confidence: finalConfidence,
    project_id: resolvedProjectId,
    ai_summary: primary.summary,
    status: 'reviewed',
  }).eq('id', id)
}
