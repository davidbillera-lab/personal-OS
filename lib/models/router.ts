import type { SupabaseClient } from '@supabase/supabase-js'
import { callAnthropic } from './anthropic'
import { callOpenAI } from './openai'
import { callGemini } from './gemini'
import { calcCost } from './pricing'

export type ComplexityTier = 1 | 2 | 3 | 4

// Tier → primary model mapping
const TIER_MODEL: Record<ComplexityTier, string> = {
  1: 'claude-haiku-4-5-20251001',
  2: 'claude-sonnet-4-6',
  3: 'claude-opus-4-7',
  4: 'claude-opus-4-7', // tier 4 callers usually pass an explicit model
}

// Anthropic models for tiers 1-3
const ANTHROPIC_TIERS = new Set(['claude-haiku-4-5-20251001', 'claude-sonnet-4-6', 'claude-opus-4-7'])

type AdapterResult = { text: string; tokens_in: number; tokens_out: number }

async function callModel(
  prompt: string,
  model: string,
  options?: { system?: string }
): Promise<AdapterResult> {
  if (ANTHROPIC_TIERS.has(model)) return callAnthropic(prompt, model, options)
  if (model.startsWith('gpt') || model.startsWith('codex')) return callOpenAI(prompt, model, options)
  if (model.startsWith('gemini')) return callGemini(prompt, model, options)
  throw new Error(`Unknown model: ${model}`)
}

async function logCost(
  supabase: SupabaseClient,
  fields: {
    model: string
    tokens_in: number
    tokens_out: number
    cost_usd: number
    purpose: string
    project_id?: string
    task_id?: string
    brain_dump_id?: string
  }
) {
  await supabase.from('model_costs').insert({
    model: fields.model,
    provider: (fields.model.startsWith('gpt') || fields.model.startsWith('codex')) ? 'openai'
      : fields.model.startsWith('gemini') ? 'google'
      : 'anthropic',
    tokens_in: fields.tokens_in,
    tokens_out: fields.tokens_out,
    cost_usd: fields.cost_usd,
    purpose: fields.purpose,
    project_id: fields.project_id ?? null,
    task_id: fields.task_id ?? null,
    brain_dump_id: fields.brain_dump_id ?? null,
  })
}

export interface RouteTaskInput {
  prompt: string
  complexity_tier: ComplexityTier
  purpose: string
  model?: string              // override for tier 4
  system?: string
  project_id?: string
  task_id?: string
  brain_dump_id?: string
  allow_escalate?: boolean
  supabase: SupabaseClient
}

export async function routeTask(input: RouteTaskInput): Promise<{ text: string; model: string; cost_usd: number }> {
  const {
    prompt, complexity_tier, purpose, model: modelOverride,
    system, project_id, task_id, brain_dump_id, allow_escalate = false, supabase,
  } = input

  const primaryModel = modelOverride ?? TIER_MODEL[complexity_tier]
  const sharedLogFields = { purpose, project_id, task_id, brain_dump_id }

  // Tier 3: race Opus vs GPT-4o in parallel
  if (complexity_tier === 3 && !modelOverride) {
    const [opusResult, gptResult] = await Promise.allSettled([
      callModel(prompt, 'claude-opus-4-7', { system }),
      callModel(prompt, 'gpt-4o', { system }),
    ])

    let winner: AdapterResult
    let winnerModel: string

    if (opusResult.status === 'fulfilled') {
      winner = opusResult.value
      winnerModel = 'claude-opus-4-7'
    } else if (gptResult.status === 'fulfilled') {
      winner = gptResult.value
      winnerModel = 'gpt-4o'
    } else {
      throw new Error(`Both tier-3 models failed: ${opusResult.reason}`)
    }

    const winnerCost = calcCost(winnerModel, winner.tokens_in, winner.tokens_out)
    await logCost(supabase, { ...sharedLogFields, model: winnerModel, ...winner, cost_usd: winnerCost })

    // Log the accountability partner result separately if it succeeded
    if (gptResult.status === 'fulfilled' && winnerModel !== 'gpt-4o') {
      const gpt = gptResult.value
      const gptCost = calcCost('gpt-4o', gpt.tokens_in, gpt.tokens_out)
      await logCost(supabase, { ...sharedLogFields, model: 'gpt-4o', ...gpt, cost_usd: gptCost, purpose: 'accountability_partner' })
    }

    return { text: winner.text, model: winnerModel, cost_usd: winnerCost }
  }

  // Tiers 1, 2, 4: try primary, fall back one tier down, optionally escalate
  try {
    const result = await callModel(prompt, primaryModel, { system })
    const cost_usd = calcCost(primaryModel, result.tokens_in, result.tokens_out)
    await logCost(supabase, { ...sharedLogFields, model: primaryModel, ...result, cost_usd })
    return { text: result.text, model: primaryModel, cost_usd }
  } catch (primaryErr) {
    // Fallback: one tier down
    const fallbackTier = Math.max(1, complexity_tier - 1) as ComplexityTier
    const fallbackModel = TIER_MODEL[fallbackTier]

    if (fallbackModel === primaryModel) throw primaryErr // already at tier 1

    try {
      const result = await callModel(prompt, fallbackModel, { system })
      const cost_usd = calcCost(fallbackModel, result.tokens_in, result.tokens_out)
      await logCost(supabase, { ...sharedLogFields, model: fallbackModel, ...result, cost_usd, purpose: `${purpose}:fallback` })
      return { text: result.text, model: fallbackModel, cost_usd }
    } catch (fallbackErr) {
      if (!allow_escalate) throw fallbackErr

      // Escalate: one tier up from primary
      const escalateTier = Math.min(3, complexity_tier + 1) as ComplexityTier
      const escalateModel = TIER_MODEL[escalateTier]
      const result = await callModel(prompt, escalateModel, { system })
      const cost_usd = calcCost(escalateModel, result.tokens_in, result.tokens_out)
      await logCost(supabase, { ...sharedLogFields, model: escalateModel, ...result, cost_usd, purpose: `${purpose}:escalation` })
      return { text: result.text, model: escalateModel, cost_usd }
    }
  }
}
