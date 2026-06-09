import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { captureToVault } from '@/lib/vault'
import type { VaultItemType } from '@/lib/types'

// One-time idempotent backfill: mirror historical source-table rows into vault_items.
// captureToVault was added late, so big source tables (handoffs, dumps, specs, decisions,
// projects) never flowed into the vault. This walks each source table and captures any
// row that doesn't already have a matching vault_items row (matched by source_table +
// source_id), so the master vault view fills retroactively. Safe to re-run — existing
// rows are skipped. No schema change; the vault page already shows the full union.

type TableResult = { seeded: number; skipped: number }

// Fetch the set of source_ids already mirrored for a given source_table, so we skip them.
async function existingSourceIds(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  sourceTable: string
): Promise<Set<string>> {
  const { data } = await supabase
    .from('vault_items')
    .select('source_id')
    .eq('source_table', sourceTable)
    .not('source_id', 'is', null)

  return new Set((data ?? []).map(r => r.source_id as string))
}

export async function POST(req: NextRequest) {
  // Simple admin auth — same pattern as the MCP + seed-skills routes.
  const auth = req.headers.get('Authorization') ?? ''
  const token = auth.replace('Bearer ', '')
  if (token !== process.env.MCP_API_KEY) {
    return NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
  }

  const supabase = createAdminSupabaseClient()
  const results: Record<string, TableResult> = {}

  // Helper: backfill one source table given a row→capture mapper.
  async function backfill<T extends { id: string }>(
    sourceTable: string,
    rows: T[] | null,
    map: (row: T) => {
      type: VaultItemType
      title: string
      content: string
      project_id?: string | null
      capture_source: string
      tags?: string[]
      metadata?: Record<string, unknown>
    }
  ): Promise<void> {
    const existing = await existingSourceIds(supabase, sourceTable)
    let seeded = 0
    let skipped = 0

    for (const row of rows ?? []) {
      if (existing.has(row.id)) { skipped++; continue }
      const m = map(row)
      await captureToVault({
        ...m,
        source_table: sourceTable,
        source_id: row.id,
      })
      seeded++
    }

    results[sourceTable] = { seeded, skipped }
  }

  // --- agent_handoffs → agent_session ---
  const { data: handoffs } = await supabase
    .from('agent_handoffs')
    .select('id, project_id, task_id, agent_name, task_description, outcome, github_commit_url, status, started_at, completed_at, created_at')

  await backfill('agent_handoffs', handoffs, h => ({
    type: 'agent_session',
    title: `${h.agent_name ?? 'agent'}: ${(h.task_description ?? '').slice(0, 80)}`.trim(),
    content: [
      h.task_description ? `Task: ${h.task_description}` : '',
      h.outcome ? `Outcome: ${h.outcome}` : '',
      `Status: ${h.status ?? 'unknown'}`,
      h.github_commit_url ? `Commit: ${h.github_commit_url}` : '',
    ].filter(Boolean).join('\n\n'),
    project_id: h.project_id ?? null,
    capture_source: 'agent_handoff',
    tags: ['agent', h.agent_name, h.status].filter((t): t is string => Boolean(t)),
    metadata: { agent_name: h.agent_name, task_id: h.task_id, started_at: h.started_at, completed_at: h.completed_at },
  }))

  // --- brain_dumps → brain_dump_mirror ---
  const { data: dumps } = await supabase
    .from('brain_dumps')
    .select('id, raw_text, classified_type, project_id, status, ai_summary, source, created_at')

  await backfill('brain_dumps', dumps, d => ({
    type: 'brain_dump_mirror',
    title: (d.ai_summary ?? d.raw_text ?? '').slice(0, 80) || 'Brain dump',
    content: d.raw_text ?? '',
    project_id: d.project_id ?? null,
    capture_source: 'brain_dump',
    tags: ['inbox', d.classified_type].filter((t): t is string => Boolean(t)),
    metadata: { classified_type: d.classified_type, status: d.status, source: d.source, ai_summary: d.ai_summary },
  }))

  // --- decisions → decision_log ---
  const { data: decisions } = await supabase
    .from('decisions')
    .select('id, project_id, decision, reasoning, decision_date, made_by, created_at')

  await backfill('decisions', decisions, d => ({
    type: 'decision_log',
    title: (d.decision ?? '').slice(0, 80) || 'Decision',
    content: [
      d.decision ? `Decision: ${d.decision}` : '',
      d.reasoning ? `Why: ${d.reasoning}` : '',
    ].filter(Boolean).join('\n\n'),
    project_id: d.project_id ?? null,
    capture_source: 'decision',
    tags: ['decision', d.made_by].filter((t): t is string => Boolean(t)),
    metadata: { made_by: d.made_by, decision_date: d.decision_date },
  }))

  // --- tasks (with a generated spec) → build_spec ---
  // Only mirror tasks that actually have a spec — that's what 'build_spec' means and
  // mirrors the forward-capture path in orchestrate/inbox actions.
  const { data: tasks } = await supabase
    .from('tasks')
    .select('id, project_id, title, description, generated_spec, status, recommended_tool, recommended_model, complexity_tier')
    .not('generated_spec', 'is', null)

  await backfill('tasks', tasks, t => ({
    type: 'build_spec',
    title: `Spec: ${(t.title ?? '').slice(0, 80)}`,
    content: t.generated_spec ?? t.description ?? t.title ?? '',
    project_id: t.project_id ?? null,
    capture_source: 'spec_gen',
    tags: ['spec', t.recommended_model].filter((t): t is string => Boolean(t)),
    metadata: { recommended_tool: t.recommended_tool, recommended_model: t.recommended_model, complexity_tier: t.complexity_tier, status: t.status },
  }))

  // --- projects → knowledge (no native 'project' type in the CHECK constraint) ---
  const { data: projects } = await supabase
    .from('projects')
    .select('id, name, slug, tier, stage, status, description, next_action, blockers, repo_url')

  await backfill('projects', projects, p => ({
    type: 'knowledge',
    title: p.name ?? 'Project',
    content: [
      p.description ? p.description : '',
      p.status ? `Status: ${p.status}` : '',
      p.next_action ? `Next: ${p.next_action}` : '',
      p.blockers ? `Blockers: ${p.blockers}` : '',
    ].filter(Boolean).join('\n\n'),
    project_id: p.id,
    capture_source: 'project_backfill',
    tags: ['project', p.stage, p.tier ? `tier-${p.tier}` : ''].filter((t): t is string => Boolean(t)),
    metadata: { slug: p.slug, tier: p.tier, stage: p.stage, repo_url: p.repo_url },
  }))

  const totalSeeded = Object.values(results).reduce((a, r) => a + r.seeded, 0)
  const totalSkipped = Object.values(results).reduce((a, r) => a + r.skipped, 0)

  return NextResponse.json({ ok: true, totalSeeded, totalSkipped, results })
}
