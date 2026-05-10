import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'

export async function POST(req: Request) {
  let body: unknown
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'Invalid JSON' }, { status: 400 })
  }

  const { prompt, complexity_tier, purpose, model, system, project_id, task_id, brain_dump_id, allow_escalate } =
    body as Record<string, unknown>

  if (!prompt || !complexity_tier || !purpose) {
    return NextResponse.json({ error: 'prompt, complexity_tier, and purpose are required' }, { status: 400 })
  }

  if (![1, 2, 3, 4].includes(complexity_tier as number)) {
    return NextResponse.json({ error: 'complexity_tier must be 1–4' }, { status: 400 })
  }

  try {
    const supabase = await createServerSupabaseClient()
    const result = await routeTask({
      prompt: prompt as string,
      complexity_tier: complexity_tier as 1 | 2 | 3 | 4,
      purpose: purpose as string,
      model: model as string | undefined,
      system: system as string | undefined,
      project_id: project_id as string | undefined,
      task_id: task_id as string | undefined,
      brain_dump_id: brain_dump_id as string | undefined,
      allow_escalate: allow_escalate as boolean | undefined,
      supabase,
    })
    return NextResponse.json(result)
  } catch (err) {
    console.error('[route-task]', err)
    return NextResponse.json({ error: 'Model call failed' }, { status: 500 })
  }
}
