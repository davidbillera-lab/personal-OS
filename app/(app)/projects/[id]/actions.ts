'use server'

import { revalidatePath } from 'next/cache'
import { createServerSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import type { ProjectChat } from '@/lib/types'

export async function generateSuggestions(projectId: string): Promise<{ error?: string; suggestions?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: project } = await supabase
    .from('projects')
    .select('*, projects(name)')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }

  let claudeMd = ''
  let decisionsMd = ''

  if (project.repo_url) {
    const pat = process.env.GITHUB_PAT
    const rawBase = project.repo_url
      .replace('https://github.com/', 'https://raw.githubusercontent.com/')
      + '/main'
    const headers: Record<string, string> = pat ? { Authorization: `token ${pat}` } : {}

    const [cRes, dRes] = await Promise.allSettled([
      fetch(`${rawBase}/CLAUDE.md`, { headers }),
      fetch(`${rawBase}/decisions.md`, { headers }),
    ])

    if (cRes.status === 'fulfilled' && cRes.value.ok) claudeMd = (await cRes.value.text()).slice(0, 6000)
    if (dRes.status === 'fulfilled' && dRes.value.ok) decisionsMd = (await dRes.value.text()).slice(0, 3000)
  }

  const system = `You are a build advisor for an AI-native portfolio operating system.
Given a project's context, produce actionable suggestions that move it toward ship-ready.
Output a markdown string with 3-5 concrete, specific suggestions. Be direct, not generic.
Start each suggestion with an action verb. Focus on the highest-leverage moves.`

  const prompt = [
    `Project: ${project.name}`,
    project.stage ? `Stage: ${project.stage}` : '',
    project.status ? `Status: ${project.status}` : '',
    project.next_action ? `Next action: ${project.next_action}` : '',
    project.blockers ? `Blockers: ${project.blockers}` : '',
    claudeMd ? `\n## CLAUDE.md\n${claudeMd}` : '',
    decisionsMd ? `\n## decisions.md\n${decisionsMd}` : '',
  ].filter(Boolean).join('\n')

  const callArgs = {
    prompt,
    system,
    purpose: 'project_suggestions',
    project_id: projectId,
    supabase,
  }

  let raw: string | undefined

  try {
    const result = await routeTask({ ...callArgs, complexity_tier: 2 })
    raw = result.text
  } catch (err1) {
    console.error('[generateSuggestions] Sonnet failed, escalating to Codex:', err1)
    try {
      const result = await routeTask({ ...callArgs, complexity_tier: 4, model: 'codex-mini-latest' })
      raw = result.text
    } catch (err2) {
      console.error('[generateSuggestions] Codex failed, escalating to Opus:', err2)
      try {
        const result = await routeTask({ ...callArgs, complexity_tier: 3, model: 'claude-opus-4-7' })
        raw = result.text
      } catch (err3) {
        console.error('[generateSuggestions] All models failed:', err3)
        return { error: 'Suggestion generation failed. Check console logs and model_costs table.' }
      }
    }
  }

  await supabase
    .from('projects')
    .update({
      lead_suggestions: raw,
      suggestions_updated_at: new Date().toISOString(),
    })
    .eq('id', projectId)

  revalidatePath(`/projects/${projectId}`)
  return { suggestions: raw }
}

export async function sendChatMessage(
  projectId: string,
  userMessage: string
): Promise<{ reply?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: project } = await supabase
    .from('projects')
    .select('lead_model, name')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found' }

  await supabase.from('project_chats').insert({
    project_id: projectId,
    role: 'user',
    content: userMessage,
  })

  const { data: history } = await supabase
    .from('project_chats')
    .select('role, content')
    .eq('project_id', projectId)
    .order('created_at', { ascending: true })
    .limit(20)

  const prior = (history ?? []).slice(0, -1)
  const historyBlock = prior.length > 0
    ? '[Prior conversation]\n' + prior.map((m: Pick<ProjectChat, 'role' | 'content'>) => `${m.role}: ${m.content}`).join('\n') + '\n\n[Current message]\n'
    : ''

  const prompt = historyBlock + userMessage

  const model = project.lead_model ?? 'claude-sonnet-4-6'
  const complexityTier = (model.startsWith('claude-opus') ? 3 : model.startsWith('codex') ? 4 : 2) as 1 | 2 | 3 | 4

  const system = `You are a build partner for the "${project.name}" project in an AI-native portfolio operating system.
Your job is to help the operator think clearly, make better decisions, and move faster — not to validate bad ideas.

Rules:
- Be honest about the idea, not just encouraging about the effort. If something won't work, say so directly and explain why.
- Push back when you see a flaw, a wrong assumption, or a better path. Back your pushback with specific reasoning, not vague concern.
- Skip flattery, filler, and throat-clearing. Get to the point.
- When something is genuinely good, say so and explain what makes it strong.
- Speak in plain English. No jargon for jargon's sake.
- You are allowed to say "that's a bad idea" if it is.`

  let reply: string
  let usedModel = model

  try {
    const result = await routeTask({
      prompt,
      system,
      purpose: 'project_chat',
      project_id: projectId,
      complexity_tier: complexityTier,
      model,
      supabase,
    })
    reply = result.text
    usedModel = result.model
  } catch (err) {
    console.error('[sendChatMessage] Model call failed:', err)
    return { error: 'Failed to get a response. Try again.' }
  }

  await supabase.from('project_chats').insert({
    project_id: projectId,
    role: 'assistant',
    content: reply,
    model: usedModel,
  })

  return { reply }
}
