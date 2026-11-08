# Mission Control: dashboard step 2, approve plans and run the real QC from the project page

**Status:** DRAFT, waiting for David's approval. Written 2026-11-08.
**Builds on:** step 1, the dashboard → agent bridge (`specs/2026-11-06-mc-dashboard-agent-bridge.md`, PR #29, merged as `dac5822`).
**MC project:** 698d6376-5819-400b-babc-cd664ee36c04

## What

Step 1 lets David send a task to an agent and watch its status on the task card. Step 2 lets him finish the loop on that card:

1. **See the Hermes plan and approve it.** He picks who builds it, and the work moves to that builder.
2. **Run the real Codex review**, GPT-6.1 Sol with the CodexQC reviewer prompt, on the agent's PR. Nothing has to be pasted.
3. **See the verdict and the report on the card**, then the task moves on as it does today.

The `/queue` page is no longer needed for the normal path. Close and reopen stay on `/queue`.

## Why: what is broken or missing today (with evidence)

1. **Hermes plans can't be seen, and nothing approves them.**
   - `mc_submit_plan` writes the plan to `mc_requests.plan` and sets `phase = 'planned'` (`lib/mcp-tools.ts` ~1540–1595).
   - `/queue` never shows it: the `McRequest` type in `app/(app)/queue/page.tsx` has no `plan` field.
   - The owner actions are close, reopen and reassign only (`app/(app)/queue/actions.ts`). None of them approves a plan.
   - The only way a plan gets built is the dispatcher with `DISPATCHER_CLAIM_PLANNED` turned on, and the dispatcher is OFF.
   - The step 1 card says "Plan ready, review it in the queue", but the queue can't show it.
2. **The dashboard "Codex QC" button is not CodexQC.**
   - `runCodexQC` sends a pasted diff to `gpt-4o` with a 4-point JSON prompt (`app/(app)/projects/[id]/actions.ts:225–262`). `rerunCodexQCOnSpec` does the same at `:264–315`.
   - It doesn't use the kill-criteria reviewer prompt or GPT-6.1 Sol.
3. **A reply the reviewer code can't parse counts as a pass.** Both functions start with `status = 'passed'`. If `JSON.parse` fails, the `catch` stores the raw text and leaves the status at `'passed'`. That marks the task **done** and runs the ship advisory board. A garbled model reply can therefore ship a task.
4. **The QC actions have no owner check.**
   - They are exported from a `'use server'` file without `requireOwner()`.
   - `proxy.ts` only checks that someone is signed in, not that it's the owner.
   - They spend money and change task status.
   - `mc_complete_task` also calls them when an agent completes with a commit URL (`lib/mcp-tools.ts:812–824`, the MCP auto-QC).

## Scope: 4 pieces, one commit each

### Piece 1: the real reviewer, moved to `lib/codex-qc.ts`

The new file is plain library code with no `'use server'`.

- **Prompt.** Port the reviewer system prompt and the report format from `~/.claude/skills/CodexQC/codex-qc.mjs` into the repo:
  - verdict `SHIP ✅ | FIX-FIRST ⚠️ | RECONSIDER ⛔`;
  - Blocking / Should-fix / Nits / Architecture / Solid sections;
  - the four kill criteria.
  - **The repo is public.** Read the ported prompt in full before committing. It must contain no keys, paths or personal data.
- **Model.** Use `gpt-6.1-sol`. If the API says the model isn't available, fall back to `gpt-5.5`. Record the model actually used.
  - Add both models to `PRICING` in `lib/models/pricing.ts`. `gpt-6.1-sol` is $2 in / $10 out per MTok.
  - **Look up the `gpt-5.5` price, don't guess it.** If you can't confirm it, leave it out and flag it, so its cost logs as 0 rather than a wrong number.
- **Diff source.**
  - Add `fetchGitHubPrDiff(prUrl)` to `lib/github.ts`: GitHub `pulls/{n}` with `Accept: application/vnd.github.diff`, using the same `GITHUB_PAT` pattern as `fetchGitHubDiff`.
  - Commit URLs keep using `fetchGitHubDiff`. The pasted-diff path stays for tasks with no linked PR.
- **Size cap.** Refuse a diff over 300,000 characters with a clear message. Never truncate silently.
- **Verdict parsing.** Read the `**Verdict:**` line.
  - `SHIP` → `passed`.
  - `FIX-FIRST` or `RECONSIDER` → `issues_found`.
  - **Anything else → `issues_found`, never `passed`.** This fixes bug 3.
  - Store the full markdown report in `tasks.codex_qc_notes`.
- **Keep today's effects.**
  - `passed` → task `done`, `agent_handoffs` closed when there's a commit URL, and `runProjectShipAdvisoryBoard`.
  - `issues_found` → task `review`.
  - The rerun's loop detection stays: `issues_found` twice in a row → `loop_detected`.
  - See open question 1.
- **Cost.** Log through `routeTask`'s existing `model_costs` path with `purpose: 'codex_qc'` / `'codex_qc_rerun'`. Check that `routeTask` actually passes the chosen OpenAI model through. Today it's only been called with `gpt-4o` for QC.
- **One reviewer.** The MCP auto-QC in `mc_complete_task` calls this core directly. Agent completions then get the real review too, at about $0.06 per run.

### Piece 2: owner-gated QC actions

- In `app/(app)/projects/[id]/actions.ts`, `runCodexQC` and `rerunCodexQCOnSpec` become thin wrappers:
  1. `requireOwner()`;
  2. call the lib core;
  3. record an `owner_run_qc` audit row with `{task_id, model, verdict}`, including on refusal;
  4. never throw (the step 1 pattern).
- `lib/mcp-tools.ts` imports the core from `lib/codex-qc.ts`, not from the actions file. The MCP path is authenticated by its own key.
- After this piece, no unguarded QC function is exported from a `'use server'` file.

### Piece 3: the plan on the card, and Approve

- **Page query** (`app/(app)/projects/[id]/page.tsx`): also select `plan, plan_by`. Add them to `LinkedRequest`.
- **Card.** When the linked request is `submitted` + `phase = 'planned'` + has a plan:
  - show the plan as plain text with line breaks kept, collapsed by default and expandable;
  - show a builder select (Codex builds is the default, Claude builds is the other choice) and an **Approve plan** button;
  - point to `/queue#<id>` for closing.
- **Status line.** Change it to "Plan ready, review it below".
- **Pure planner** `planOwnerApprovePlan(row, builder)` in `lib/owner-requests.ts`, following the shape of `planOwnerReassign`.
  - It refuses unless all of these hold: `status = 'submitted'`, `assigned_to = 'hermes'`, `phase = 'planned'`, plan is not null, and the builder is `codex` or `claude`.
  - Its updates: `status: 'queued'`, `assigned_to: builder`, `preferred_worker: builder`, `phase: null`, `latest_progress: 'Plan approved by owner; waiting for <builder> to pick it up.'`.
  - **The plan is kept.**
- **Action** `approvePlan({id, expectedStatus, expectedUpdatedAt, builder})`:
  - `requireOwner()`;
  - `applyOwnerAction`, the same status + `updated_at` check-and-set the queue actions use;
  - an `owner_approve_plan` audit row with `{task_id, builder, plan_by, plan_submitted_at, plan_length}`;
  - `revalidatePath` on the project page and `/queue`.
- **Don't use `approved_by` / `approved_at`.** Those belong to the push-approval gate (`mc_approve…`, `lib/mcp-tools.ts:573`). Reusing them would blur two different approvals.
- **The builder must be able to read the plan.** `mc_get_request` selects no `plan` today (`lib/mcp-tools.ts` ~1360). Add `plan, plan_by` there. Check which read tool the Codex lane actually uses, and make sure it returns the plan.

### Piece 4: QC on the card

- When the linked request is `completed` and `firstPrUrl(artifact_refs)` finds a PR, show a **Run Codex QC** button. No paste is needed.
  - While it runs, show "Reviewing…" and disable the button.
  - Then show a verdict chip (SHIP / FIX-FIRST / RECONSIDER), the model used, and the report, collapsed by default.
  - **Re-run** is allowed, and goes through `rerunCodexQCOnSpec` so loop detection still works.
- When there's no PR, keep the existing paste-a-diff flow, now on the real reviewer.
- **Timeout.** A review can take 30–90 s.
  - Server actions run under the page route's `maxDuration`, and none is set anywhere in `app/` today.
  - Set one on the project page segment that the Vercel plan allows, and check that it takes effect. Otherwise QC will time out on Vercel while working locally.

**No migration.** `tasks.codex_qc_status` / `codex_qc_notes` and `mc_requests.plan` / `plan_by` already exist.

## Decisions and trade-offs

1. **Approve hands the work to a builder; there's no new "approved" state.**
   - Gained: no migration, and it reuses the queued → claimed path workers already use.
   - Given up: "approved but not started yet" shows only through `latest_progress` and the audit row.
2. **One reviewer for the dashboard and for MCP auto-QC.**
   - Gained: a single source of truth, and the parse-as-pass bug is fixed everywhere at once.
   - Given up: each agent completion with a commit URL now costs about $0.06 instead of the cheaper `gpt-4o` call.
3. **It uses the OpenAI key the server already has.** The current QC (`gpt-4o`) and the vault embeddings already call OpenAI from Vercel, so there's no new credential handling.
   - **The builder must not read, list or print env vars.** Check model access only through one real QC call, and by reading the `model` column of the `model_costs` row it writes.
4. **Reject / ask Hermes to re-plan is out of scope.** Close on `/queue` plus re-send covers it for now.

## Open questions for David

1. **Should a SHIP verdict still mark the task done automatically?** Today it does, and the step 1 spec relies on QC being what moves a task to done.
   - The catch: a SHIP lands before you merge the PR, so "done" can come before the merge.
   - **Recommendation: keep auto-done for this step.** It's the least change, and merge is still your decision. Revisit if done-before-merge causes confusion.
2. **The other actions in `app/(app)/projects/[id]/actions.ts` have no owner check either.** That includes `archiveProject`, `markTaskDone`, `approveSpec`, `generateSpec`, `sendChatMessage` and others. Only the sign-in check in `proxy.ts` guards them.
   - **Recommendation:** a separate one-commit hardening PR before or alongside step 2 that adds `requireOwner()` to every exported action there. Check first whether Supabase sign-ups are disabled, which decides how urgent it is.

## Done when

- `vitest`, `tsc` (only the 3 known `tests/clone-target.test.ts` errors) and `next build` all pass.
- Unit tests cover:
  - `planOwnerApprovePlan`: the happy path, plus each refusal (not planned, wrong assignee, no plan, bad builder);
  - verdict parsing: SHIP, FIX-FIRST, RECONSIDER, and garbage → `issues_found`;
  - `fetchGitHubPrDiff` URL parsing;
  - the `runCodexQC` wrapper refusing a non-owner and auditing it.
  - Each test must fail without its fix. Run vitest from `/c/Users/...`.
- **Live check on prod**, run the step 1 way: a throwaway project and task created by SQL, and a preview deployment.
  1. Send via the Hermes route.
  2. Put a plan on the row. Hermes needs the rig, so if it's down, David writes the plan by SQL.
  3. Approve → Codex builds. The row shows `queued`/codex with the plan kept and an `owner_approve_plan` audit row. `mc_get_request` returns the plan.
  4. Mark the request completed with a real PR URL in `artifact_refs`.
  5. Run Codex QC from the card. The verdict and report show, and `model_costs` records `gpt-6.1-sol` or the fallback.
  6. A non-owner is refused.
  7. **David deletes all test rows by SQL.** Audit rows stay.
- Push the branch and open a PR. **Do not merge.** David runs CodexQC on the PR himself (credential rule 10).

## Out of scope (step 3 or later)

- Telegram pings for the Codex and Claude routes.
- The dispatcher, the sandbox repo-clone fix, and Docker.
- A reject / re-plan flow, and showing plans on `/queue`.
- The deferred step 1 QC item: a latest-request-per-task SQL query plus an index.

**Stop and re-scope** if the build runs past 1+1 sessions, or grows beyond "approve a plan + run the real QC + show it on the card".
