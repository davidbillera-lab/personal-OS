# Spec: Dashboard → agent bridge ("Send to agent")

Status: DRAFT, 2026-11-06. Gates: Codex attack, then David's approval, then a fresh build window, then CodexQC.
Step 1 of 3 toward running Mission Control from the dashboard (decisions.md 2026-11-06).

## Goal (operator terms)

When a spec on a project page is ready, David picks who works it, clicks **Send to agent**, and the work lands in that agent's queue. The task card then shows what the agent is doing: claimed, in progress, blocked, waiting on approval, done or failed. No other tab or chat window is needed to hand work off.

This step does not make agents start on their own. An agent still has to be running to pick the work up. Making that automatic is step 3 (the execution engine).

## Why: two pipelines that never meet

| | Dashboard pipeline | Agent queue |
|---|---|---|
| Table | `tasks` | `mc_requests` |
| Created by | `generateSpec` in `app/(app)/projects/[id]/actions.ts:57` | MCP tools only: `mc_submit_request` and `mc_start_workflow` in `lib/mcp-tools.ts` (~1223, ~1324) |
| Worked by | Nobody automatically. `approveSpec` (:110) opens VS Code and writes an `agent_handoffs` row | Hermes plans (`mc_submit_plan`); Claude, Codex and the dispatcher claim and execute; the owner acts on `/queue` |
| Status reaches the UI | Task card | `/queue` only |

Nothing in the dashboard ever creates an `mc_requests` row (verified with grep). So work started on the dashboard stops on the dashboard.

## What already exists (reuse, don't rebuild)

- **Hermes planning lane:**
  - A row with `status='submitted', assigned_to='hermes'` is what `mc_submit_plan` accepts (`validatePlanPrecondition`, mcp-tools.ts ~687).
  - When the plan lands, Telegram pings David (mcp-tools.ts ~1577).
  - `mc_start_workflow` creates exactly this shape (~1222).
- **Codex lane:**
  - A row with `assigned_to='codex'` is never dispatcher-claimable (`isDispatcherRow`, `scripts/lib/planned-claim.mjs`).
  - Codex claims it itself.
- **Owner auth and audit:**
  - `requireOwner()` (`lib/owner.ts`).
  - `recordOwnerAudit()` (`lib/owner-requests.ts:168`).
- **Owner request actions:** `/queue` already has close, reopen and reassign. The bridge links there and adds no cancel or reassign of its own.
- **Idempotency:** `mc_requests.client_request_id` has a unique partial index (017).
- **Project page data:** loads open tasks at `app/(app)/projects/[id]/page.tsx:26` and renders them in `components/ProjectWorkspaceTabs.tsx`. The spec-review stage calls `approveSpec` at ~669.

## The work

### Piece 1: migration `030_task_request_link.sql` (David applies it in the SQL editor)

```sql
ALTER TABLE mc_requests
  ADD COLUMN IF NOT EXISTS task_id UUID REFERENCES tasks(id) ON DELETE SET NULL;

-- At most one live request per task. Finished rows don't count, so a task can be re-sent.
CREATE UNIQUE INDEX IF NOT EXISTS mc_requests_live_task_key
  ON mc_requests (task_id)
  WHERE task_id IS NOT NULL AND status NOT IN ('completed','failed','cancelled');
```

The database enforces the one-live-request rule, so a double-click or two open tabs can't create two requests.

### Piece 2: pure builder `lib/task-request.ts` + tests

`buildTaskRequest(task, project, route)` returns the `mc_requests` insert row, or throws if the task has no `generated_spec`.

| Route (UI label) | status | assigned_to | preferred_worker |
|---|---|---|---|
| `hermes_plan`: "Hermes plans first" (**default**) | `submitted` | `hermes` | `hermes` |
| `codex`: "Codex builds" | `queued` | `codex` | `codex` |
| `claude`: "Claude builds" | `queued` | `claude` | `claude` |

Every row also gets these fields:

| Field | Value |
|---|---|
| `title` | `task.title` truncated to 200 characters |
| `project_id` | the task's project |
| `task_id` | the task |
| `source` | `'dashboard'` |
| `created_by` | `'owner'` |
| `priority` | `'normal'` |
| `latest_progress` | for example "Sent from dashboard; waiting for Hermes to plan." |

`request_text` uses this template:

```
[dashboard task <task.id>] <task.title>
Project: <project.name> (<project.repo_url ?? 'no repo on file'>)
Sent from the Mission Control dashboard. The spec below is owner-approved.

SPEC
<task.generated_spec>

When finished, complete this request through the normal worker interface with a result summary and the PR link. The operator runs QC from the dashboard.
```

Tests go in `tests/task-request.test.ts`:
- each route's status, assigned_to and preferred_worker;
- a missing spec throws;
- the title is truncated;
- `task_id` and `project_id` are carried through.

### Piece 3: server action + UI

**`sendTaskToAgent(taskId, projectId, route)`** goes in `app/(app)/projects/[id]/actions.ts`:
1. Calls `requireOwner()` first, then validates `route` against the 3 values.
2. Loads the task and project with `createAdminSupabaseClient()`. It refuses if the task is `done` or `killed`, or has no spec.
3. Inserts the row from `buildTaskRequest`. On unique violation (`23505`), it returns `{ error: 'This task already has a live request.', requestId }` with the existing row's id and creates nothing.
4. Updates the task to `status='in_progress', agent_assigned_to=<worker>` with a guard on its prior status.
   - If this write fails, the request still exists and is linked. The UI reads the request, not the task, so nothing is lost.
   - The action returns a warning.
5. Calls `recordOwnerAudit` with `tool: 'owner_send_task'` and `detail: { task_id, request_id, route }`. A failed action also gets an audit row with `ok:false`.
6. Calls `revalidatePath` on `/projects/<id>` and `/queue`.

**Project page data** (`page.tsx`): one more query loads `mc_requests` selecting `id, task_id, status, phase, assigned_to, latest_progress, blocker, result_summary, artifact_refs, updated_at`, filtered to `task_id in (<the page's task ids>)` and newest first. It keeps the newest row per task.

**UI** (`ProjectWorkspaceTabs.tsx`):
- **Spec-review card:** adds a route selector (default "Hermes plans first") and a **Send to agent** button next to the existing Approve button, which is unchanged.
- **Sending:** while sending, the button is disabled. Any error shows inline.
- **Task card with a linked request:** shows a status chip, a plain-English status line, the worker, the latest progress or blocker, and an "Open in queue" link to `/queue`.

  | Request state | Status line |
  |---|---|
  | `submitted` without a plan | Waiting for Hermes to plan |
  | `submitted` + planned | Plan ready, review it in the queue |
  | `queued` | Waiting for <worker> to pick it up |
  | `claimed` / `in_progress` | <worker> is working |
  | `blocked` | Blocked: <blocker> |
  | `awaiting_approval` | Needs your approval |
  | `completed` | Agent finished, run QC |
  | `failed` / `cancelled` | Failed / cancelled, re-send available |

- **Finished requests:** when the linked request is `completed`, the card shows `result_summary` and the PR link, if one is in `artifact_refs`. **The task is not marked done automatically.** It stays in flight until David runs the existing QC step, which is what moves it to done.

## Decisions made in this spec (David can override)

1. **Status flows one way, read-through.** The task card reads the request live, and nothing copies request state into `tasks`.
   - Gained: two state machines never fight, and there are no triggers or sync jobs.
   - Given up: `tasks.status` alone doesn't tell you what the agent is doing. Use the card.
2. **Default route is Hermes plans first.** It matches the current Codex → Hermes → Claude habit and comes with the plan-ready Telegram ping. The direct Codex and Claude routes have **no ping** in v1, so the agent sees the work at its next session start or on `/queue`. Notifications are step 3.
3. **Re-send is allowed only after the previous request is failed, cancelled or completed.** The database index enforces it. To stop live work, use close on `/queue`.
4. **The Claude route stays, with one precondition.** A `queued` row assigned to Claude can be claimed by the dispatcher. The dispatcher is OFF, and its sandbox can't clone an existing repo (known issue). The rule therefore stands: **the dispatcher is not switched back on until it can clone existing repos.** That was already true; this route doesn't make it worse.

## Acceptance checks

1. `tests/task-request.test.ts` passes. The full vitest suite, tsc (3 known errors only) and `next build` pass. Paste the output.
2. After migration 030 is applied, a read-only query shows the column and the index.
3. Live check on prod, using a throwaway task on a test project:
   1. Send it with the Codex route. The row appears on `/queue` with `source=dashboard`, `assigned_to=codex` and `task_id` set. The task card shows "Waiting for codex to pick it up".
   2. Send again. You get "already has a live request", and no second row is created.
   3. Close the request as cancelled on `/queue`. The card shows cancelled and the Send button comes back.
   4. Re-send with the Hermes route. The row is `submitted`/`hermes`.
   5. Cancel it.
   6. Each send has an `owner_send_task` audit row.
4. A signed-out session, or a non-owner user, gets "Not authorized" from the action.

## Out of scope (steps 2 and 3, each specced separately)

- Approving Hermes plans, starting CodexQC and seeing QC results from the project page instead of `/queue`.
- The dashboard "Codex QC" button calls `gpt-4o` on a pasted diff (`runCodexQC`, actions.ts:136). That is not the real CodexQC (GPT-6.1 Sol). Fix this in step 2.
- Push notifications for the direct routes.
- Automatic execution: the dispatcher, the sandbox clone fix, and Docker.
- Brain dump → spec changes. `approveSpec` and `agent_handoffs` stay as they are.

## Kill check

- Timebox: 1 build session (3 small pieces, no relay needed).
- If it needs more than 1 + 1 sessions, or the scope grows past "create a linked request + show its status", stop and re-scope.

## Rules for the build window

- Branch only. Never push to main or merge. The public repo rule applies: read every new file in full before pushing.
- All data access uses `createAdminSupabaseClient()`. `requireOwner()` is the only session-client use.
- Never import `scripts/dispatcher.mjs` or `mcp-server.mjs` in tests. Run vitest from `/c/Users/...`.
- Credential rule 10 applies. Never print env values or process command lines.
