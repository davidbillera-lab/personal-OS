import { NextRequest, NextResponse } from 'next/server'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { requireBearer } from '@/lib/api-auth'
import { captureToVault } from '@/lib/vault'
import { fetchAllRows } from '@/lib/paginate'
import type { VaultItemType } from '@/lib/types'

// One-time idempotent backfill: mirror historical source-table rows into vault_items.
// captureToVault was added late, so big source tables (handoffs, dumps, specs, decisions,
// projects) never flowed into the vault. This walks each source table and captures any
// row that doesn't already have a matching vault_items row (matched by source_table +
// source_id), so the master vault view fills retroactively. Safe to re-run — existing
// rows are skipped. No schema change; the vault page already shows the full union.

type TableResult = { seeded: number; skipped: number; failed: number }

const MAX_ERRORS = 50

// Fetch the set of source_ids already mirrored for a given source_table, so we skip them.
async function existingSourceIds(
  supabase: ReturnType<typeof createAdminSupabaseClient>,
  sourceTable: string
): Promise<Set<string>> {
  const rows = await fetchAllRows<{ id: string; source_id: string | null }>(`vault_items:${sourceTable}`, (from, to) =>
    supabase
      .from('vault_items')
      .select('id, source_id')
      .eq('source_table', sourceTable)
      .not('source_id', 'is', null)
      .order('id', { ascending: true })
      .range(from, to)
  )

  return new Set(rows.map(r => r.source_id as string))
}

export async function POST(req: NextRequest) {
  const denied = await requireBearer(req)
  if (denied) return denied

  const supabase = createAdminSupabaseClient()
  const results: Record<string, TableResult> = {}
  const errors: string[] = []

  // Helper: backfill one source table given a row→capture mapper.
  async function backfill<T extends { id: string }>(
    sourceTable: string,
    fetchPage: (from: number, to: number) => PromiseLike<{ data: T[] | null; error: { message: string } | null }>,
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
    // Read errors throw (caught in POST -> 500); we never continue as if a read succeeded.
    const rows = await fetchAllRows<T>(sourceTable, fetchPage)
    const existing = await existingSourceIds(supabase, sourceTable)
    let seeded = 0
    let skipped = 0
    let failed = 0

    for (const row of rows) {
      if (existing.has(row.id)) { skipped++; continue }
      const m = map(row)
      const ok = await captureToVault({
        ...m,
        source_table: sourceTable,
        source_id: row.id,
      })
      if (ok) seeded++
      else {
        failed++
        if (errors.length < MAX_ERRORS) errors.push(`${sourceTable} ${row.id}: vault insert failed`)
      }
    }

    results[sourceTable] = { seeded, skipped, failed }
  }

  try {
  // --- agent_handoffs → agent_session ---
  await backfill('agent_handoffs', (from, to) =>
    supabase
      .from('agent_handoffs')
      .select('id, project_id, task_id, agent_name, task_description, outcome, github_commit_url, status, started_at, completed_at, created_at')
      .order('id', { ascending: true })
      .range(from, to), h => ({
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
  await backfill('brain_dumps', (from, to) =>
    supabase
      .from('brain_dumps')
      .select('id, raw_text, classified_type, project_id, status, ai_summary, source, created_at')
      .order('id', { ascending: true })
      .range(from, to), d => ({
    type: 'brain_dump_mirror',
    title: (d.ai_summary ?? d.raw_text ?? '').slice(0, 80) || 'Brain dump',
    content: d.raw_text ?? '',
    project_id: d.project_id ?? null,
    capture_source: 'brain_dump',
    tags: ['inbox', d.classified_type].filter((t): t is string => Boolean(t)),
    metadata: { classified_type: d.classified_type, status: d.status, source: d.source, ai_summary: d.ai_summary },
  }))

  // --- decisions → decision_log ---
  await backfill('decisions', (from, to) =>
    supabase
      .from('decisions')
      .select('id, project_id, decision, reasoning, decision_date, made_by, created_at')
      .order('id', { ascending: true })
      .range(from, to), d => ({
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
  await backfill('tasks', (from, to) =>
    supabase
      .from('tasks')
      .select('id, project_id, title, description, generated_spec, status, recommended_tool, recommended_model, complexity_tier')
      .not('generated_spec', 'is', null)
      .order('id', { ascending: true })
      .range(from, to), t => ({
    type: 'build_spec',
    title: `Spec: ${(t.title ?? '').slice(0, 80)}`,
    content: t.generated_spec ?? t.description ?? t.title ?? '',
    project_id: t.project_id ?? null,
    capture_source: 'spec_gen',
    tags: ['spec', t.recommended_model].filter((t): t is string => Boolean(t)),
    metadata: { recommended_tool: t.recommended_tool, recommended_model: t.recommended_model, complexity_tier: t.complexity_tier, status: t.status },
  }))

  // --- projects → knowledge (no native 'project' type in the CHECK constraint) ---
  await backfill('projects', (from, to) =>
    supabase
      .from('projects')
      .select('id, name, slug, tier, stage, status, description, next_action, blockers, repo_url')
      .order('id', { ascending: true })
      .range(from, to), p => ({
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

  } catch (e) {
    return NextResponse.json({ ok: false, error: (e as Error).message, results, errors }, { status: 500 })
  }

  const totalSeeded = Object.values(results).reduce((a, r) => a + r.seeded, 0)
  const totalSkipped = Object.values(results).reduce((a, r) => a + r.skipped, 0)

  const totalFailed = Object.values(results).reduce((a, r) => a + r.failed, 0)

  return NextResponse.json(
    { ok: totalFailed === 0, totalSeeded, totalSkipped, totalFailed, results, errors },
    { status: totalFailed === 0 ? 200 : 207 }
  )
}
