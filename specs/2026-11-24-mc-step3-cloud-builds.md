# Mission Control step 3: approved plans build themselves on Managed Agents

**Status:** DRAFT r4, 2026-11-26. Approved in outline by David 2026-11-24.
- **CodexQC round 3** returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-27T04-51-16-629Z.md`). All 4 findings were confirmed and folded in:
  - `maxRetries: 0` on session create, and recovery when several sessions match;
  - a defined result for every QC outcome;
  - cost and ping on every outcome;
  - bounded, oldest-first reconcile.
- **CodexQC round 2** returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-25T15-49-25-196Z.md`). All 4 findings were confirmed and folded in:
  - one attempt per request;
  - the cost row written with a fixed id;
  - the ping sent before the final status;
  - the protected-file check and QC bound to one sha.
- **r3 also fixes** the bot token: classic, because fine-grained tokens can't write to a personal-account repo.
- **CodexQC round 1** returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-25T05-12-42-970Z.md`). All 4 blockers, both should-fixes and the nit were confirmed and are folded in below.
- **Gap Codex missed:** `queue/dispatch` is not in the `vercel.json` cron list. The only crons are the daily digest and the twice-daily `stuck-jobs`, so a 10-minute backup check doesn't exist. Recovery is redesigned around that (§ Finishing).

**Gates:** David runs CodexQC round 4 on this spec. Then piece 0a (David), pieces 1–2 in a fresh build window via `phase-relay`, piece 0b (David), then piece 3.
**Step 3 of 3** toward running Mission Control from the dashboard (`decisions.md` 2026-11-06). Steps 1 and 2 shipped in PRs #29, #32 and #33.
**Why this path:** the home-rig spike failed its stop-loss (`specs/2026-11-24-step3-spike-report.md`). David chose Claude Managed Agents over Claude Code routines and GitHub Actions on 2026-11-24 (`decisions.md`). Codex cloud and Claude Code web sessions were ruled out, because neither can be started by a server.

## What

David clicks **Approve plan** on a project card and picks **Claude (cloud)**. From there, nobody opens a window. Anthropic runs the build in its own sandbox. The build pushes an `mc-build-<request id>` branch. Mission Control then checks it, opens a draft PR, runs the real QC, and pings David. David merges or closes the PR, which stays the human gate.

## What already exists (reuse, don't rebuild)

| Capability | Where |
|---|---|
| Approve a plan and pick a builder | `planOwnerApprovePlan()` `lib/owner-requests.ts:163`, `approvePlan()` `app/(app)/projects/[id]/actions.ts:253` |
| The real reviewer (GPT-6.1 Sol) | `runCodexQCCore()` `lib/codex-qc.ts:131` |
| PR diff fetch | `fetchGitHubPrDiff()` `lib/github.ts:14`, using `GITHUB_PAT` (already set on Vercel prod) |
| Protected-file check | `alwaysRefused(path)` `scripts/lib/build-patch.mjs:61` |
| No preview deploys of build branches | `vercel.json` `git.deploymentEnabled` `mc-build-*: false` |
| Scheduled cron with `CRON_SECRET` auth + Telegram ping | `app/api/alerts/stuck-jobs/route.ts`, which runs at 22:00 and 05:59 UTC (`vercel.json`). `queue/dispatch` has the same auth but is **not** scheduled. |
| One QC run per task at a time (lease) | `tasks.codex_qc_run_id` / `codex_qc_run_started_at`, migration 031 |
| Owner audit rows | `recordOwnerAudit()` in the projects actions |
| Anthropic SDK with the beta agents and environments calls | `@anthropic-ai/sdk` 0.95.1, already in `package.json` |

## Design

### The flow

1. **Approve.**
   - `approvePlan` gets a third builder, `claude_cloud`. The row gets `assigned_to: 'claude'`, so the worker check constraints don't change.
   - **Start claim.** The same conditional update (it already checks `expectedStatus` + `expectedUpdatedAt`, so a double click loses) also sets `status: 'in_progress'` and `cloud_start_claimed_at: now()`. This intent is saved *before* any call to Anthropic.
   - The action then calls `startCloudBuild(requestId)`.
   - A request counts as a cloud build when `cloud_start_claimed_at` is set. No new status is added.
   - **One attempt per request (v1).** Once `cloud_start_claimed_at` is set, `approvePlan` refuses any further approval of that request, with any builder. The message reads "cloud builds are one attempt per request; submit a new request to retry".
     - This means session, branch, idempotency key, cost, PR, notification and cleanup state never have to be told apart by attempt, because there is only one.
     - It also stops a Codex re-approval from putting a cloud row back into `in_progress`, where finish recovery would pick it up.
     - `minimal:` retrying costs David a new request. The upgrade path is a `cloud_build_attempts` table keyed (request, attempt n), with branch `mc-build-<id>-<n>` and key `mc-start-<id>-<n>`. Build it if retries turn out to be common.
2. **Start.** `startCloudBuild` does the following:
   - **Repo check.** Reads the project's `repo_url` and refuses unless it is in `CLOUD_BUILD_REPOS`. v1 allows `davidbillera-lab/personal-OS` only.
   - **Idempotency.** If the SDK or API accepts an idempotency key on session create, send `mc-start-<request id>`. Piece 1 verifies this in the SDK source; it doesn't assume it.
   - **No SDK retries on create.** The SDK retries connection errors, 408, 409, 429 and 5xx by default. Without server-side idempotency, one `sessions.create()` call could start several paid sessions. So this call passes `maxRetries: 0` as a per-request option, whatever piece 1 finds about idempotency. Every other call keeps the default retries, because reads and session ends are safe to repeat.
   - **Session create.** Calls `client.beta.sessions.create` with:
     - the stored agent ID and environment ID;
     - a `github_repository` resource (`url`, `authorization_token: CLOUD_BUILD_GITHUB_TOKEN`, `checkout` = default branch);
     - `budget: {type: 'limit', max_list_cost: {amount: '500', currency: 'USD'}}`, a $5 hard cap;
     - `metadata: {mc_request_id}`;
     - `initial_events` holding a single `user.message` with the build prompt. A non-empty `initial_events` creates the session already running.
   - **Write back.** Writes `cloud_session_id`, `cloud_branch` and `latest_progress`.
   - **Clear failure.** The API returns a 4xx before any session exists. The row goes to `blocked` with the error.
   - **Unclear failure.** This covers a timeout, a 5xx, or a successful create whose write-back then fails. Don't assume no session exists. Leave the row `in_progress` with `cloud_session_id` null and let **start recovery** (§ Finishing) settle it.
   - **Never re-create automatically.** A retry could start a second paid builder. Only start recovery or David may decide a new start is needed.
3. **Build** (inside the Anthropic sandbox). The agent:
   - works in `/workspace/personal-OS`;
   - runs `npm ci` and makes the change;
   - runs the relevant tests;
   - commits, then pushes `mc-build-<id>`;
   - ends with a fixed-format summary covering what changed, the test command and its result, and anything it couldn't do.
   - Git push goes through Anthropic's git proxy, so the token never enters the box.
4. **Report back.** Anthropic POSTs to `/api/cloud-builds/webhook` on `session.status_idled` and `session.status_terminated`. See piece 2.
5. **David decides.** He merges or closes the draft PR. CodexQC has already run on it.

### The build prompt (`buildCloudPrompt` in `lib/cloud-build.ts`)

It carries:
- the request title and text;
- the approved plan;
- the branch name;
- the rules from the spike that still apply:
  - "Do not modify package.json, lockfiles, CLAUDE.md, AGENTS.md, vercel.json, or anything under .claude/ or .github/. Install deps with `npm ci`, never `npm install`. If the task needs a dependency or config change, stop and say so instead of making it."
  - Never push to `main`. Push only `mc-build-<id>`. GitHub enforces this too (§ Git containment); the prompt is not the control.
  - Run the tests that cover the change and report the exact command and result. "Tests not run" counts as a failure to report, not a pass. Spike check 3 failed exactly this way.
  - End with the summary block below.

Request text and plan are wrapped as untrusted input. The agent's power is bounded by its tools and by GitHub, not by the prompt.

### The summary contract (`parseCloudSummary` in `lib/cloud-build.ts`, pure)

The agent's last message must contain this block:

```
## MC-BUILD-SUMMARY
CHANGED: <one line per file, or "none">
TESTS_COMMAND: <exact command>
TESTS_RESULT: passed | failed | not_run
NOTES: <free text, may be empty>
## END
```

| Parsed result | Outcome |
|---|---|
| Block present, `TESTS_RESULT: passed`, `CHANGED` not `none` | Continue to the protected-file check and the PR |
| `TESTS_RESULT: failed` or `not_run` | `blocked` ("tests failed / not run, per agent"). No PR; the branch is kept for inspection |
| Block missing, malformed, or two blocks | `blocked` ("no valid summary"). No PR |
| `CHANGED: none` | `blocked` ("agent reports no change") |

The test result is **agent-reported**. Nothing on our side re-runs the tests. The PR body and the card label it "Tests (agent-reported): passed", and CodexQC is the independent check. Server-side CI on `mc-build-*` is out of scope.

### Agent and environment (created once, by `scripts/setup-cloud-builder.mjs`)

- **Agent `mc-cloud-builder`:**
  - **Model:** `claude-sonnet-5-5` at effort `medium`, which is Tier 2 per the operator routing rules. A request can override to `claude-opus-5-5` through a session override. That's piece 3 UI, optional.
  - **Tools:** `agent_toolset_20260401` with `default_config.permission_policy: always_allow`. Nobody is watching to answer prompts, so `always_ask` would stall every run. The power is bounded by the sandbox and network instead.
  - **Off:** `web_search` and `web_fetch`.
  - **Not set:** no `mcp_servers` and no `multiagent`.
- **Environment `mc-cloud-build-env`:**
  - `config: {type: 'cloud'}`;
  - `networking: {type: 'limited', allow_package_managers: true, allowed_hosts: []}`.
  - Piece 1 verifies whether git push through the proxy needs `github.com` in `allowed_hosts`. Add it only if the live check proves it's needed.
- **Idempotent.** The script looks the agent and environment up by name before creating them. It prints only the two IDs, which go into Vercel env as `CLOUD_BUILD_AGENT_ID` and `CLOUD_BUILD_ENVIRONMENT_ID`. Changes later go through `agents.update` (new version), never a second create.
- **Deliberately not given:** Mission Control MCP access (queue, vault, credentials), the GitHub MCP, and any secret besides the repo token behind the proxy.

### Why the server opens the PR, not the agent

- Opening a PR from inside the box needs the GitHub MCP with an OAuth credential in a vault. That's an extra login to set up and maintain.
- Our server already holds `GITHUB_PAT`.
- Opening it server-side puts the protected-file check *before* any PR exists, like `build-to-pr.mjs` did on the rig.

### Git containment (enforced by GitHub, not by the prompt)

A fine-grained token can't be limited to some branches. A token on David's account would also act with his admin rights. So the builder pushes as its own identity, and GitHub limits what that identity can do:

1. **Machine account** `mc-builder-bot`, a separate GitHub user owned by David, added as a collaborator on `personal-OS` only (personal-account repos have no role choice; collaborators get push).
   - **Its token: classic, not fine-grained.** `personal-OS` is owned by a personal account, and GitHub doesn't let fine-grained tokens write to a personal-account repo where the token owner is only a collaborator (GitHub docs, "Managing your personal access tokens", limitations; checked 2026-11-25).
     - **Scope:** `public_repo` only. The bot is a collaborator on nothing else, so in practice it reaches one repo. If `personal-OS` goes private, this becomes `repo`, which has the same one-repo reach.
     - **Not granted:** `workflow`. GitHub refuses any push that adds or changes `.github/workflows/*` from a token without it, so the builder can't plant a workflow that runs on its own push.
     - **Upgrade path:** a GitHub App installed on the repo (short-lived installation tokens). That's more setup, so it's deferred until a second repo joins the allowlist.
2. **Branch ruleset** `mc-builder-refs`:
   - target: all branches **except** `mc-build-*`;
   - rules: restrict creations, restrict updates, restrict deletions, block force pushes;
   - bypass list: Repository admin (David).
   - Effect: the bot can create and update only `mc-build-*`, and David's own pushes are unaffected.
   - **`main`:** the existing PR-only protection stays on top of this.
3. **Tag ruleset** `mc-builder-tags`:
   - target: all tags;
   - rules: restrict creations, updates and deletions;
   - bypass list: Repository admin.
4. **What still runs on a bot push:** `secret-scan.yml` (gitleaks, default `GITHUB_TOKEN`, runs no repo code). Vercel skips `mc-build-*`. Nothing else is triggered.
5. **The `alwaysRefused` check after the push is defense in depth.** It decides whether a PR is opened. It is not the containment.

**Containment proof is a prerequisite** (piece 0a, step 4). Before the first build, David checks each of these with the bot's token from his own shell. Each must be refused by GitHub:
- push to `main`;
- push to a branch named `not-mc-build-x`;
- push a tag;
- push a commit touching `.github/workflows/`;
- delete a branch that isn't `mc-build-*`, for example a throwaway `proof-delete-me` that David creates first.

Two pushes must succeed:
- a push to `mc-build-proof` with the bot's token;
- David's own push of a new non-`mc-build-*` branch, which proves the admin bypass works on a personal-account repo.

The bot *can* delete other `mc-build-*` branches. That's accepted, because those are all its own work. If any refusal doesn't happen, or either push fails, stop. Don't start piece 1.

## Scope: pieces 0a and 0b (David) + 3 code pieces, one commit each

Order: 0a → 1 → 2 → (merge, deploy) → 0b → 3.

### Piece 0a: credentials and containment (David, by hand, before piece 1)

Under the credential rule, Claude never creates, reads or pastes these.
1. **Console workspace** `mission-control-builds` with a monthly spend limit (suggest $50). Create an API key in it and set it as `CLOUD_BUILD_ANTHROPIC_API_KEY` on Vercel prod. Use a separate key, not the existing `ANTHROPIC_API_KEY`, so build spend shows up on its own line and can be capped.
2. **Machine account and token.** Create the `mc-builder-bot` account and invite it as a collaborator. Then create the classic token described in § Git containment (`public_repo` only, no `workflow`), with a 90-day expiry. Set the token as `CLOUD_BUILD_GITHUB_TOKEN`.
3. **Rulesets.** Create the two rulesets from § Git containment.
4. **Containment proof.** Run the refusal checks from § Git containment and paste the results, not the token, into the build window.
5. **Allowlist:** set `CLOUD_BUILD_REPOS=davidbillera-lab/personal-OS`.

### Piece 0b: registration (David, after pieces 1–2 are merged and deployed)

1. **Setup script:** run `node scripts/setup-cloud-builder.mjs` locally with the workspace key in his own shell. Put the two printed IDs into Vercel env as `CLOUD_BUILD_AGENT_ID` and `CLOUD_BUILD_ENVIRONMENT_ID`.
2. **Webhook.** Console → Manage → Webhooks:
   - URL: `https://<prod domain>/api/cloud-builds/webhook`;
   - subscribe to `session.status_idled` and `session.status_terminated`;
   - set the `whsec_` secret (shown once) as `CLOUD_BUILD_WEBHOOK_SECRET`, then redeploy.
   - Subscribe *before* the first run, because events are not backfilled.

### Piece 1: start a cloud build

- **Migration `033_cloud_builds.sql`:** add these columns to `mc_requests`:
  - `cloud_start_claimed_at TIMESTAMPTZ`;
  - `cloud_session_id TEXT UNIQUE`;
  - `cloud_branch TEXT`;
  - `cloud_head_sha TEXT`, the commit the protected-file check and QC are bound to;
  - `cloud_finish_requested_at TIMESTAMPTZ`, the durable "finish needed" marker;
  - `cloud_finish_lease_id UUID` and `cloud_finish_lease_at TIMESTAMPTZ`, the finishing claim;
  - `cloud_cost_cents INTEGER`;
  - `cloud_pr_url TEXT`;
  - `cloud_notified_at TIMESTAMPTZ`;
  - `cloud_session_ended_at TIMESTAMPTZ`, set only once Anthropic confirms the session stopped.
  - Index `cloud_session_id`, plus a partial index on rows where `cloud_start_claimed_at IS NOT NULL AND cloud_session_ended_at IS NULL`.
  - Add a `cloud_build_events` table (`event_id TEXT PRIMARY KEY`, `session_id`, `received_at`) for webhook dedupe, unless migration 026's ledger fits exactly.
  - Check prod `information_schema` before and after. Prod has drifted before (memory: mc-prod-schema-drift).
- **`scripts/setup-cloud-builder.mjs`:** as described above.
- **`lib/cloud-build.ts`:**
  - `buildCloudPrompt(row)` (pure);
  - `cloudBranchFor(id)` (pure, `mc-build-<id>`);
  - `repoAllowed(repoUrl, env)` (pure, reuses `repoSlug` from `scripts/lib/clone-target.mjs`);
  - `startCloudBuild(requestId)`.
  - It constructs the client with `CLOUD_BUILD_ANTHROPIC_API_KEY` explicitly, not the default env key.
- **`planOwnerApprovePlan`:** accept `claude_cloud`, mapping to `assigned_to: 'claude'`.
- **`approvePlan`:** after the update succeeds, call `startCloudBuild`. Add a `cloud` field to the audit row.
- **Card:** add the third builder option.
- **Tests:**
  - the pure functions (prompt contains the rules, branch, untrusted wrapping; allowlist accepts and refuses);
  - `planOwnerApprovePlan` with `claude_cloud`;
  - `startCloudBuild` with a mocked client: the session gets the budget, resource, metadata and `initial_events`, and a create failure blocks the row.
- **Cloud builds require a linked task.** QC records against `task_id` (migration 031's lease lives on `tasks`), so `approvePlan` refuses `claude_cloud` on a request with no `task_id`.
- **Verify in the SDK source, don't assume:**
  - whether session create takes an idempotency key;
  - how `sessions.list` pages and orders, and whether it filters by metadata;
  - the call that ends a session and how its confirmation reads.
  - Record the answers in the piece 1 handoff.

### Piece 2: finishing (webhook, recovery, cleanup)

#### The webhook: `app/api/cloud-builds/webhook/route.ts`

1. **Verify the HMAC signature** with `CLOUD_BUILD_WEBHOOK_SECRET`. Use the SDK's helper if 0.95.1 has one, otherwise standard-webhooks verification. Fail closed: no secret or a bad signature gets a 401.
2. **Persist before acknowledging.** In this order:
   - insert the event `id` into `cloud_build_events`. A conflict means a duplicate; carry on, because the marker below is idempotent;
   - set `cloud_finish_requested_at = coalesce(cloud_finish_requested_at, now())` on the row whose `cloud_session_id` matches `data.id`. Only rows still `in_progress` are touched.
   - Only after both writes succeed, return 2xx. If either fails, return 500 so Anthropic retries. Never return a 3xx, because a redirect auto-disables the endpoint.
3. **Process after responding.** Call `finishCloudBuild(requestId)` from Next's `after()`. That's best-effort; the saved marker is what makes it durable. If the function dies mid-way, recovery picks the row up.

#### `finishCloudBuild(requestId)` in `lib/cloud-build.ts`

**1. Claim.** One conditional update:
- **sets** `cloud_finish_lease_id = <new uuid>` and `cloud_finish_lease_at = now()`;
- **only on a row that is:**
  - `status = 'in_progress'`;
  - `cloud_finish_requested_at IS NOT NULL`;
  - holding no lease, or a lease older than 6 minutes (longer than the 300 s function limit, same reasoning as migration 031).
- **No row returned:** someone else holds the claim, or the row is already finished. Return.
- **Every later write** filters on `cloud_finish_lease_id = <mine>`, so a stale run can't overwrite a newer one.

**2. Steps, each safe to repeat.**

**Outcome rule:** steps a, b, d, e and f never finalize the row or return early on a bad result. Each one sets a pending outcome (`blocked`/`failed` plus a reason). Once an outcome is set, the remaining checks in d–f are skipped, but **c (cost), g (ping) and h (status) always run** for every outcome. So a build that hit the budget, wrote a bad summary or failed its tests still has its spend logged and still pings David.

There are two exceptions, and both are non-terminal:
- a session that is still `running` (step a);
- a held QC lease (step f).

In those cases finishing releases its lease and returns, leaving the row `in_progress` to be picked up later.

| # | Step | Safe to repeat because |
|---|---|---|
| a | Fetch the session and its events, and read the last `session.status_idle` `stop_reason`. `budget_reached` → `blocked` ("hit the $5 cap"). `requires_action` → `blocked`. Still `running` → clear the marker and return; a later idle event re-sets it. Terminated with an error → `failed` | Read-only |
| b | `parseCloudSummary` → outcomes per the summary contract | Pure |
| c | Record cost. Insert the `model_costs` row (`purpose: 'cloud_build'`) with a **fixed id**: a UUIDv5 of the session id, `on conflict (id) do nothing`. Then set `cloud_cost_cents` for display. The two writes don't depend on each other, so a crash between them loses nothing; the re-run repeats both | Fixed primary key (`model_costs.id` is a plain uuid PK, checked 2026-11-25; no migration needed) |
| d | GitHub compare `main...mc-build-<id>`. Save the branch's head sha as `cloud_head_sha` (first run only; a re-run compares against the saved sha). Run `alwaysRefused` on each changed path **at that sha**. Any hit → `blocked` with the paths. No branch or no diff → `blocked` ("agent pushed nothing") | Read-only plus a write-once sha |
| e | PR: if `cloud_pr_url` is set, skip. Otherwise first look up an existing PR with head `mc-build-<id>` (any state) and adopt it. Only if none exists, open a draft PR with `GITHUB_PAT`. Save `cloud_pr_url` | Lookup before create |
| f | QC. **Sha gate:** the PR head must equal `cloud_head_sha`, otherwise `blocked` ("branch changed after the protected-file check"). Run `runCodexQCCore` with `reviewedSha = cloud_head_sha`. Re-check the PR head after QC returns; a change means the same `blocked`. Skip if the task already has a verdict for that sha.

**Results:**
- **Lease held by another run:** non-terminal. Release the finishing lease, keep the marker and return; recovery or the next call retries.
- **Reviewer error, or no parseable verdict** (`parseQcVerdict` returns null): `blocked` ("QC didn't complete; PR is open, run CodexQC by hand").
- **Completed verdict:**
  - `SHIP` or `FIX-FIRST` → `awaiting_approval` with the verdict on the card and in the ping;
  - `RECONSIDER` → `blocked`, matching the existing rule in `claude-executor-adapter.mjs:333`.

A row reaches `awaiting_approval` only with a saved, completed verdict for `cloud_head_sha` | Existing QC lease plus a sha check |
| g | Telegram ping only if `cloud_notified_at` is null, then set it. The outcome is already decided by this point, so the ping can go out before the status write | `minimal:` a crash between send and mark can send twice; acceptable for a ping |
| h | Final status `awaiting_approval` (or the blocked/failed status from earlier) with `result_summary`. Clear the lease in the same update. Because the ping goes first, a crash here leaves the row `in_progress` with the marker set, recovery re-runs it, and the ping isn't lost | Lease-guarded |

**Why the sha gate:** the bot can update any `mc-build-*` branch, so in principle a concurrent session could push to this one. The gate ties the protected-file check, the PR and QC to the same commit. Anything that moves the branch mid-finish blocks the build instead of publishing a review of code nobody checked.

#### Recovery: `reconcileCloudBuilds()`

Webhooks are dropped after 3 failed attempts, and `after()` isn't guaranteed. Recovery has three passes:

1. **Start recovery.** Targets rows that are `in_progress`, have `cloud_start_claimed_at` older than 5 minutes, and have no `cloud_session_id`.
   - Look for a session tagged `metadata.mc_request_id` = row id, created after the claim.
   - **Found one:** adopt it.
   - **Found several** (shouldn't happen with retries off, but handled anyway): adopt the oldest. End the others straight away with the ending call and list their ids in `result_summary`. The cleanup pass doesn't see them, because only the adopted id is on the row, so their cost is recorded here with the same fixed-id insert (UUIDv5 of each session id).
   - **Not found:** `blocked` ("start didn't happen; submit a new request to retry").
   - **Never create.**
2. **Finish recovery.** Targets rows that are `in_progress` with a session ID and either a stale marker (no lease, or an expired lease) or no marker but a session that is now idle or terminated.
   - Set the marker if it's missing, then call `finishCloudBuild`.
   - **Stall rule:** a session still `running` 2 hours after the claim goes to `blocked` ("cloud build stalled").
3. **Cleanup.** Targets every row with a `cloud_session_id`, `cloud_session_ended_at IS NULL`, and a status other than `in_progress`.
   - End the session with the documented ending call. It never archives or deletes.
   - Re-fetch it, and set `cloud_session_ended_at` only once Anthropic reports it ended.
   - A failure leaves the column null, so the next pass retries.

**Where it runs:**
- **Scheduled:** the existing `stuck-jobs` cron (22:00 and 05:59 UTC) calls it, **after** its alert work, so a backlog can never starve the alerts.
- **Bounded work per call:**
  - each pass works oldest first (`cloud_finish_requested_at`, then `cloud_start_claimed_at`);
  - at most 3 finishes per invocation, because QC is the slow step;
  - stop picking up new rows once 200 s have passed since the invocation started, leaving room inside the 300 s limit.
  - Unprocessed rows stay eligible, because selection is by row state, not a queue. A run cut off mid-row leaves a lease that expires in 6 minutes.
  - Cleanup and start recovery are cheap (one or two API calls per row) and get the time left over.
  - `minimal:` at 3 finishes per cron run, twice a day, a backlog of more than 6 finished builds takes more than a day to clear without Retry clicks. That's fine at v1 volume; the `pg_cron` upgrade below fixes it.
- **On demand:** a **Retry finish** owner action on the card, behind the same owner check as the others.
- `minimal:` with a healthy webhook a build finishes within seconds. If the webhook fails, recovery can take up to ~16 hours unless David clicks Retry. The upgrade path is Supabase `pg_cron` + `pg_net` hitting a `CRON_SECRET`-gated reconcile route every 10 minutes. That needs a secret stored in Supabase Vault, so it's David's step.

#### Tests

- **Webhook signature:** good, bad and missing secret.
- **Webhook writes:** a duplicate event id still sets the marker. A failed marker write returns 500.
- **Claim:** two concurrent `finishCloudBuild` calls; exactly one proceeds.
- **Finishing cases:**
  - happy path;
  - budget reached;
  - protected-file hit;
  - nothing pushed;
  - each summary-contract outcome;
  - a re-run after a crash at each of steps c, e, f and g, with no duplicate cost row, PR or QC, and no lost cost row or ping;
  - the branch head moving between d and f, and during QC → `blocked`;
  - every blocked/failed outcome (budget, bad summary, failed tests, protected file, nothing pushed, QC error, RECONSIDER) still writes the cost row and sends the ping;
  - QC lease held → row stays `in_progress`, marker kept, no ping;
  - `sessions.create` is called with `maxRetries: 0`; a create timeout leaves the row for start recovery; start recovery with two matching sessions adopts the oldest and ends and costs the other;
  - reconcile stops picking up rows past the time cutoff and processes oldest first.
  - an already-finished row (no-op).
- **One attempt:** `approvePlan` refuses any builder on a row with `cloud_start_claimed_at` set.
- **Recovery:**
  - start recovery: adopt vs blocked, and never create;
  - finish recovery selection;
  - the stall rule;
  - cleanup sets `cloud_session_ended_at` only after confirmation, and retries when the end call fails.

### Piece 3: show it on the card, then the live runs

- **The card shows:** "Building in the cloud" with the Console session link while `in_progress`, then the PR link, the cost and the QC verdict.
- **Optional:** an Opus toggle on Approve.
- **Runbook:** `docs/runbooks/cloud-builds.md`, written for someone who isn't David. It covers:
  - rotating each credential (bot token, workspace key, webhook secret);
  - verifying the webhook in the Console;
  - recovering a failed or stuck run (Retry finish, then the Console session viewer);
  - confirming a session ended;
  - re-running the containment proof;
  - handing the bot account and workspace to a new owner.
- **Smoke check first:** before live run 1, a trivial request that changes one line. It settles the `allowed_hosts` question and proves webhook → PR end to end.
- **Live run 1:** a real small request on personal-OS (for example the flaky `trusted-git` temp-dir test, already on the next-action list). End to end: no window opened, draft PR, QC ran, tests actually ran.
- **Live run 2:** a second, different request.
- **Report:** `specs/2026-11-2x-step3-cloud-report.md`, covering the two runs (time, cost, QC, correctness) and a founder-dependence update.

## Decisions and trade-offs

1. **Builder model is Sonnet 5.5, not Opus.**
   - Gained: cost discipline, about $0.50–$2 per build.
   - Given up: some quality on hard builds. The Opus override covers those.
2. **`always_allow` permissions.**
   - Gained: unattended runs never stall.
   - Given up: per-call approval.
   - What contains it: a sandbox with no secrets, limited network, a bot identity that GitHub rulesets confine to `mc-build-*` with no workflow-write, the protected-file check before any PR, and David's merge.
3. **The server opens the PR.**
   - Gained: the check runs before the PR exists, and no GitHub MCP login.
   - Given up: the agent can't iterate on PR review comments. That's v2.
4. **No Mission Control access for the agent.**
   - Gained: an injected prompt can't reach the queue, vault or credentials.
   - Given up: the agent can't post its own progress, so the card shows only the session link.
5. **One repo in v1.**
   - Gained: a small blast radius while it proves itself.
   - Given up: other portfolio repos wait for a new token plus an allowlist edit.
6. **Separate Console workspace and key.**
   - Gained: build spend is visible and hard-capped.
   - Given up: one more credential to rotate.
7. **Beta dependence.**
   - Given up: stability guarantees. Mitigated by keeping all Managed Agents calls in `lib/cloud-build.ts`, so a swap touches one file.

## Founder-dependence (for the exit story)

| Item | v1 | Fix later |
|---|---|---|
| GitHub identity | `mc-builder-bot` machine account owned by David, 90-day token | Transfer the account; or move to a GitHub App |
| Console workspace | David's org | Transfers with the org |
| Webhook registration | Console UI, by hand | No API exists yet; documented in the runbook |
| Approval and merge | David | Intended: that's the human gate |

## Done when

- Piece 1–2 unit tests pass, alongside the existing suite.
- Both live runs finish with nobody opening a window, a draft PR, QC on it, and the agent's summary showing the tests ran.
- Each run cost under $5, and the cost is recorded.
- A forced protected-file edit (a test request that asks to touch `vercel.json`) ends `blocked` with no PR.
- The containment proof (piece 0a) passed, and is re-run after the live runs.
- Every live-run session has `cloud_session_ended_at` set.
- The runbook exists.

## Stop-loss

If the first 2 live builds don't produce a correct PR with tests actually run, stop and re-scope. Don't debug past 2 attempts. The same rule applies if the build runs past 3 relay sessions.

## Out of scope

- Other repos.
- The agent replying to PR comments.
- Opus by default.
- Scheduled builds (deployments).
- Hermes or Rio starting builds.
- Cleaning up the old dispatcher and rig code (separate request).
