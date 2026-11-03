# Spec: Mission Control owner controls, v1 (request lifecycle)

**Status:** FINAL DRAFT. Codex attack round 1 (2026-11-03, gpt-6.1-sol, FIX-FIRST) resolved in this revision. Not build-approved.
**Request:** 13df18cf-8d09-4fac-ae35-245131b0685f · **Project:** Mission Control (698d6376-5819-400b-babc-cd664ee36c04)
**Lineage:** original handoff vault 72584a96 → Codex scaffold b4ed2b3c → Hermes full draft (2026-11-02, held in Hermes staging, not persisted) → advisory board vault 5b4d59c9 (MODIFY, unanimous) → this spec (Claude repo attack against `main` @ ee29acc).
**Tier:** 2 (Sonnet build). **Timebox:** 2 build sessions + 1 optional. Missing the timebox means stop and re-estimate.

## Goal (operator terms)

David can close, reopen and reassign Mission Control requests from the Queue page himself, with a reason on every action and an audit row behind it. He never has to depend on whether an agent happens to have the right tool. Nothing he does from the UI can start autonomous execution.

## Evidence that this is worth building

At the time of the repo check, there are 13 non-terminal requests that have not been touched in more than 24 hours. The oldest date back to August: blocked, submitted, queued, claimed and awaiting_approval rows. Of the 8 requests created in the last 30 days, 2 were completed. Three of the stuck rows are `queued` and assigned to `claude` or unassigned (9d2b2a80, ecc57612, 8ae41b9f). The dispatcher would pick those up the day it is switched back on (it has been off since 2026-10-17).

## What already exists (verified against `main` @ ee29acc)

| Capability | Where | Finding |
|---|---|---|
| Request state machine | `lib/mcp-tools.ts` `transitionRequest` (~L640) + handlers ~L1451–1705 | Statuses (017 CHECK): submitted, queued, claimed, in_progress, blocked, awaiting_approval, completed, failed, cancelled. No tool moves `queued`/`submitted` to a terminal status, and nothing writes `cancelled`. That gap is why 8ae41b9f got stranded. |
| **Race in worker writes** | `transitionRequest` | It reads the status, then updates by `id` only, with no `.eq('status', …)`. Two concurrent transitions can both "win". The newer handlers (`mc_assign_request`, `mc_resume_request`, `mc_submit_plan`, `mc_respond_approval`) already use a compare-and-set. |
| Held state | `blocked` + `lib/liaison-workflows.ts` `planRequestResume` | `blocked` is never picked up automatically. `mc_resume_request` (liaison) is the existing, deliberate release path: blocked/failed → queued or submitted. **Reopen reuses this. No new status and no new column.** |
| Dispatcher pickup | `scripts/dispatcher.mjs` ~L184, ~L213; `scripts/lib/planned-claim.mjs` L17 | It auto-claims `queued` rows assigned to null/claude/hermes, and `submitted`+`phase='planned'`+plan rows. Startup reconcile (~L458) re-queues `claimed`+`phase IS NULL` rows assigned to `claude` ("cron orphan"). |
| Dispatcher run marker | `attempt_id` + `phase` (migration 020) | Set only by the dispatcher at claim time. Interactive agent claims (Hermes planning, a Claude Code session) leave both null. |
| Agent scope | `isToolAllowed` L627 | A `full` key may call **any** name `callTool` handles. **Owner logic must not live in `callTool`**, or every full-scope agent would inherit it. |
| Auth | `proxy.ts` | It gates every page, including server-action POSTs, on a valid session (`getUser`). `/api/*` is excluded. **Server actions do no auth or owner check of their own.** `auth.users` has exactly 1 row. Supabase **new-user sign-ups and anonymous sign-ins are disabled** (David confirmed 2026-11-03), so `requireOwner()` is a backstop, not the only barrier. |
| Audit | `mcp_audit_log` (016 + 024) | Columns: actor, tool, ok, error, request_id. It is written best-effort by `app/api/mcp/route.ts`. No before/after detail. |
| Queue UI | `app/(app)/queue/page.tsx` + `components/QueueAutoRefresh.tsx` | A read-only server component. `router.refresh()` every 3 s, which keeps client component state. |
| Project editor | `app/(app)/projects/[id]/edit/actions.ts` `updateProject` | Works, admin client, no owner check, no audit. |
| Tasks | `app/(app)/projects/[id]/actions.ts` `markTaskDone` L282 | The tasks CHECK allows pending, in_progress, review, done, killed. Nothing auto-executes `pending` tasks. |
| Tests | `vitest run` (`tests/*.test.ts`) | Pure-function tests are the house pattern (`liaison-workflows.test.ts`, `planned-claim.test.ts`). Run from `/c/...`, not lowercase `c:` (memory). |

## The work

### Session 1: owner request actions (the whole user-facing v1)

1. **`lib/owner.ts` (new): `requireOwner()`.** It gets identity with `(await createServerSupabaseClient()).auth.getUser()`, used **for identity only, never for data**. It compares `user.id` to `process.env.MC_OWNER_USER_ID`. Fail closed: if the variable is unset, there is no user, or the IDs don't match, it throws. Returns `{ actor: 'owner', userId }`. *This is a documented exception to the project rule against `createServerSupabaseClient` in server actions; see Decisions.* All data access stays on `createAdminSupabaseClient()`.
2. **`lib/owner-requests.ts` (new).** Pure planners on the same pattern as `planRequestResume`, plus one apply function:
   - `planOwnerClose(row, outcome: 'completed'|'cancelled', reason, evidence?)`
     - Allowed from `submitted` (including a ready `phase='planned'` plan, which is not execution), `queued`, `blocked`, `failed`.
     - Allowed from `awaiting_approval`. David is the approver, so closing is his decision. The dialog shows `reviewed_sha`/`workspace_ref` when they are set. This is also the only path for interactive approvals: `attempt_id` is null, and `mc_respond_approval` can never match a null attempt.
     - Allowed from `claimed`/`in_progress` **only when** `attempt_id IS NULL` and `updated_at` is more than 2 h old, i.e. a stale interactive claim. Refused when a dispatcher run is in flight (`attempt_id` set) or the claim is fresh.
     - Sets status = outcome, `result_summary` = `Closed by owner: <reason>` (+ evidence), clears `blocker`/`phase`/`attempt_id`, sets `approval_required` false, and sets `completed_at` = now when completed.
   - `planOwnerReopen(row, reason)`: from `completed`, `cancelled` or `failed` → `blocked`, with `blocker` = `owner-hold: reopened by owner: <reason>`. It also:
     - sets `completed_at`/`attempt_id`/`phase` to null and `approval_required` false
     - clears `plan`/`plan_submitted_at`/`plan_by`, saving the old plan in the audit row's `detail`. Release then starts a new planning cycle instead of stranding the row: with a plan kept but `phase` null, neither `mc_submit_plan` nor the dispatcher can advance it.
     `result_summary` is kept as history. **Never yields `queued`/`submitted`.** Release is the existing `mc_resume_request`.
   - `planOwnerReassign(row, worker ∈ {claude, hermes, codex, null})`: from `submitted`, `queued`, `blocked`; changes `assigned_to` only. **Refused if the resulting row would match either dispatcher claim path** (`queued` + null/claude/hermes, or `submitted` + `planned` + plan + null/claude/hermes). Use the predicates in `scripts/lib/planned-claim.mjs` (`isDispatcherRow`, `isClaimablePlanned`) as the single source of truth. Reassign can therefore never start execution.
   - `applyOwnerAction(supabase, id, expectedStatus, expectedUpdatedAt, updates, audit)` does a compare-and-set UPDATE (`.eq('status', expectedStatus).eq('updated_at', expectedUpdatedAt)`). If 0 rows match, it returns "changed since you loaded it; refresh". It then writes the audit row. Audit is best-effort, the same contract as `route.ts`, and a failure is logged with `console.error`.
   - Input limits: reason 1–1000 chars, evidence 0–2000 chars, valid UUID id.
3. **`supabase/migrations/029_mcp_audit_detail.sql` (new):** `ALTER TABLE mcp_audit_log ADD COLUMN IF NOT EXISTS detail JSONB;`. Owner rows store `{from_status, to_status, from_assigned, to_assigned, reason}`. Additive and nullable, so existing writers are unaffected. Production DB change, so David approves it at build time.
4. **`app/(app)/queue/actions.ts` (new, `'use server'`):** `closeRequest`, `reopenRequest`, `reassignRequest`. Each takes the **client-observed** `expectedStatus` + `expectedUpdatedAt` as inputs, then runs:
   1. requireOwner
   2. fetch the row
   3. **refuse if the status or `updated_at` differs from what the client saw**
   4. plan
   5. apply with those same client values
   6. `revalidatePath('/queue')` Denials are also audited with `ok=false`. Actor is `owner`, tool names are `owner_close_request` / `owner_reopen_request` / `owner_reassign_request`, and `request_id` is set.
5. **`components/queue/OwnerRequestActions.tsx` (new, client)** plus a small edit to `queue/page.tsx` to render it per row with the row's `status`/`updated_at`/`attempt_id`/`phase`/`assigned_to`.
   - It only shows the buttons that are legal for the row.
   - The dialog requires a reason; close also offers an evidence field.
   - It shows who holds a claim and when it was last touched, and says why an action is unavailable (for example, "reassigning would let the rig run this").
   - Keyboard and focus: native `<dialog>` or the existing `components/ui`.
   - **Queue page view:** by default, a "Needs attention" list of **all** non-terminal rows (no 50-row cap), followed by the 50 most recent terminal rows. A failed query renders an explicit error, never "No requests".
6. **`components/QueueAutoRefresh.tsx`:** skip refresh while an owner dialog is open or the tab is hidden, and refresh once after a successful action.
7. **`lib/mcp-tools.ts` `transitionRequest`:** two changes:
   - Add `.eq('status', cur.status)` + `.maybeSingle()` and throw on 0 rows ("Request changed; re-fetch"). This compare-and-set closes the worker race, so a worker write can never overwrite an owner close.
   - Also select `blocker`, and **refuse any transition on a row whose blocker starts with `owner-hold:`**. Without this, an old session's `mc_post_progress` (allowed from `blocked`) would revive held work to `in_progress`. One check in the shared function covers progress, complete, fail and reassign. `mc_resume_request` does not use `transitionRequest`, and stays the only release.
8. **`tests/owner-requests.test.ts` (new):** planner allow/deny tables, covering:
   - a dispatcher-run claim is refused
   - a fresh (<2 h) interactive claim is refused
   - reopen never produces `queued`/`submitted`
   - reassign refuses claimed/in_progress/awaiting_approval/terminal
   - input limits
   - `requireOwner` fails closed when the variable is unset or the ID mismatches (mocked `getUser`)
   - the `transitionRequest` compare-and-set: a 0-row update throws (mocked client, on the pattern of the existing `vi.mock` tests)
   - reassign never yields a row matching either dispatcher predicate (table test over every status × worker)
   - a stale-tab action is refused when the row changed **before** the action started
   - `transitionRequest` refuses `owner-hold:` rows, covering close → reopen → late `mc_post_progress` from the old worker
   - close works for an `awaiting_approval` row with a null attempt

### Session 2: dogfood, cleanup, fixes

1. David sets `MC_OWNER_USER_ID` in Vercel (his auth UUID, not a secret) and approves the 029 migration and the deploy.
2. Close 13df18cf with its real outcome, which is the first real use. Then walk the 13 stranded rows **one at a time, with David deciding each outcome.** No bulk close.
3. Fix whatever Codex QC finds in Session 1.
4. **Resume of a row that still has a plan (found by Codex, a pre-existing bug):** `mc_resume_request` sends a Hermes-workflow row back to `submitted` with `phase` null but keeps its `plan`. The row is then stuck: `mc_submit_plan` refuses existing plans, pickup needs `planned`, and the nudge needs plan null. Owner reopen avoids this by clearing the plan. For existing blocked/failed rows, resume should restore `phase='planned'` when a plan exists, so the reviewed plan is reused (Rio surfaces it, and the dispatcher is off). Add a test.
5. **Approval-bypass fix (only if no caller depends on it):** `mc_complete_request` accepts `awaiting_approval` as a from-state (L1691), so a worker can mark a request done without David's approval. It does not cause a push; the dispatcher's push path needs `in_progress`+`pushing`. Grep every caller (dispatcher, executor adapter, Codex lane) before removing it, and log the change in `decisions.md`.

### Session 3 (optional): owner checks on the existing project actions

`requireOwner()` at the top of `updateProject`, `markTaskDone`, `archiveProject`, plus one audit row each (`owner_update_project`, etc.; detail = names of the changed fields). New `reopenTask` (done → pending) with the same guard. No other new controls, and no kill-criteria override.

## Acceptance checks

- **Build checks:** `npm test`, `npx tsc --noEmit`, `npm run lint` and `npm run build` all pass. Paste the output.
- **Owner check:** with the env var unset, every owner action is refused. A session whose ID doesn't match is refused, and the refusal is audited with `ok=false`.
- **Close:** closing a disposable `queued` test request (completed and cancelled) persists after reload, with the reason in `result_summary` and an audit row with `detail`.
- **Close refusals:** closing a `claimed`/`in_progress` row with `attempt_id` set is refused. Closing one touched under 2 h ago is refused.
- **Reopen:** reopening a completed test request lands in `blocked` with `owner-hold:` and the plan cleared. A unit test confirms neither dispatcher predicate matches it. An old worker's `mc_post_progress` is refused. `mc_resume_request` then releases it.
- **Reassign:** no reassign makes a row dispatcher-eligible.
- **Queue view:** an old blocked request stays visible even when 50+ newer requests exist. A failed query shows an error, not an empty queue.
- **Stale tab:** an action from a tab that loaded an older version is refused with the refresh message.
- **Worker after close:** a worker `mc_post_progress`/`mc_complete_request` against an owner-closed row fails.
- **Polling:** the 3-second refresh never closes an open dialog or clears what's typed in it.
- **Secrets:** no secret is touched. `MC_OWNER_USER_ID` is the only new setting.

## Decisions (David, 2026-11-02)

- Advisory board: MODIFY (vault 5b4d59c9). v1 is request lifecycle only.
- **Killed:**
  - provider merge/redeploy
  - per-action step-up receipts
  - the 50% handling-time pilot
  - the kill-criteria override
  - fencing epochs for interactive claims
- **No 2FA at login.** Owner auth is the existing session plus a server-side owner-UUID check. Accepted risk: a stolen session can close, reopen or reassign requests and edit project status, but cannot merge, deploy or touch credentials.
- **Close only non-active work.** "Active" is defined as a `claimed`/`in_progress` row with a dispatcher run in flight (`attempt_id` set), or any claim touched in the last 2 h. David approved this definition on 2026-11-03. It lets stale interactive claims like 13df18cf be closed, which the board explicitly wanted. After Codex round 1, `phase` no longer counts as active, because `planned` and `review` are waiting states, not execution. Ready plans and `awaiting_approval` rows can be closed by the owner.
- **Held marker:** reopened rows carry `blocker` = `owner-hold: …`. Worker tools refuse to move them, and only `mc_resume_request` releases them. Force-close of active work is out of v1.
- **Identity exception:** `createServerSupabaseClient()` is used in `requireOwner()` for `auth.getUser()` only. The project rule exists because data reads silently fail behind database access rules; identity verification needs the session cookie, and no data goes through this client.
- **Agent parity is not added.** Owner actions are not exposed through MCP. Agents closing their own requests is a separate future decision.

## Out of scope

- GitHub/Vercel merge, redeploy and status panels
- MFA and step-up
- an owner "resume/release" button (use `mc_resume_request`)
- force-close of dispatcher runs
- new MCP tools or scope changes
- vault UI, credentials UI, visual redesign, realtime
- any change to the dispatcher
- bulk close

## Known issues found, not fixed in v1

- **Dispatcher reconcile** (`scripts/dispatcher.mjs` ~L481) re-queues any `claude`-assigned `claimed` row with `phase` null as a "cron orphan". That includes fresh interactive Claude claims, which would then be rebuilt. The dispatcher is off (2026-10-17), so this must be fixed before it is ever switched back on. Owner actions never create this shape: reassign refuses `claimed`.
- **Vault browse leak** (`mc_browse_vault`, `lib/mcp-tools.ts` ~L1001): it lacks the `.eq('is_mcp_accessible', true)` filter that every other vault read applies, so read-scoped keys can list titles, tags and IDs of non-accessible items. This is a separate one-line security fix on its own branch, not part of this spec.

## Kill check

- **Functionality:** fails if, after Session 2, David still needs an agent or SQL to close or reopen a request, or if an owner action ever puts a row in a state the dispatcher picks up.
- **Efficiency:** about 6 new or edited files plus one additive column, reusing the state machine, the held state and the audit table.
- **Scalability/transferability:** the owner is identified by a stable auth UUID, not shared credentials. Adding Vinnie later means adding an allowlist, not a redesign.
- **Time-to-revenue:** none directly. If the timebox is blown or scope drifts past lifecycle, kill it: close requests in the Supabase table editor and leave an audit note.

## Rules

Public repo: no secrets, no live IDs beyond request/vault IDs. Data access uses `createAdminSupabaseClient()` only. Don't import `scripts/dispatcher.mjs` in tests. Its entry-point guard stops `main()` from running, but importing it still runs the env bootstrap and registers signal handlers. Test `scripts/lib/*` instead, and use `node --check` for syntax. One commit per piece, on a feature branch, with a PR and independent CodexQC before merge. Never push to `main`.
