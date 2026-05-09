# Build Orchestration — Phase E Design

**Date:** 2026-05-09  
**Status:** Approved  
**Scope:** `/orchestrate` page — task queue, AI spec generation, tool/model recommendation, prompt handoff

---

## What This Builds

The `/orchestrate` page is the third core surface of Mission Control. Tasks that graduate from the Inbox (via "Promote to task") surface here. The operator reviews the queue, triggers AI spec generation per task, and copies a fully-context-loaded prompt to hand off to Claude Code, Codex, or Manus.

No tasks die in a queue. Every promoted idea becomes a structured, tool-ready spec.

---

## Decisions Made

| Question | Decision | Rationale |
|---|---|---|
| Spec context scope | Project-aware (CLAUDE.md + decisions.md from GitHub) | Matches the OS spec format; real project context without code-scanning complexity |
| Spec output | Markdown stored in DB + client-side copy-as-prompt wrapper | One AI call; no second call; prompt template is deterministic |
| Layout | Tabbed accordion (Pending / Spec Ready / Done) | Consistent with Inbox page; familiar pattern; no new UI concepts |
| Spec generation mechanism | Server action (like inbox/actions.ts) | Simplest path; consistent with existing code; 60s ceiling is sufficient for Sonnet |

---

## Data Layer

### Existing `tasks` table fields used

```typescript
id: string
project_id: string | null
brain_dump_id: string | null
title: string
description: string | null
complexity_tier: 1 | 2 | 3 | 4 | null
recommended_tool: string | null       // 'Claude Code' | 'Codex' | 'Manus' | 'Lovable'
recommended_model: string | null      // e.g. 'claude-sonnet-4-6'
generated_spec: string | null         // markdown from Sonnet
status: 'pending' | 'in_progress' | 'review' | 'done' | 'killed'
created_at: string
updated_at: string
```

> **Migration check required:** Verify `generated_spec`, `recommended_tool`, `recommended_model`, `complexity_tier` columns exist in the live DB before implementation. Add a migration (`004_tasks_orchestration_fields.sql`) if any are missing.

### Tab bucketing logic

| Tab | Filter |
|---|---|
| Pending | `generated_spec IS NULL` AND status not `done`/`killed` |
| Spec Ready | `generated_spec IS NOT NULL` AND status not `done`/`killed` |
| Done | status = `done` OR status = `killed` |

---

## File Layout

```
app/(app)/orchestrate/
  page.tsx          — server component: fetch tasks + projects, render tabbed view
  actions.ts        — generateSpec(), markDone(), archiveTask()

components/
  OrchestrateItem.tsx   — client component: task card with useTransition + spec accordion
```

---

## Spec Generation Flow

`generateSpec(taskId: string)` — server action in `orchestrate/actions.ts`

1. Fetch task row from `tasks` (includes `project_id`, `title`, `description`)
2. Fetch project row from `projects` (includes `repo_url`, `name`)
3. If `repo_url` is set: fetch `CLAUDE.md` and `decisions.md` from GitHub raw content API using `GITHUB_PAT` env var. Handle 404 gracefully (file may not exist).
4. Build system prompt:
   ```
   You are a build orchestration assistant for a portfolio operating system.
   Given a task and project context, produce a structured implementation spec.

   Output a JSON object with these fields:
   - spec: string (markdown — goal, context, acceptance criteria, notes)
   - recommended_tool: string ('Claude Code' | 'Codex' | 'Manus' | 'Lovable')
   - recommended_model: string (model ID)
   - complexity_tier: number (1 | 2 | 3 | 4)
   ```
5. User prompt includes: task title, task description (if any), project name, CLAUDE.md contents, decisions.md contents (each truncated to ~3000 tokens if large)
6. Call `routeTask({ tier: 2, systemPrompt, userPrompt, projectId, taskId })` → Sonnet 4.6
7. Parse JSON response → extract `spec`, `recommended_tool`, `recommended_model`, `complexity_tier`
8. `UPDATE tasks SET generated_spec, recommended_tool, recommended_model, complexity_tier, status = 'in_progress' WHERE id = taskId`
9. Log cost to `model_costs` (handled inside `routeTask`)
10. `revalidatePath('/orchestrate')`

**Error handling:** If AI call fails or JSON parse fails, leave `generated_spec` null and surface an error toast via `useTransition` return value. Task stays in Pending tab; operator can retry.

---

## Copy Prompt Format (client-side, no AI call)

```
# Task: {task.title}
Project: {project_name}

{task.generated_spec}

---
Recommended tool: {task.recommended_tool}
Model: {task.recommended_model} (Tier {task.complexity_tier})
```

Assembled in the `OrchestrateItem` client component, copied to clipboard via `navigator.clipboard.writeText()`.

---

## OrchestrateItem Component

**Props:**
```typescript
{
  task: Task & { project_name: string | null }
  projects: Pick<Project, 'id' | 'name'>[]
}
```

**Card layout:**
```
┌──────────────────────────────────────────────────────────┐
│ [title]                    [tool badge]  [Tier N badge]   │
│ project name · promoted 2h ago                            │
│                                                           │
│  ← PENDING STATE:                                         │
│  [Generate Spec]                                          │
│                                                           │
│  ← SPEC READY STATE:                                      │
│  ┌─ spec content (scrollable, max-h-48) ────────────────┐│
│  │ Goal: ...                                             ││
│  │ Acceptance: ...                                       ││
│  └───────────────────────────────────────────────────────┘│
│  [Copy Prompt]   [Regenerate]   [Mark Done]   [Archive]   │
└──────────────────────────────────────────────────────────┘
```

**Actions:**
- **Generate Spec** → calls `generateSpec(task.id)` in `useTransition`, button shows `…` while pending
- **Regenerate** → same as Generate Spec (overwrites existing spec)
- **Copy Prompt** → assembles prompt string client-side, `navigator.clipboard.writeText()`
- **Mark Done** → calls `markDone(task.id)` → sets `status = 'done'`, revalidates
- **Archive** → calls `archiveTask(task.id)` → sets `status = 'killed'`, revalidates

All buttons disabled during any `isPending` state.

---

## Page Component

`/orchestrate/page.tsx` — server component, reads `?tab` from `searchParams`.

Tab default: `pending`.

Parallel fetches:
1. `tasks` filtered by tab bucket, ordered `created_at DESC`
2. `projects` — `select id, name` — for project name display

Joins project name client-side (same pattern as Inbox page).

Tab UI: same `<Link href="?tab=...">` pattern as Inbox — URL-param-based, soft navigation.

Empty state: "No tasks in this tab yet."

---

## Model Cost Logging

`routeTask()` already logs to `model_costs`. No additional work needed. The `task_id` is passed through so costs are attributable per task.

---

## What's Not in Scope (v1)

- Streaming spec output (spinner is fine for a single-operator tool)
- Code file scanning for context (deferred to v2 — CLAUDE.md + decisions.md is sufficient)
- Editing the spec inline (copy → paste → edit in Claude Code)
- Assigning tasks to other tools/users
- Bulk actions

---

## Verification Steps

1. `npx tsc --noEmit` → zero errors
2. Migration: all four orchestration columns exist on `tasks` in live DB
3. `/orchestrate` loads with Pending/Spec Ready/Done tabs
4. Promote a brain dump from Inbox → task appears in Pending tab
5. Click "Generate Spec" → spinner shows → spec populates → card moves to Spec Ready tab on reload
6. "Copy Prompt" → paste into text editor → confirm format looks correct
7. "Mark Done" → task moves to Done tab
8. "Archive" → task moves to Done tab (killed status)
9. Task with no `project_id` → spec generates without GitHub fetch (graceful fallback)
10. Task with `project_id` but project has no `repo_url` → same graceful fallback
