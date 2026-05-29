1# MC Pipeline Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Transform Mission Control from a read-only display board into a full pipeline runner — Brain Dump → Advisory Board (manual trigger) → Spec Review → VS Code handoff → Codex QC (live GPT-5.5).

**Architecture:** Stage-based pipeline replaces tab-based project workspace. Dashboard gets pipeline-count cards with "Run Pipeline →" buttons. Project workspace becomes three columns: left sidebar (pipeline stages + health), main panel (stage content), right Build Partner chat. All AI calls route through the existing `routeTask()` function in `lib/models/router.ts` — no direct SDK calls. Server actions (not API routes) handle all mutations. A migration adds the two missing DB fields.

**Tech Stack:** Next.js App Router (server components + server actions), Supabase Postgres, `routeTask()` from `lib/models/router.ts` (Haiku for AB, Sonnet for spec gen, GPT-5.5 for Codex QC)

---

## File Map

**Create:**
- `supabase/migrations/009_pipeline_redesign.sql` — adds `tasks.tool` and `tasks.model_tier` (008 already covers the rest)
- `app/(app)/projects/[id]/actions.ts` — server actions: `runAdvisoryBoard`, `generateSpec`, `approveSpec`, `runCodexQC`, `markTaskDone`, `generateSuggestions`

**Modify:**
- `lib/types.ts` — add `AbVerdict`, `CodexQcStatus`, `TaskTool` type aliases; add pipeline fields to `BrainDump`, `Task`, `AgentHandoff`
- `components/Nav.tsx` — remove Orchestrate from nav links
- `app/(app)/page.tsx` — add per-project dump/task counts, rebuild project cards as pipeline cards
- `app/(app)/projects/[id]/page.tsx` — add `doneTasks` query, pass to component
- `components/ProjectWorkspaceTabs.tsx` — full redesign: 3-column layout with pipeline stage sidebar

---

## Task 1: Migration 009

Migration 008 already exists and covers `brain_dumps.ab_verdict`, `brain_dumps.ab_reasoning`, `tasks.spec_path`, `tasks.codex_qc_status`, `tasks.codex_qc_notes`, and `agent_handoffs.spec_path`. Only two fields are missing.

**Files:**
- Create: `supabase/migrations/009_pipeline_redesign.sql`

- [ ] **Step 1: Write the migration**

```sql
-- supabase/migrations/009_pipeline_redesign.sql

ALTER TABLE tasks
  ADD COLUMN IF NOT EXISTS tool        TEXT CHECK (tool IN ('claude_code', 'codex', 'cursor')),
  ADD COLUMN IF NOT EXISTS model_tier  INTEGER CHECK (model_tier BETWEEN 1 AND 4);
```

- [ ] **Step 2: Apply the migration**

Run: `npx supabase db push`

Expected: migration applies, `tasks` table now has `tool` and `model_tier` columns.

- [ ] **Step 3: Commit**

```bash
git add supabase/migrations/009_pipeline_redesign.sql
git commit -m "feat: migration 009 — add tasks.tool and tasks.model_tier"
```

---

## Task 2: Update TypeScript Types

**Files:**
- Modify: `lib/types.ts`

Read the file first to confirm exact line numbers before editing.

- [ ] **Step 1: Add new type aliases**

After the existing union types near the top of `lib/types.ts`, add:

```typescript
export type AbVerdict = 'keep' | 'kill' | 'pending'
export type CodexQcStatus = 'pending' | 'passed' | 'issues_found' | 'loop_detected'
export type TaskTool = 'claude_code' | 'codex' | 'cursor'
```

- [ ] **Step 2: Add pipeline fields to BrainDump**

In the `BrainDump` interface, add after `ai_summary`:

```typescript
  ab_verdict: AbVerdict | null
  ab_reasoning: string | null
```

- [ ] **Step 3: Add pipeline fields to Task**

In the `Task` interface, add after `generated_spec`:

```typescript
  spec_path: string | null
  tool: TaskTool | null
  model_tier: number | null
  codex_qc_status: CodexQcStatus | null
  codex_qc_notes: string | null
```

- [ ] **Step 4: Add spec_path to AgentHandoff**

In the `AgentHandoff` interface, add after `github_commit_url`:

```typescript
  spec_path: string | null
```

- [ ] **Step 5: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors.

- [ ] **Step 6: Commit**

```bash
git add lib/types.ts
git commit -m "feat: add AbVerdict, CodexQcStatus, TaskTool types and pipeline fields to BrainDump/Task/AgentHandoff"
```

---

## Task 3: Server Actions

All AI calls go through `routeTask()` from `lib/models/router.ts`. Check the signature before writing — it takes `{ prompt, complexity_tier, purpose, model?, system?, project_id?, task_id?, brain_dump_id?, allow_escalate?, supabase }` and returns `{ text, usage }`.

**Files:**
- Create: `app/(app)/projects/[id]/actions.ts`

- [ ] **Step 1: Read `lib/models/router.ts`**

Read the file to confirm the exact `routeTask` signature and return type before writing the actions.

- [ ] **Step 2: Read `app/(app)/inbox/actions.ts`**

Read to confirm the server action pattern used in this codebase (how `routeTask` is called, how `revalidatePath` is used, how errors are returned).

- [ ] **Step 3: Write the actions file**

```typescript
// app/(app)/projects/[id]/actions.ts
'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import { routeTask } from '@/lib/models/router'
import { revalidatePath } from 'next/cache'

// ── Advisory Board ──────────────────────────────────────────────────────────

export async function runAdvisoryBoard(dumpId: string, projectId: string) {
  const supabase = await createServerSupabaseClient()

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

  const result = await routeTask({
    prompt,
    system,
    complexity_tier: 1,
    purpose: 'advisory_board',
    project_id: projectId,
    brain_dump_id: dumpId,
    supabase,
  })

  let verdict: 'keep' | 'kill' = 'keep'
  let reasoning = ''

  try {
    const parsed = JSON.parse(result.text)
    verdict = parsed.verdict
    reasoning = parsed.reasoning
  } catch {
    reasoning = result.text
  }

  await supabase
    .from('brain_dumps')
    .update({ ab_verdict: verdict, ab_reasoning: reasoning })
    .eq('id', dumpId)

  revalidatePath(`/projects/${projectId}`)
  return { verdict, reasoning }
}

// ── Spec Generation ──────────────────────────────────────────────────────────

export async function generateSpec(
  dumpId: string,
  projectId: string,
  claudeMd: string,
  decisionsMd: string
) {
  const supabase = await createServerSupabaseClient()

  const { data: dump } = await supabase
    .from('brain_dumps')
    .select('raw_text, classified_type, ai_summary, ab_verdict, ab_reasoning')
    .eq('id', dumpId)
    .single()

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

  const prompt = `CLAUDE.md:
${claudeMd || '(not available)'}

decisions.md:
${decisionsMd || '(not available)'}

Brain dump:
"${dump.raw_text}"

Advisory Board verdict: ${dump.ab_verdict ?? 'none'} — ${dump.ab_reasoning ?? ''}

Generate the implementation spec.`

  const result = await routeTask({
    prompt,
    system,
    complexity_tier: 2,
    purpose: 'spec_generation',
    project_id: projectId,
    brain_dump_id: dumpId,
    supabase,
  })

  const specContent = result.text
  const today = new Date().toISOString().slice(0, 10)
  const slug = dump.raw_text
    .toLowerCase()
    .replace(/[^a-z0-9\s-]/g, '')
    .replace(/\s+/g, '-')
    .slice(0, 60)
  const specPath = `docs/superpowers/plans/${today}-${slug}.md`

  // Determine tool + tier from spec content (simple heuristic; operator can override)
  const tier = dump.classified_type === 'bug' ? 1 : 2
  const tool = 'claude_code'

  const { data: task, error } = await supabase
    .from('tasks')
    .insert({
      project_id: projectId,
      brain_dump_id: dumpId,
      title: dump.raw_text.slice(0, 120),
      description: dump.ai_summary,
      complexity_tier: tier,
      recommended_tool: tool,
      tool,
      model_tier: tier,
      generated_spec: specContent,
      spec_path: specPath,
      status: 'pending',
    })
    .select()
    .single()

  if (error) return { error: error.message }

  await supabase
    .from('brain_dumps')
    .update({ status: 'spec_generated' })
    .eq('id', dumpId)

  revalidatePath(`/projects/${projectId}`)
  return { task, specContent, specPath }
}

// ── Approve Spec (move task to in_progress, log handoff) ────────────────────

export async function approveSpec(taskId: string, projectId: string, localPath?: string) {
  const supabase = await createServerSupabaseClient()

  const { data: task } = await supabase
    .from('tasks')
    .select('title, spec_path, generated_spec')
    .eq('id', taskId)
    .single()

  if (!task) return { error: 'Task not found' }

  await supabase
    .from('tasks')
    .update({ status: 'in_progress' })
    .eq('id', taskId)

  await supabase.from('agent_handoffs').insert({
    project_id: projectId,
    task_id: taskId,
    agent_name: 'Claude Code',
    task_description: task.title,
    spec_path: task.spec_path,
    status: 'in_progress',
  })

  revalidatePath(`/projects/${projectId}`)

  const vscodePath = localPath
    ? `vscode://file/${localPath.replace(/\\/g, '/')}`
    : null

  return { ok: true, vscodePath }
}

// ── Codex QC ─────────────────────────────────────────────────────────────────

export async function runCodexQC(
  taskId: string,
  projectId: string,
  diff: string,
  commitUrl?: string
) {
  const supabase = await createServerSupabaseClient()

  const { data: task } = await supabase
    .from('tasks')
    .select('title, generated_spec')
    .eq('id', taskId)
    .single()

  if (!task) return { error: 'Task not found' }

  const system = `You are a code reviewer. Review the diff against the original spec.

Check for:
1. Correctness — does the code do what the spec asked?
2. Regressions — does anything look broken that wasn't touched?
3. Scope adherence — did the agent go out of scope or leave things undone?
4. Code quality — anything obviously wrong?

Respond ONLY with valid JSON:
{"status": "passed" | "issues_found", "notes": "If passed: confirm what was verified. If issues_found: list each issue clearly."}`

  const prompt = `Original spec:
${task.generated_spec ?? '(no spec recorded)'}

Git diff:
${diff}

Commit: ${commitUrl ?? 'not provided'}`

  const result = await routeTask({
    prompt,
    system,
    complexity_tier: 4,
    model: 'gpt-4o',
    purpose: 'codex_qc',
    project_id: projectId,
    task_id: taskId,
    supabase,
  })

  let status: 'passed' | 'issues_found' = 'passed'
  let notes = ''

  try {
    const parsed = JSON.parse(result.text)
    status = parsed.status
    notes = parsed.notes
  } catch {
    notes = result.text
  }

  await supabase
    .from('tasks')
    .update({
      codex_qc_status: status,
      codex_qc_notes: notes,
      status: status === 'passed' ? 'done' : 'review',
    })
    .eq('id', taskId)

  if (commitUrl && status === 'passed') {
    await supabase
      .from('agent_handoffs')
      .update({ status: 'done', github_commit_url: commitUrl, completed_at: new Date().toISOString() })
      .eq('task_id', taskId)
  }

  revalidatePath(`/projects/${projectId}`)
  return { status, notes }
}

// ── Mark Done (operator override) ────────────────────────────────────────────

export async function markTaskDone(taskId: string, projectId: string) {
  const supabase = await createServerSupabaseClient()
  await supabase
    .from('tasks')
    .update({ status: 'done', codex_qc_status: 'passed' })
    .eq('id', taskId)
  revalidatePath(`/projects/${projectId}`)
  return { ok: true }
}

// ── AI Suggestions (kept here since ProjectWorkspaceTabs imports from this path) ──

export async function generateSuggestions(projectId: string) {
  const supabase = await createServerSupabaseClient()

  const { data: project } = await supabase
    .from('projects')
    .select('name, stage, status, next_action, blockers, description')
    .eq('id', projectId)
    .single()

  if (!project) return { error: 'Project not found', suggestions: null }

  const { data: recentDumps } = await supabase
    .from('brain_dumps')
    .select('raw_text, classified_type, ab_verdict')
    .eq('project_id', projectId)
    .order('created_at', { ascending: false })
    .limit(5)

  const prompt = `Project: ${project.name}
Stage: ${project.stage}
Status: ${project.status ?? 'none'}
Next action: ${project.next_action ?? 'none'}
Blockers: ${project.blockers ?? 'none'}

Recent brain dumps:
${(recentDumps ?? []).map(d => `- [${d.classified_type ?? 'unclassified'}${d.ab_verdict ? `, AB: ${d.ab_verdict}` : ''}] ${d.raw_text}`).join('\n')}

Give 3 concrete, actionable suggestions for what the operator should tackle next on this project. Be specific. No fluff.`

  const result = await routeTask({
    prompt,
    complexity_tier: 2,
    purpose: 'project_suggestions',
    project_id: projectId,
    supabase,
  })

  await supabase
    .from('projects')
    .update({ lead_suggestions: result.text, suggestions_updated_at: new Date().toISOString() })
    .eq('id', projectId)

  revalidatePath(`/projects/${projectId}`)
  return { suggestions: result.text, error: null }
}
```

- [ ] **Step 4: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors. Fix any type mismatches before continuing.

- [ ] **Step 5: Commit**

```bash
git add "app/(app)/projects/[id]/actions.ts"
git commit -m "feat: pipeline server actions — AB, spec gen, Codex QC, approve, mark done, suggestions"
```

---

## Task 4: Remove Orchestrate from Nav

**Files:**
- Modify: `components/Nav.tsx`

- [ ] **Step 1: Remove the Orchestrate entry**

In `components/Nav.tsx`, change `navLinks` from:

```typescript
const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/orchestrate', label: 'Orchestrate' },
  { href: '/vault', label: 'Vault' },
]
```

to:

```typescript
const navLinks = [
  { href: '/', label: 'Dashboard' },
  { href: '/inbox', label: 'Inbox' },
  { href: '/vault', label: 'Vault' },
]
```

- [ ] **Step 2: Verify nav renders**

Dev server running → visit `http://localhost:3000`. Confirm: Dashboard · Inbox · Vault — no Orchestrate.

- [ ] **Step 3: Commit**

```bash
git add components/Nav.tsx
git commit -m "feat: remove Orchestrate from nav — replaced by Dashboard pipeline cards"
```

---

## Task 5: Dashboard Pipeline Cards

**Files:**
- Modify: `app/(app)/page.tsx`

Read the file first to understand current structure before editing.

- [ ] **Step 1: Read `app/(app)/page.tsx`**

Read the entire file. Note: current data fetches, how `projects` are rendered, any existing `specReadyCount` logic.

- [ ] **Step 2: Add per-project pipeline count queries**

In the parallel `Promise.all` block (after fetching `projects`), add two more queries:

```typescript
  const [
    { data: projects },
    // ... existing queries ...
    { data: taskCountRows },
    { data: dumpCountRows },
  ] = await Promise.all([
    supabase.from('projects').select('*').order('tier').order('name'),
    // ... existing queries ...
    supabase.from('tasks').select('project_id, status').in('status', ['pending', 'in_progress', 'review']),
    supabase.from('brain_dumps').select('project_id, status').not('status', 'in', '("actioned","archived","spec_generated")'),
  ])
```

- [ ] **Step 3: Build the pipeline counts map**

After the data fetches, add:

```typescript
  const pipelineByProject: Record<string, { dumps: number; specReady: number; inFlight: number }> = {}
  for (const p of projects ?? []) {
    const dumps = (dumpCountRows ?? []).filter(d => d.project_id === p.id).length
    const specReady = (taskCountRows ?? []).filter(t => t.project_id === p.id && t.status === 'pending').length
    const inFlight = (taskCountRows ?? []).filter(t => t.project_id === p.id && t.status === 'in_progress').length
    pipelineByProject[p.id] = { dumps, specReady, inFlight }
  }
```

- [ ] **Step 4: Replace project card rendering with pipeline cards**

Find where project cards are rendered and replace with:

```tsx
<div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
  {(projects ?? []).map(project => {
    const counts = pipelineByProject[project.id] ?? { dumps: 0, specReady: 0, inFlight: 0 }
    const hasActivity = counts.dumps > 0 || counts.specReady > 0 || counts.inFlight > 0
    const stageColor: Record<string, string> = {
      idea:  'bg-slate-100 text-slate-700',
      spec:  'bg-yellow-100 text-yellow-700',
      build: 'bg-green-100 text-green-700',
      ship:  'bg-blue-100 text-blue-700',
      scale: 'bg-purple-100 text-purple-700',
      kill:  'bg-red-100 text-red-700',
    }
    return (
      <div key={project.id} className="rounded-lg border border-border bg-card p-4 flex flex-col gap-3">
        <div className="flex items-start justify-between gap-2">
          <div>
            <p className="text-sm font-semibold">{project.name}</p>
            <p className="text-[10px] text-muted-foreground">
              Tier {project.tier}{project.protected ? ' · Protected' : ''}
            </p>
          </div>
          <span className={`rounded-full px-2 py-0.5 text-[10px] font-medium ${stageColor[project.stage] ?? 'bg-slate-100 text-slate-700'}`}>
            {project.stage}
          </span>
        </div>

        <p className="text-[11px] text-muted-foreground">
          <span>{counts.dumps} dump{counts.dumps !== 1 ? 's' : ''}</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span>{counts.specReady} spec ready</span>
          <span className="mx-1.5 opacity-40">·</span>
          <span>{counts.inFlight} in flight</span>
        </p>

        {project.blockers && (
          <p className="text-[11px] text-yellow-700 bg-yellow-50 rounded px-2 py-1">
            Blocked: {project.blockers}
          </p>
        )}

        <a
          href={`/projects/${project.id}`}
          className={[
            'mt-auto rounded px-3 py-1.5 text-[11px] font-medium text-center transition-colors',
            hasActivity
              ? 'bg-primary text-primary-foreground hover:bg-primary/90'
              : 'border border-input text-muted-foreground hover:text-foreground',
          ].join(' ')}
        >
          {hasActivity ? 'Run Pipeline →' : 'View Project →'}
        </a>
      </div>
    )
  })}
</div>
```

- [ ] **Step 5: Verify dashboard renders**

Dev server running → visit `http://localhost:3000`. Confirm: pipeline cards show dump/spec/in-flight counts. Projects with activity show "Run Pipeline →" in filled style. Projects with no activity show "View Project →" as outline button.

- [ ] **Step 6: Commit**

```bash
git add "app/(app)/page.tsx"
git commit -m "feat: dashboard pipeline cards — per-project counts, Run Pipeline button"
```

---

## Task 6: Project Workspace Pipeline Redesign

Replaces the 4-tab workspace with a 3-column pipeline layout. This is the largest task — read all current file contents before writing.

**Files:**
- Modify: `components/ProjectWorkspaceTabs.tsx`
- Modify: `app/(app)/projects/[id]/page.tsx`

- [ ] **Step 1: Update the project page queries**

In `app/(app)/projects/[id]/page.tsx`, expand the parallel fetch to add `doneTasks` and tighten the select fields:

```typescript
  const [
    { data: project },
    { data: brainDumps },
    { data: tasks },
    { data: doneTasks },
    { data: chats },
    { data: handoffs },
  ] = await Promise.all([
    supabase.from('projects').select('*').eq('id', id).single(),
    supabase
      .from('brain_dumps')
      .select('id, raw_text, classified_type, ab_verdict, ab_reasoning, status, ai_summary, created_at')
      .eq('project_id', id)
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id, project_id, title, description, complexity_tier, recommended_tool, recommended_model, generated_spec, spec_path, codex_qc_status, codex_qc_notes, status, created_at')
      .eq('project_id', id)
      .not('status', 'in', '("done","killed")')
      .order('created_at', { ascending: false }),
    supabase
      .from('tasks')
      .select('id, project_id, title, codex_qc_status, codex_qc_notes, status, created_at')
      .eq('project_id', id)
      .eq('status', 'done')
      .order('created_at', { ascending: false })
      .limit(20),
    supabase
      .from('project_chats')
      .select('*')
      .eq('project_id', id)
      .order('created_at', { ascending: true })
      .limit(50),
    supabase
      .from('agent_handoffs')
      .select('*')
      .eq('project_id', id)
      .order('started_at', { ascending: false })
      .limit(20),
  ])
```

And update the component call to pass `doneTasks`:

```typescript
  return (
    <ProjectWorkspaceTabs
      project={project}
      brainDumps={brainDumps ?? []}
      tasks={tasks ?? []}
      doneTasks={(doneTasks ?? []) as Task[]}
      initialChats={chats ?? []}
      claudeMd={claudeMd}
      decisionsMd={decisionsMd}
      handoffs={(handoffs ?? []) as AgentHandoff[]}
      health={health}
    />
  )
```

Add `import type { Task } from '@/lib/types'` if not already imported.

- [ ] **Step 2: Replace ProjectWorkspaceTabs**

Replace the full content of `components/ProjectWorkspaceTabs.tsx` with:

```typescript
'use client'

import { useState, useTransition } from 'react'
import { ProjectChat } from '@/components/ProjectChat'
import {
  runAdvisoryBoard,
  generateSpec,
  approveSpec,
  runCodexQC,
  markTaskDone,
  generateSuggestions,
} from '@/app/(app)/projects/[id]/actions'
import type {
  Project, BrainDump, Task, ProjectChat as ProjectChatType,
  AgentHandoff, ProjectHealth, HealthStatus,
} from '@/lib/types'

type Stage = 'dumps' | 'spec_review' | 'in_flight' | 'done' | 'mission_brief' | 'handoff_log'

const HEALTH_DOT: Record<HealthStatus, string> = {
  ok:      'bg-green-400',
  warn:    'bg-yellow-400',
  error:   'bg-red-400',
  unknown: 'bg-gray-500',
}

const DUMP_TYPE_COLORS: Record<string, string> = {
  idea:           'bg-blue-100 text-blue-700',
  task:           'bg-yellow-100 text-yellow-700',
  bug:            'bg-red-100 text-red-700',
  decision:       'bg-purple-100 text-purple-700',
  kill_candidate: 'bg-orange-100 text-orange-700',
  unclassified:   'bg-slate-100 text-slate-600',
}

const HANDOFF_STATUS_COLOR: Record<string, string> = {
  in_progress: 'text-yellow-600',
  done:        'text-green-600',
  failed:      'text-red-600',
  review:      'text-blue-600',
}

function timeSince(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime()
  const mins = Math.floor(diff / 60_000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  return `${Math.floor(hrs / 24)}d ago`
}

interface Props {
  project: Project
  brainDumps: BrainDump[]
  tasks: Task[]
  doneTasks: Task[]
  initialChats: ProjectChatType[]
  claudeMd: string
  decisionsMd: string
  handoffs: AgentHandoff[]
  health: ProjectHealth | null
}

export function ProjectWorkspaceTabs({
  project, brainDumps, tasks, doneTasks, initialChats,
  claudeMd, decisionsMd, handoffs, health,
}: Props) {
  const [stage, setStage] = useState<Stage>('dumps')
  const [isPending, startTransition] = useTransition()
  const [pendingId, setPendingId] = useState<string | null>(null)
  const [error, setError] = useState<string | null>(null)

  // Pipeline bucket filters
  const activeDumps = brainDumps.filter(
    d => !['actioned', 'archived', 'spec_generated'].includes(d.status ?? '')
  )
  const specReadyTasks = tasks.filter(t => t.status === 'pending' && t.generated_spec)
  const inFlightTasks = tasks.filter(t => t.status === 'in_progress' || t.status === 'review')

  function withPending<T>(id: string, fn: () => Promise<{ error?: string } & T>) {
    setError(null)
    setPendingId(id)
    startTransition(async () => {
      const result = await fn()
      if (result.error) setError(result.error)
      setPendingId(null)
    })
  }

  const sidebarStages: { key: Stage; label: string; count?: number }[] = [
    { key: 'dumps',       label: 'Dumps',      count: activeDumps.length },
    { key: 'spec_review', label: 'Spec Review', count: specReadyTasks.length },
    { key: 'in_flight',   label: 'In Flight',   count: inFlightTasks.length },
    { key: 'done',        label: 'Done' },
  ]
  const sidebarContext: { key: Stage; label: string }[] = [
    { key: 'mission_brief', label: 'Mission Brief' },
    { key: 'handoff_log',   label: 'Handoff Log' },
  ]

  return (
    <div className="flex flex-col gap-4">
      {/* Header */}
      <div className="flex items-start justify-between gap-4">
        <div>
          <h1 className="text-2xl font-bold tracking-tight">{project.name}</h1>
          {project.description && (
            <p className="mt-1 text-sm text-muted-foreground">{project.description}</p>
          )}
        </div>
        <a
          href={`/projects/${project.id}/edit`}
          className="rounded border border-input px-3 py-1.5 text-[11px] font-medium text-muted-foreground hover:text-foreground hover:border-foreground/40"
        >
          Edit
        </a>
      </div>

      {error && (
        <div className="rounded bg-red-50 px-3 py-2 text-sm text-red-700">{error}</div>
      )}

      {/* Three-column layout */}
      <div className="flex border border-border rounded-lg overflow-hidden min-h-[560px]">

        {/* Left sidebar */}
        <div className="w-40 shrink-0 border-r border-border bg-muted/30 flex flex-col py-3 px-2 gap-0.5">
          <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">Pipeline</p>
          {sidebarStages.map(({ key, label, count }) => (
            <button
              key={key}
              onClick={() => setStage(key)}
              className={[
                'flex items-center justify-between px-2 py-1.5 rounded text-[11px] font-medium text-left transition-colors',
                stage === key
                  ? 'bg-background border border-border text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              ].join(' ')}
            >
              <span>{label}</span>
              {count != null && count > 0 && (
                <span className="rounded-full bg-primary/10 text-primary px-1.5 text-[9px]">{count}</span>
              )}
            </button>
          ))}

          <div className="mt-auto pt-3 border-t border-border flex flex-col gap-0.5">
            <p className="px-2 mb-1 text-[9px] font-semibold uppercase tracking-widest text-muted-foreground/50">Context</p>
            {sidebarContext.map(({ key, label }) => (
              <button
                key={key}
                onClick={() => setStage(key)}
                className={[
                  'px-2 py-1.5 rounded text-[11px] text-left transition-colors',
                  stage === key ? 'text-foreground' : 'text-muted-foreground hover:text-foreground',
                ].join(' ')}
              >
                {label}
              </button>
            ))}

            {health && (
              <div className="px-2 mt-2 flex flex-col gap-0.5">
                {(['github', 'vercel', 'supabase'] as const).map(svc => {
                  const status = health[`${svc}_status` as keyof typeof health] as HealthStatus
                  return (
                    <div key={svc} className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 rounded-full ${HEALTH_DOT[status]}`} />
                      <span className="text-[9px] text-muted-foreground capitalize">{svc}</span>
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        </div>

        {/* Main panel */}
        <div className="flex-1 overflow-auto p-4 flex flex-col gap-3">

          {/* ─── DUMPS ─── */}
          {stage === 'dumps' && (
            <>
              <p className="text-sm font-semibold">Brain Dumps</p>
              {activeDumps.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-12">No pending dumps.</p>
                : activeDumps.map(dump => (
                  <div
                    key={dump.id}
                    className={[
                      'rounded-md border p-3 flex flex-col gap-2',
                      dump.ab_verdict === 'keep' ? 'border-green-200 bg-green-50/40' :
                      dump.ab_verdict === 'kill' ? 'border-red-200 bg-red-50/30' :
                      'border-border bg-card',
                    ].join(' ')}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs leading-snug flex-1 text-foreground">"{dump.raw_text}"</p>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {dump.classified_type && (
                          <span className={`rounded-full px-2 py-0.5 text-[9px] font-medium ${DUMP_TYPE_COLORS[dump.classified_type] ?? 'bg-slate-100 text-slate-600'}`}>
                            {dump.classified_type.replace('_', ' ')}
                          </span>
                        )}
                        <span className="text-[9px] text-muted-foreground/50">{timeSince(dump.created_at)}</span>
                      </div>
                    </div>

                    {dump.ai_summary && (
                      <p className="text-[11px] text-muted-foreground italic">{dump.ai_summary}</p>
                    )}

                    {dump.ab_verdict && (
                      <div className={[
                        'rounded px-2.5 py-1.5 text-[11px] leading-relaxed',
                        dump.ab_verdict === 'keep' ? 'bg-green-50 text-green-900' : 'bg-red-50 text-red-900',
                      ].join(' ')}>
                        <span className="font-semibold">Advisory Board: </span>
                        <span className={`font-medium ${dump.ab_verdict === 'keep' ? 'text-green-700' : 'text-red-700'}`}>
                          {dump.ab_verdict === 'keep' ? 'Keep' : 'Kill'}
                        </span>
                        {' — '}{dump.ab_reasoning}
                      </div>
                    )}

                    <div className="flex items-center gap-2 flex-wrap">
                      {!dump.ab_verdict && (
                        <button
                          disabled={isPending && pendingId === dump.id}
                          onClick={() => withPending(dump.id, () => runAdvisoryBoard(dump.id, project.id))}
                          className="rounded border border-input px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          {isPending && pendingId === dump.id ? 'Evaluating…' : 'Run Advisory Board'}
                        </button>
                      )}
                      {dump.ab_verdict === 'kill' && (
                        <button
                          disabled={isPending && pendingId === dump.id}
                          onClick={() => withPending(dump.id, () => runAdvisoryBoard(dump.id, project.id))}
                          className="rounded border border-input px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                        >
                          Re-run Advisory Board
                        </button>
                      )}
                      {dump.ab_verdict === 'keep' && (
                        <button
                          disabled={isPending && pendingId === dump.id}
                          onClick={() =>
                            withPending(dump.id, async () => {
                              const result = await generateSpec(dump.id, project.id, claudeMd, decisionsMd)
                              if (!result.error) setStage('spec_review')
                              return result
                            })
                          }
                          className="rounded bg-primary text-primary-foreground px-2 py-1 text-[10px] font-medium hover:bg-primary/90 disabled:opacity-50"
                        >
                          {isPending && pendingId === dump.id ? 'Generating…' : 'Approve → Generate Spec'}
                        </button>
                      )}
                    </div>
                  </div>
                ))
              }
            </>
          )}

          {/* ─── SPEC REVIEW ─── */}
          {stage === 'spec_review' && (
            <>
              <p className="text-sm font-semibold">Spec Review</p>
              {specReadyTasks.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-12">No specs awaiting review.</p>
                : specReadyTasks.map(task => (
                  <div key={task.id} className="rounded-md border border-border bg-card p-4 flex flex-col gap-3">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-sm font-medium">{task.title}</p>
                      <div className="flex gap-1.5 shrink-0">
                        {task.complexity_tier != null && (
                          <span className="rounded-full px-2 py-0.5 text-[9px] bg-blue-100 text-blue-700">
                            Tier {task.complexity_tier}
                          </span>
                        )}
                        {task.recommended_tool && (
                          <span className="rounded-full px-2 py-0.5 text-[9px] bg-slate-100 text-slate-700">
                            {task.recommended_tool}
                          </span>
                        )}
                      </div>
                    </div>

                    {task.generated_spec && (
                      <div className="rounded border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed max-h-64 overflow-y-auto whitespace-pre-wrap">
                        {task.generated_spec}
                      </div>
                    )}

                    <button
                      disabled={isPending && pendingId === task.id}
                      onClick={() =>
                        withPending(task.id, async () => {
                          const result = await approveSpec(task.id, project.id, project.local_path ?? undefined)
                          if (!result.error && result.vscodePath) {
                            window.location.href = result.vscodePath
                          }
                          if (!result.error) setStage('in_flight')
                          return result
                        })
                      }
                      className="rounded bg-primary text-primary-foreground px-3 py-2 text-[11px] font-medium hover:bg-primary/90 disabled:opacity-50"
                    >
                      {isPending && pendingId === task.id ? 'Opening…' : 'Open in VS Code →'}
                    </button>
                  </div>
                ))
              }
            </>
          )}

          {/* ─── IN FLIGHT ─── */}
          {stage === 'in_flight' && (
            <>
              <p className="text-sm font-semibold">In Flight</p>
              {inFlightTasks.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-12">Nothing in flight.</p>
                : inFlightTasks.map(task => (
                  <div key={task.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-2">
                    <div className="flex items-start justify-between gap-2">
                      <p className="text-xs font-medium">{task.title}</p>
                      <span className={[
                        'rounded-full px-2 py-0.5 text-[9px] font-medium',
                        task.codex_qc_status === 'passed'       ? 'bg-green-100 text-green-700' :
                        task.codex_qc_status === 'issues_found' ? 'bg-red-100 text-red-700' :
                        task.codex_qc_status === 'loop_detected'? 'bg-orange-100 text-orange-700' :
                        'bg-slate-100 text-slate-500',
                      ].join(' ')}>
                        {task.codex_qc_status ? task.codex_qc_status.replace(/_/g, ' ') : 'QC pending'}
                      </span>
                    </div>

                    {task.codex_qc_notes && (
                      <div className="rounded bg-muted/40 px-2 py-1.5 text-[10px] text-muted-foreground">
                        {task.codex_qc_notes}
                      </div>
                    )}

                    {!task.codex_qc_status && (
                      <CodexQCForm taskId={task.id} projectId={project.id} />
                    )}

                    <button
                      disabled={isPending && pendingId === task.id}
                      onClick={() => withPending(task.id, () => markTaskDone(task.id, project.id))}
                      className="self-start rounded border border-input px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
                    >
                      Mark Done
                    </button>
                  </div>
                ))
              }
            </>
          )}

          {/* ─── DONE ─── */}
          {stage === 'done' && (
            <>
              <p className="text-sm font-semibold">Done</p>
              {doneTasks.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-12">No completed tasks yet.</p>
                : doneTasks.map(task => (
                  <div key={task.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <p className="text-xs font-medium">{task.title}</p>
                      <span className="rounded-full px-2 py-0.5 text-[9px] bg-green-100 text-green-700">done</span>
                    </div>
                    {task.codex_qc_notes && (
                      <p className="text-[10px] text-muted-foreground">{task.codex_qc_notes}</p>
                    )}
                  </div>
                ))
              }
            </>
          )}

          {/* ─── MISSION BRIEF ─── */}
          {stage === 'mission_brief' && (
            <MissionBrief project={project} claudeMd={claudeMd} decisionsMd={decisionsMd} />
          )}

          {/* ─── HANDOFF LOG ─── */}
          {stage === 'handoff_log' && (
            <>
              <p className="text-sm font-semibold">Handoff Log</p>
              {handoffs.length === 0
                ? <p className="text-sm text-muted-foreground text-center py-12">No agent sessions yet.</p>
                : handoffs.map(h => (
                  <div key={h.id} className="rounded-md border border-border bg-card p-3 flex flex-col gap-1.5">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`text-xs font-medium ${HANDOFF_STATUS_COLOR[h.status] ?? 'text-muted-foreground'}`}>
                        {h.agent_name}
                      </span>
                      <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] text-muted-foreground">
                        {h.status.replace('_', ' ')}
                      </span>
                      <span className="ml-auto text-[10px] text-muted-foreground/60">{timeSince(h.started_at)}</span>
                    </div>
                    {h.task_description && (
                      <p className="text-xs text-foreground leading-snug">{h.task_description}</p>
                    )}
                    {h.outcome && (
                      <p className="text-[11px] text-muted-foreground">{h.outcome}</p>
                    )}
                    {h.github_commit_url && (
                      <a
                        href={h.github_commit_url}
                        target="_blank"
                        rel="noopener noreferrer"
                        className="text-[10px] text-blue-500 hover:text-blue-400"
                      >
                        View commit →
                      </a>
                    )}
                  </div>
                ))
              }
            </>
          )}
        </div>

        {/* Right: Build Partner */}
        <div className="w-72 shrink-0 border-l border-border bg-muted/20 flex flex-col p-3 gap-2">
          <div className="flex items-center justify-between">
            <p className="text-[10px] font-semibold uppercase tracking-widest text-muted-foreground/60">Build Partner</p>
            {project.lead_model && (
              <span className="text-[9px] text-muted-foreground/50">{project.lead_model}</span>
            )}
          </div>
          <div className="flex-1 rounded border border-border bg-card overflow-hidden">
            <ProjectChat projectId={project.id} initialMessages={initialChats} />
          </div>
        </div>
      </div>
    </div>
  )
}

// ── Sub-components ────────────────────────────────────────────────────────────

function CodexQCForm({ taskId, projectId }: { taskId: string; projectId: string }) {
  const [diff, setDiff] = useState('')
  const [commitUrl, setCommitUrl] = useState('')
  const [isPending, startTransition] = useTransition()
  const [result, setResult] = useState<{ status: string; notes: string } | null>(null)

  function handleSubmit() {
    startTransition(async () => {
      const res = await runCodexQC(taskId, projectId, diff, commitUrl || undefined)
      if (!res.error) setResult(res as { status: string; notes: string })
    })
  }

  if (result) {
    return (
      <div className={`rounded px-2.5 py-1.5 text-[10px] ${result.status === 'passed' ? 'bg-green-50 text-green-800' : 'bg-red-50 text-red-800'}`}>
        <span className="font-medium">{result.status === 'passed' ? 'Passed' : 'Issues found'}</span>
        {' — '}{result.notes}
      </div>
    )
  }

  return (
    <div className="flex flex-col gap-1.5">
      <textarea
        value={diff}
        onChange={e => setDiff(e.target.value)}
        placeholder="Paste git diff here…"
        className="rounded border border-input text-[10px] p-2 min-h-[60px] resize-none bg-background"
      />
      <input
        value={commitUrl}
        onChange={e => setCommitUrl(e.target.value)}
        placeholder="GitHub commit URL (optional)"
        className="rounded border border-input text-[10px] px-2 py-1 bg-background"
      />
      <button
        disabled={isPending || !diff.trim()}
        onClick={handleSubmit}
        className="rounded bg-slate-800 text-white px-2 py-1 text-[10px] font-medium hover:bg-slate-700 disabled:opacity-50"
      >
        {isPending ? 'Running QC…' : 'Run Codex QC'}
      </button>
    </div>
  )
}

function MissionBrief({
  project, claudeMd, decisionsMd,
}: {
  project: Project
  claudeMd: string
  decisionsMd: string
}) {
  const [isPending, startTransition] = useTransition()
  const [suggestions, setSuggestions] = useState(project.lead_suggestions ?? '')

  function handleRefresh() {
    startTransition(async () => {
      const result = await generateSuggestions(project.id)
      if (result.suggestions) setSuggestions(result.suggestions)
    })
  }

  return (
    <div className="flex flex-col gap-4">
      <p className="text-sm font-semibold">Mission Brief</p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        {[
          { label: 'Stage',  value: project.stage },
          { label: 'Tier',   value: `Tier ${project.tier}` },
          { label: 'Status', value: project.status ?? '—' },
          { label: 'Kill',   value: project.kill_criteria_status ?? '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-md border border-border bg-muted/30 px-3 py-2">
            <p className="text-[10px] text-muted-foreground">{label}</p>
            <p className="text-xs font-medium text-foreground">{value}</p>
          </div>
        ))}
      </div>

      {project.next_action && (
        <div className="rounded-md bg-muted px-3 py-2 text-sm">
          <span className="font-medium text-foreground">Next: </span>
          <span className="text-muted-foreground">{project.next_action}</span>
        </div>
      )}

      {project.blockers && (
        <div className="rounded-md bg-red-50 px-3 py-2 text-sm">
          <span className="font-medium text-red-700">Blocked: </span>
          <span className="text-red-600">{project.blockers}</span>
        </div>
      )}

      {claudeMd && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold">CLAUDE.md</h3>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
            {claudeMd}
          </div>
        </div>
      )}

      {decisionsMd && (
        <div className="flex flex-col gap-1.5">
          <h3 className="text-xs font-semibold">decisions.md</h3>
          <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed max-h-48 overflow-y-auto whitespace-pre-wrap">
            {decisionsMd}
          </div>
        </div>
      )}

      <div className="flex flex-col gap-1.5">
        <div className="flex items-center justify-between">
          <h3 className="text-xs font-semibold">AI Suggestions</h3>
          <button
            disabled={isPending}
            onClick={handleRefresh}
            className="rounded border border-input px-2 py-1 text-[10px] text-muted-foreground hover:text-foreground disabled:opacity-50"
          >
            {isPending ? '…' : 'Refresh'}
          </button>
        </div>
        {suggestions
          ? <div className="rounded-md border border-border bg-muted/40 p-3 text-[11px] text-muted-foreground leading-relaxed whitespace-pre-wrap">{suggestions}</div>
          : <p className="text-[11px] text-muted-foreground/50 italic">{isPending ? 'Generating…' : 'Click Refresh to generate.'}</p>
        }
      </div>
    </div>
  )
}
```

- [ ] **Step 3: Verify TypeScript compiles**

Run: `npx tsc --noEmit`

Expected: 0 errors. Common issues to watch for:
- `project.local_path` may not exist on the `Project` type — check `lib/types.ts` and add if missing
- `project.lead_suggestions` and `project.suggestions_updated_at` — confirm on `Project` type
- `doneTasks` prop not in old `ProjectWorkspaceTabs` Props — already updated in Step 2

- [ ] **Step 4: Test the pipeline flow end-to-end**

With dev server running (`npm run dev`):
1. Navigate to a project workspace — confirm 3-column layout renders
2. Left sidebar shows Dumps / Spec Review / In Flight / Done / Mission Brief / Handoff Log
3. Dumps stage: find a dump without AB verdict → click "Run Advisory Board" → verdict renders inline (takes ~5s)
4. On a "keep" dump → click "Approve → Generate Spec" → stage auto-switches to Spec Review → task card shows spec text
5. Spec Review → click "Open in VS Code →" → VS Code opens (if `project.local_path` is set); stage switches to In Flight
6. In Flight → Codex QC form renders → paste a small diff → "Run Codex QC" → status badge updates

- [ ] **Step 5: Commit**

```bash
git add components/ProjectWorkspaceTabs.tsx "app/(app)/projects/[id]/page.tsx"
git commit -m "feat: project workspace pipeline redesign — 3-column layout, AB flow, spec review, VS Code handoff, Codex QC"
```

---

## Task 7: End-to-End Verification + Deploy

- [ ] **Step 1: TypeScript clean build**

```bash
npx tsc --noEmit
npm run build
```

Expected: 0 type errors, build succeeds.

- [ ] **Step 2: Smoke test full pipeline**

With dev server:
1. Dashboard: pipeline cards show dump/spec/in-flight counts; "Run Pipeline →" active when counts > 0
2. Nav: Dashboard · Inbox · Vault — Orchestrate gone
3. Project workspace: 3-column layout, stage sidebar with live badge counts
4. Dumps: AB runs, verdict renders, "Approve → Generate Spec" triggers spec gen and switches stage
5. Spec Review: spec text visible, "Open in VS Code →" fires vscode:// URI
6. In Flight: Codex QC form visible, submitting diff triggers live GPT-4o call, status updates
7. Done: completed tasks appear in Done stage
8. Mission Brief: CLAUDE.md, decisions.md, AI Suggestions all render; Refresh Suggestions works
9. Handoff Log: agent session records render

- [ ] **Step 3: Push and verify Vercel deploy**

```bash
git push origin main
```

Check Vercel dashboard — confirm deploy succeeds. Navigate to the live URL and verify the pipeline UI renders. Check browser console for errors.

- [ ] **Step 4: Update Mission Control project state**

After deploy succeeds, update the personal-os project record in MC (via the MCP tool or PowerShell) with current status and next_action.

- [ ] **Step 5: Final commit (if any last fixes)**

```bash
git add -A
git commit -m "chore: MC pipeline redesign — verified and deployed"
```
