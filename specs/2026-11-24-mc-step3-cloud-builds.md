# Mission Control step 3: approved plans build themselves on Managed Agents

**Status:** DRAFT r8, 2026-11-27. Approved in outline by David 2026-11-24.
- **CodexQC round 6** (gpt-6.2-sol) returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-28T04-04-00-729Z.md`). All 8 findings were confirmed. Seven are folded in and one is partly accepted:
  - `mc-review-*` is excluded from Vercel deploys, and the containment proof now covers what runs on a bot push and on the draft PR;
  - the summary names the tested commit, and a mismatch with the pinned head blocks;
  - the base sha is saved (`cloud_base_sha`), and the PR is validated on every run (repo, target, head, state);
  - one deadline per invocation, a QC admission check, and no restart of finished steps;
  - a server-side readiness gate (`CLOUD_BUILD_ENABLED` plus all IDs) before the start claim;
  - the ledger sweep runs before the orphan scan, each with its own time budget;
  - the QC repeat-call window is stated and accepted;
  - the cutover waits out the 48-hour orphan window on the old credentials.
  - **Partly accepted:** a durable cursor for the orphan scan is not added. Overflow raises an alert instead (§ Recovery, `minimal:`).
- **CodexQC round 7** (gpt-6.2-sol) returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-28T04-10-49-160Z.md`). All 9 findings and the architecture note were confirmed and folded in:
  - **the PR is opened only after a completed SHIP or FIX-FIRST verdict**, so no PR exists before QC or after RECONSIDER;
  - `vercel.json` on the reviewed commit must be byte-identical to current `main`'s, and the proof has an outside-the-repo fallback for build branches;
  - the ledger has no "primary" flag. The request's `cloud_session_id` is the only election, set by one conditional update, and "not found" needs a complete search;
  - the QC verdict is saved on the request with its repo, base and head, and only that record is reused;
  - the passed path check is saved, so a resumed finish doesn't redo it;
  - reconcile findings go out as their own message;
  - sweeps take least-recently-tried rows first;
  - the cutover enables, smokes, and rolls back on failure;
  - the finishing steps are numbered subsections, not a table;
  - server writes use a dedicated repo-scoped token, `CLOUD_BUILD_REVIEW_TOKEN`, not the general `GITHUB_PAT`.
- **Self-audit, r7** (Claude, after round 6, looking for the next round's findings). Folded in:
  - the server needs a token that can write, which is a piece 0a step (r8: a dedicated one);
  - the server's write helper refuses any ref outside `mc-review-<request id>`;
  - agent text in the PR body and ping is fenced and capped, and the PR body never carries the request text (the repo is public);
  - submodule and symlink entries block; a branch with no common history blocks; the head is read first and the base is computed from that sha;
  - the readiness flag only gates new approvals, never finishing or recovery;
  - a webhook with no matching row is still accepted, and recovery covers it;
  - route time limits are set explicitly, reconcile can't break the alert route, and ledger rows open for 24 hours raise an alert;
  - the webhook URL must not redirect, and the signature check enforces a timestamp window;
  - the proof checks that other builders (Codex, Lovable) can still push;
  - two stale lines from before the review branch are corrected (the "branch moved" test and the sha-gate note).
- **CodexQC round 5** (gpt-6.2-sol) returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-27T20-14-24-750Z.md`). All 8 findings were confirmed and folded in:
  - the PR head is a server-created `mc-review-<id>` branch that the bot can't move, and QC reviews a diff pinned by sha;
  - the protected-file check diffs complete trees, so it has no 300-file cap, catches both sides of a rename, and fails closed on truncation;
  - the outcome is persisted before the ping and replayed, never recomputed;
  - "not found" only becomes terminal after 30 minutes, and a 48-hour orphan scan catches late sessions;
  - a clear 4xx goes through the tail;
  - the marker is versioned;
  - reconcile has per-call timeouts, time reserved per pass, and obligations first;
  - the duplicate index is dropped;
  - the runbook gets a cutover procedure.
- **CodexQC round 4** returned FIX-FIRST (`.codex-qc/codex-qc-2026-11-27T20-10-03-256Z.md`). Both findings were confirmed and folded in:
  - a `cloud_sessions` ledger that owns the end and cost obligations for every session;
  - one shared terminal tail that every outcome goes through, including recovery's "not found" and stall cases.
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

**Gates:** CodexQC round 8 on this spec, merged under the rule in § Review stop rule. Then piece 0a (David), pieces 1–2 in a fresh build window via `phase-relay`, piece 0b (David), then piece 3.
**Step 3 of 3** toward running Mission Control from the dashboard (`decisions.md` 2026-11-06). Steps 1 and 2 shipped in PRs #29, #32 and #33.
**Why this path:** the home-rig spike failed its stop-loss (`specs/2026-11-24-step3-spike-report.md`). David chose Claude Managed Agents over Claude Code routines and GitHub Actions on 2026-11-24 (`decisions.md`). Codex cloud and Claude Code web sessions were ruled out, because neither can be started by a server.

## What

David clicks **Approve plan** on a project card and picks **Claude (cloud)**. From there, nobody opens a window. Anthropic runs the build in its own sandbox. The build pushes an `mc-build-<request id>` branch. Mission Control then checks it, runs the real QC, opens a draft PR only if the review passes, and pings David. David merges or closes the PR, which stays the human gate.

## What already exists (reuse, don't rebuild)

| Capability | Where |
|---|---|
| Approve a plan and pick a builder | `planOwnerApprovePlan()` `lib/owner-requests.ts:163`, `approvePlan()` `app/(app)/projects/[id]/actions.ts:253` |
| The real reviewer (GPT-6.x Sol) | `runCodexQCCore()` `lib/codex-qc.ts:131` |
| PR diff fetch | `fetchGitHubPrDiff()` `lib/github.ts:14`, using `GITHUB_PAT` (already set on Vercel prod) |
| Protected-file check | `alwaysRefused(path)` `scripts/lib/build-patch.mjs:61` |
| No preview deploys of build branches | `vercel.json` `git.deploymentEnabled` `mc-build-*: false`. Piece 1 adds `mc-review-*: false` |
| Scheduled cron with `CRON_SECRET` auth + Telegram ping | `app/api/alerts/stuck-jobs/route.ts`, which runs at 22:00 and 05:59 UTC (`vercel.json`). `queue/dispatch` has the same auth but is **not** scheduled. |
| One QC run per task at a time (lease) | `tasks.codex_qc_run_id` / `codex_qc_run_started_at`, migration 031 |
| Owner audit rows | `recordOwnerAudit()` in the projects actions |
| Anthropic SDK with the beta agents and environments calls | `@anthropic-ai/sdk` 0.95.1, already in `package.json` |

## Design

### The flow

1. **Approve.**
   - `approvePlan` gets a third builder, `claude_cloud`. The row gets `assigned_to: 'claude'`, so the worker check constraints don't change.
   - **Readiness gate, before anything is written.** `cloudBuildReady(env)` must be true: `CLOUD_BUILD_ENABLED=true`, and the key, bot token, review token, agent ID, environment ID, webhook secret and repo allowlist are all present. If not, `approvePlan` refuses `claude_cloud` with "cloud builds aren't set up yet" and writes no start claim, so the request's one attempt isn't spent. The card disables the option on the same check. David sets `CLOUD_BUILD_ENABLED` last, in piece 0b, and unsets it to pause approvals (runbook cutover).
     - The flag gates **new approvals only**. The webhook, finishing, recovery and Retry finish keep running with the flag off, so builds already started still get ended, costed and reported.
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
   - **Write back.** First insert the `cloud_sessions` ledger row. Then write `cloud_session_id` (`where cloud_session_id is null`), `cloud_branch` and `latest_progress` on the request. If either write fails, it's treated as an unclear failure (below), and start recovery finds the session by metadata.
   - **Clear failure.** Only a 400, 401, 403, 404 or 422 counts. Each is a refusal the API returns before creating anything. Set the marker, claim the finishing lease, and run the **terminal tail** with outcome `blocked` and the error. That means it gets a ping like every other outcome.
   - **Unclear failure.** Everything else: a timeout, a connection error, 408/409/429, a 5xx, or a successful create whose write-back then fails. Don't assume no session exists. Leave the row `in_progress` with `cloud_session_id` null and let **start recovery** (§ Finishing) settle it.
   - **Never re-create automatically.** A retry could start a second paid builder. Only start recovery or David may decide a new start is needed.
3. **Build** (inside the Anthropic sandbox). The agent:
   - works in `/workspace/personal-OS`;
   - runs `npm ci` and makes the change;
   - runs the relevant tests;
   - commits, then pushes `mc-build-<id>`;
   - ends with a fixed-format summary covering what changed, the test command and its result, and anything it couldn't do.
   - Git push goes through Anthropic's git proxy, so the token never enters the box.
4. **Report back.** Anthropic POSTs to `/api/cloud-builds/webhook` on `session.status_idled` and `session.status_terminated`. See piece 2.
5. **David decides.** He merges or closes the draft PR. The PR only exists because CodexQC returned SHIP or FIX-FIRST on exactly that commit (§ Finishing, step 7). The PR's head is `mc-review-<id>`, a branch the server creates at the checked commit. The bot can't update it (§ Git containment), so what David merges is exactly what was checked and reviewed.

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

**Public repo.** `personal-OS` is public, so anything the agent commits is public the moment it pushes `mc-build-<id>`, before any check runs. The sandbox holds no secrets, but it does hold the request text and plan. The Approve dialog says so next to the cloud option: "the request and plan may end up in a public branch". Private material goes to a different builder.

Request text and plan are wrapped as untrusted input. The agent's power is bounded by its tools and by GitHub, not by the prompt.

### The summary contract (`parseCloudSummary` in `lib/cloud-build.ts`, pure)

The agent's last message must contain this block:

```
## MC-BUILD-SUMMARY
HEAD_SHA: <full sha of the commit that was tested and pushed>
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
| `HEAD_SHA` missing, not a 40-character sha, or not equal to the pinned branch head (step 4) | `blocked` ("the tested commit is not the pushed commit"). No PR |

The test result is **agent-reported**. Nothing on our side re-runs the tests. `HEAD_SHA` is a consistency check, not independent evidence: it stops a report for commit A being shown beside a review of commit B, for example when another session's push moved the branch before pinning. The PR body and the card label it "Tests (agent-reported): passed", and CodexQC is the independent check. Server-side CI on `mc-build-*` is out of scope.

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
- Our server already talks to GitHub, and one more narrow token is cheaper than a second login flow.
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
4. **What runs agent-written code outside the sandbox: nothing, and the proof checks it.** Inventory, checked 2026-11-27:
   - **GitHub Actions:** the only workflow is `secret-scan.yml`, on `push` and `pull_request`. It runs gitleaks with the default `GITHUB_TOKEN` and executes no repo code. The bot can't add or change a workflow (no `workflow` scope, and `.github/` is a protected path).
   - **Vercel, review branches:** `vercel.json` on `main` excludes `mc-build-*`, and piece 1 adds `mc-review-*`. Step 4 only passes a commit whose `vercel.json` blob is identical to **current** `main`'s, and whose `main` copy contains both exclusions. A branch built on an older `main` from before the exclusion is therefore blocked, not promoted. So every review branch carries the exclusion, whatever commit it was based on.
   - **Open question, settled by the proof:** Vercel reads `vercel.json` from the pushed commit. So the bot could push an `mc-build-*` commit whose `vercel.json` drops the exclusion, and that could build agent code with the Preview environment's variables before any check runs. The proof below tests exactly that. Vercel's docs don't say which commit's config applies, and they document no project setting that the repo can't override (checked 2026-11-27), so this is settled by test, not by reading.
   - **Fallback that doesn't depend on the pushed tree:** if a deployment appears, the Preview environment must hold nothing worth stealing before cloud builds are enabled. David removes every secret from Vercel's Preview environment, or scopes each one to named branches that aren't `mc-*`, and confirms from the variable **names** list that none remains. Preview builds of agent code then run with no credentials.
5. **The server's own writes are narrow, in the credential and in the code.**
   - **Credential:** a dedicated fine-grained token, `CLOUD_BUILD_REVIEW_TOKEN`, owned by David, limited to `personal-OS`, with Contents read/write and Pull requests read/write and nothing else, 90-day expiry. David owns the repo, so a fine-grained token works here (the collaborator limit applies only to the bot). It acts as David, so it bypasses the rulesets; that bypass is what lets it create `mc-review-*`. The general `GITHUB_PAT` is not used for writes.
   - **Upgrade path:** a GitHub App installation identity, added to the ruleset bypass list, when a second repo joins.
   - **Code:** every write goes through a single helper in `lib/github.ts` that:
   - creates only the ref `refs/heads/mc-review-<request id>`, built from the row's uuid and never from agent or webhook input, and refuses anything else;
   - opens only a draft PR from that ref into `main` of the allowlisted repo;
   - never updates or deletes a ref, and never merges.
6. **The `alwaysRefused` check after the push is defense in depth.** It decides whether a PR is opened. It is not the containment.

**Containment proof is a prerequisite** (piece 0a, step 4). Before the first build, David checks each of these with the bot's token from his own shell. Each must be refused by GitHub:
- push to `main`;
- push to a branch named `not-mc-build-x`;
- push to `mc-review-proof`, which David creates first. This proves the bot can't move a review branch, and the merge gate depends on it;
- push a tag;
- push a commit touching `.github/workflows/`;
- delete a branch that isn't `mc-build-*`, for example a throwaway `proof-delete-me` that David creates first.

Two pushes must succeed:
- a push to `mc-build-proof` with the bot's token;
- David's own push of a new non-`mc-build-*` branch, which proves the admin bypass works on a personal-account repo.
- **Other builders still work:** one push each from Codex and from Lovable (whichever are in use on this repo) still succeeds with the rulesets on. If one is refused, add that app to the ruleset bypass list and repeat the whole proof.

**Nothing may deploy or run.** David checks these in the Vercel and GitHub dashboards:
- the `mc-build-proof` push created no Vercel deployment;
- a second bot push to `mc-build-proof`, with a commit that removes the `mc-build-*` line from `vercel.json`, also created no Vercel deployment;
- a branch `mc-review-proof2` that David creates from `main` with one trivial commit, with a draft PR opened from it, created no Vercel deployment, and the only Actions run on it is `secret-scan`.

The bot *can* delete other `mc-build-*` branches. That's accepted, because those are all its own work. If any refusal doesn't happen, or either push fails, stop. Don't start piece 1.

## Scope: pieces 0a and 0b (David) + 3 code pieces, one commit each

Order: 0a → 1 → 2 → (merge, deploy) → 0b → 3.

### Piece 0a: credentials and containment (David, by hand, before piece 1)

Under the credential rule, Claude never creates, reads or pastes these.
1. **Console workspace** `mission-control-builds` with a monthly spend limit (suggest $50). Create an API key in it and set it as `CLOUD_BUILD_ANTHROPIC_API_KEY` on Vercel prod. Use a separate key, not the existing `ANTHROPIC_API_KEY`, so build spend shows up on its own line and can be capped.
2. **Machine account and token.** Create the `mc-builder-bot` account and invite it as a collaborator. Then create the classic token described in § Git containment (`public_repo` only, no `workflow`), with a 90-day expiry. Set the token as `CLOUD_BUILD_GITHUB_TOKEN`.
3. **Rulesets.** Create the two rulesets from § Git containment.
4. **Containment proof.** Run the refusal checks from § Git containment and paste the results, not the token, into the build window. The three "nothing may deploy" checks need `mc-review-*: false` on `main`, so they run in piece 0b, after piece 1's `vercel.json` commit is merged and before `CLOUD_BUILD_ENABLED` is set.
5. **Allowlist:** set `CLOUD_BUILD_REPOS=davidbillera-lab/personal-OS`.
6. **Review token.** Create `CLOUD_BUILD_REVIEW_TOKEN` as described in § Git containment and set it on Vercel prod. The token is never shown to Claude. Proof: with it, David creates and deletes a branch `mc-review-proof3` from his own shell, which shows both the permission and the ruleset bypass. A 403 at build time ends `blocked` with "server token can't create the review branch".

### Piece 0b: registration (David, after pieces 1–2 are merged and deployed)

1. **Setup script:** run `node scripts/setup-cloud-builder.mjs` locally with the workspace key in his own shell. Put the two printed IDs into Vercel env as `CLOUD_BUILD_AGENT_ID` and `CLOUD_BUILD_ENVIRONMENT_ID`.
2. **Webhook.** Console → Manage → Webhooks:
   - URL: `https://<prod domain>/api/cloud-builds/webhook`. Use the exact host that answers without a redirect (an apex-to-www redirect would auto-disable the endpoint), and confirm with the Console's test send before the first build;
   - subscribe to `session.status_idled` and `session.status_terminated`;
   - set the `whsec_` secret (shown once) as `CLOUD_BUILD_WEBHOOK_SECRET`, then redeploy.
   - Subscribe *before* the first run, because events are not backfilled.
3. **Finish the containment proof** (the "nothing may deploy" checks).
4. **Turn it on:** set `CLOUD_BUILD_ENABLED=true` and redeploy. Until this step the card option is disabled and the server refuses cloud approvals.

### Piece 1: start a cloud build

- **Migration `033_cloud_builds.sql`:** add these columns to `mc_requests`:
  - `cloud_start_claimed_at TIMESTAMPTZ`;
  - `cloud_session_id TEXT UNIQUE`;
  - `cloud_branch TEXT`;
  - `cloud_head_sha TEXT`, the commit the protected-file check and QC are bound to;
  - `cloud_base_sha TEXT`, the merge-base with `main` at pinning time. It's written once, in the same update as `cloud_head_sha`, and every later step uses the saved pair;
  - `cloud_finish_requested_at TIMESTAMPTZ`, the durable "finish needed" marker;
  - `cloud_finish_lease_id UUID` and `cloud_finish_lease_at TIMESTAMPTZ`, the finishing claim;
  - `cloud_paths_checked_at TIMESTAMPTZ`, set only when the path check passed for the saved pair;
  - `cloud_qc JSONB`, the saved review: `{repo, base_sha, head_sha, verdict, notes}`. Written once. It is the only record finishing reuses;
  - `cloud_pr_url TEXT`;
  - `cloud_notified_at TIMESTAMPTZ`.
  - `cloud_outcome JSONB`, the decided terminal outcome: `{status, reason, verdict, ping_text}`. It's written once, before the ping, and replayed afterwards (§ terminal tail). `cloud_session_id UNIQUE` already creates its index, so no extra index is needed.
  - **Session ledger table `cloud_sessions`.** Every session we create or discover gets a row here **before** anything else refers to it. Ending a session and recording its cost are obligations on the ledger row, not on the request, so they survive crashes, duplicate sessions and terminal requests.
    - Columns:
      - `session_id TEXT PRIMARY KEY`;
      - `request_id UUID NOT NULL REFERENCES mc_requests`;
      - `session_created_at TIMESTAMPTZ`, Anthropic's creation time, used to pick the oldest;
      - `discovered_at TIMESTAMPTZ DEFAULT now()`;
      - `last_attempt_at TIMESTAMPTZ`, set each time the sweep tries the row;
      - `ended_at TIMESTAMPTZ`, set only once Anthropic confirms the session stopped;
      - `cost_cents INTEGER`;
      - `cost_recorded_at TIMESTAMPTZ`.
    - A partial index on `ended_at IS NULL OR cost_recorded_at IS NULL`.
    - The card shows cost as the sum of `cost_cents` for the request.
    - **There is no "primary" flag.** The one session a request builds from is `mc_requests.cloud_session_id`: a single column, set by a conditional update (`where cloud_session_id is null`), so at most one session can ever win and the election is atomic. Every other ledger row for that request is an extra.
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
- **Card:** add the third builder option, disabled unless `cloudBuildReady`.
- **`vercel.json`:** add `"mc-review-*": false` under `git.deploymentEnabled`. This is its own first commit, merged before the deploy checks in the containment proof.
- **`cloudBuildReady(env)`** (pure) in `lib/cloud-build.ts`, called by `approvePlan` before the start claim and by the card.
- **Tests:**
  - the pure functions (prompt contains the rules, branch, untrusted wrapping; allowlist accepts and refuses);
  - `planOwnerApprovePlan` with `claude_cloud`;
  - `approvePlan` with `claude_cloud` while not ready (flag off, or any one value missing): refused, no start claim written, and the request can still be approved later;
  - `startCloudBuild` with a mocked client: the session gets the budget, resource, metadata and `initial_events`, and a create failure blocks the row.
- **Cloud builds require a linked task.** QC records against `task_id` (migration 031's lease lives on `tasks`), so `approvePlan` refuses `claude_cloud` on a request with no `task_id`.
- **Verify in the SDK source, don't assume:**
  - whether session create takes an idempotency key;
  - how `sessions.list` pages and orders, and whether it filters by metadata;
  - the call that ends a session and how its confirmation reads;
  - where a session's final cost or token usage is read, and the full list of session statuses;
  - the `mc_requests.status` check constraint in prod allows `blocked`, `failed` and `awaiting_approval`.
  - Record the answers in the piece 1 handoff.

### Piece 2: finishing (webhook, recovery, cleanup)

#### The webhook: `app/api/cloud-builds/webhook/route.ts`

1. **Verify the HMAC signature** with `CLOUD_BUILD_WEBHOOK_SECRET`. Use the SDK's helper if 0.95.1 has one, otherwise standard-webhooks verification. Fail closed: no secret, a bad signature, or a timestamp more than 5 minutes off gets a 401.
   - The route exports `maxDuration = 300`, and so does `stuck-jobs`. Neither sets one today.
2. **Persist before acknowledging.** In this order:
   - insert the event `id` into `cloud_build_events`. A conflict means a duplicate; carry on, because the marker below is idempotent;
   - set `cloud_finish_requested_at = now()` on the row. This deliberately isn't a coalesce: every idle signal bumps the marker, so a finisher that saw an older one can't erase it (step 1);
   - the match is on the row whose `cloud_session_id` matches `data.id`. Only rows still `in_progress` are touched.
   - **No matching row** (the session id isn't written back yet, or it's an extra session): still record the event and return 2xx. Finish recovery picks up any `in_progress` row whose session is idle with no marker, and the ledger sweep handles extras.
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

**2. Steps, in order. Each is safe to repeat.**

**Outcome rule.** Steps 1, 2, 4, 5, 6 and 7 never finalize the row or return early on a bad result. Each sets a pending outcome (`blocked` or `failed`, plus a reason). Once an outcome is set, the remaining checks are skipped, but **step 3 (close out), step 8 (outcome and ping) and step 9 (status) always run**. So a build that hit the budget, wrote a bad summary or failed its tests still has its spend logged and still pings David.

Three cases are non-terminal. Finishing releases its lease, keeps the marker and returns, leaving the row `in_progress`:
- the session is still running (step 1; here the marker is cleared, see below);
- the QC lease is held by another run, or there isn't time left to review (step 6);
- the invocation deadline is reached anywhere.

##### Step 1: read the session

- Fetch the session and its events, and read the last `session.status_idle` `stop_reason`.
- `budget_reached` → `blocked` ("hit the $5 cap"). `requires_action` → `blocked`. Terminated with an error → `failed`.
- Still `running`, or any status that isn't idle or terminated → clear the marker **only if it still equals the value read at claim** (`… where cloud_finish_requested_at = <seen>`), release the lease and return. A newer idle signal that arrived meanwhile keeps its marker.
- *Repeatable:* read-only.

##### Step 2: parse the summary

- `parseCloudSummary` → outcomes per the summary contract.
- *Repeatable:* pure.

##### Step 3: close out the sessions

- Run `closeOutSession` (below) on every ledger row for this request.
- If it fails, finishing carries on and the ledger row stays open for the sweep. The ping says "cost pending" when a cost isn't recorded yet.
- *Repeatable:* each obligation is guarded by its own ledger column.

##### Step 4: pin the commit and check every changed path

Skipped entirely when `cloud_paths_checked_at` is set.

1. **Pin.** Read the head sha of `mc-build-<id>`, then compute the merge-base of `main` and **that sha**, and save both as `cloud_head_sha` and `cloud_base_sha` in one write-once update. A re-run uses the saved pair and never recomputes either.
   - No branch → `blocked` ("agent pushed nothing"). No common history with `main` → `blocked`.
   - The summary's `HEAD_SHA` must equal `cloud_head_sha`, otherwise `blocked`.
2. **Complete change set.** Diff two full trees, `git/trees/<base>?recursive=1` against `git/trees/<head>?recursive=1`, by path, blob sha and mode. Don't use the compare API's file list, which stops at 300 files. A rename shows up as a removed path plus an added path, so both sides are checked.
   - Either response has `truncated: true` → `blocked` ("change set too large to verify").
   - Empty set → `blocked` ("agent pushed nothing").
3. **Protected paths.** Run `alwaysRefused` on every path in the set. Any hit → `blocked` with the paths.
   - Any added or changed submodule entry (mode `160000`) or symlink (mode `120000`), or any change to `.gitmodules`, also blocks.
4. **Vercel config matches current `main`.** The `vercel.json` blob sha in the head tree must equal the one in `main`'s tree right now, and `main`'s copy must list both `mc-build-*` and `mc-review-*` as `false`. Otherwise `blocked` ("branch is based on an older main; submit a new request"). This is what makes the exclusion hold for every commit the server promotes (§ Git containment).
5. **Save the pass.** Set `cloud_paths_checked_at = now()`. A block writes no timestamp; it becomes the outcome.

- *Repeatable:* write-once shas, and a saved pass that later runs trust instead of redoing.

##### Step 5: create the review branch

- Create `mc-review-<id>` at `cloud_head_sha` with `CLOUD_BUILD_REVIEW_TOKEN`, through the write helper.
- Already exists at the same sha → adopt it. Exists at any other sha → `blocked`.
- The bot can't create, update or delete `mc-review-*`, so this ref stays at the checked commit.
- This one ref read is deliberate revalidation, repeated on every run. It is the only pre-review call a resumed finish makes besides step 1.
- *Repeatable:* lookup before create; adopt only at the same sha.

##### Step 6: review (no PR exists yet)

- **Reuse.** If `cloud_qc` is set, use it. It is only ever written for this request's saved repo, base and head, so nothing else can satisfy it. A verdict saved on the task by any other path is **not** reused.
- **Admission.** Start the reviewer call only if at least 150 s remain before the invocation deadline (§ Bounded work). Otherwise release the finishing lease, keep the marker and return.
- **Input.** Fetch `compare/<cloud_base_sha>...<cloud_head_sha>` with the diff media type (piece 2 adds this beside `fetchGitHubPrDiff`) and run `runCodexQCCore` on it with `reviewedSha = cloud_head_sha`. A diff GitHub refuses as too large counts as a reviewer error.
- **Results:**
  - QC lease held by another run → non-terminal, as above.
  - Reviewer error, timeout, or no parseable verdict (`parseQcVerdict` returns null) → `blocked` ("QC didn't complete").
  - Completed verdict → save `cloud_qc` `{repo, base_sha, head_sha, verdict, notes}`, write-once. Then `SHIP` or `FIX-FIRST` continues to step 7, and `RECONSIDER` → `blocked`, matching `claude-executor-adapter.mjs:333`.
- **Accepted repeat-call window.** If the process dies after the reviewer answers and before `cloud_qc` is saved, the next run pays for one more review (about $0.05). No provider idempotency is assumed.
- *Repeatable:* the existing QC lease, plus the saved `cloud_qc`.

##### Step 7: open the PR (only with a SHIP or FIX-FIRST verdict saved)

This is the merge gate. **No PR exists before a completed review, after `RECONSIDER`, or after a reviewer failure.** In those cases the review branch stays for inspection and the ping names it.

- Look up the PR with head `mc-review-<id>` (any state). If none exists, open a draft PR from `mc-review-<id>` into `main` and save `cloud_pr_url`.
- **Validate it:** allowlisted repo (not a fork), targets `main`, head ref `mc-review-<id>` at `cloud_head_sha`, open. A closed, merged or retargeted PR, or more than one PR for the head → `blocked`. Nothing is reopened or retargeted automatically.
- **PR body.** The request id and title, the verdict, the agent-reported test line, and the agent's `CHANGED` and `NOTES` text inside a fenced code block capped at 2,000 characters, so no `@mention`, link or markdown from the agent takes effect. It never carries the request text or the plan. The ping uses the same cap for agent-derived text.
- Outcome: `awaiting_approval`, with the verdict on the card and in the ping.
- **`main` moving before merge** is the ordinary PR case and isn't re-reviewed. The review covers what the branch changes, GitHub shows conflicts, and David merges.
- **Human override.** David can always open a PR from a review branch himself, or merge by hand. That is his decision as owner and is outside the automation; the runbook says the card will still read `blocked`.
- *Repeatable:* lookup before create.

##### Step 8: save the outcome, then ping

1. Write `cloud_outcome` (status, reason, verdict, ping text) `where cloud_outcome is null`, guarded by the lease.
2. Send the Telegram ping from the **stored** `ping_text`, only if `cloud_notified_at` is null, then set it.

- *Repeatable:* write-once outcome. `minimal:` a crash between send and mark can send twice, which is acceptable for a ping.

##### Step 9: final status

- Set the status from `cloud_outcome.status` with `result_summary`, and release the lease in the same update. `cloud_finish_lease_at` is kept as the last-tried time.
- A crash here leaves the row `in_progress` with the marker set, so recovery re-runs it.
- *Repeatable:* lease-guarded.

**Replay, never recompute.** Once `cloud_outcome` is set, a re-run of `finishCloudBuild` or the tail skips steps 1–7 and replays steps 8 (no-op if already pinged) and 9 from the stored outcome. A transient error therefore can't ping "blocked" and then later save `awaiting_approval` silently. Re-evaluating a decided outcome is not in v1; David submits a new request.

**The terminal tail (`finalizeCloudRequest(requestId, leaseId, outcome)`).** Steps 3, 8 and 9 are one shared function. **Every** terminal outcome goes through it, whether it comes from finishing, the start-recovery "not found" case, or the stall rule. The caller must hold the finishing lease. Recovery paths take it the same way: set the marker, then claim.

**`closeOutSession(sessionId)`.** Two obligations, each guarded by its own column, so it's safe to repeat:
1. **End.** If `ended_at` is null:
   - call the ending call, unless the session is already terminated;
   - re-fetch it;
   - set `ended_at` only once Anthropic reports it ended.
2. **Cost.** Only once `ended_at` is set (so usage is final) and `cost_recorded_at` is null:
   - read the session's usage and compute the cost;
   - insert the `model_costs` row (`purpose: 'cloud_build'`) with a **fixed id**, a UUIDv5 of the session id, `on conflict (id) do nothing`;
   - set `cost_cents` and `cost_recorded_at`.
   - A crash between the insert and the ledger update re-runs as a no-op insert, then the update. `model_costs.id` is a plain uuid PK (checked 2026-11-25), so no migration is needed.

**Why the sha gate:** the bot can update any `mc-build-*` branch, so in principle a concurrent session could push to this one. After pinning, that no longer matters: the check, the PR and QC all use `cloud_head_sha`, and the PR's head is the review branch. A later push to `mc-build-<id>` is simply ignored. Steps 5 and 7 cover the one remaining case, the review branch itself being moved (only David's identity can), which blocks.

#### Recovery: `reconcileCloudBuilds()`

Webhooks are dropped after 3 failed attempts, and `after()` isn't guaranteed. Recovery has three passes:

1. **Start recovery.** Targets rows that are `in_progress`, have `cloud_start_claimed_at` older than 5 minutes, and have no `cloud_session_id`.
   - **Ledger first.** If the ledger already has rows for this request, adopt the one with the oldest `session_created_at`. No listing is needed.
   - **Otherwise list** sessions tagged `metadata.mc_request_id` = row id, created after the claim. Insert a ledger row for **every** match (`on conflict do nothing`), then adopt the oldest.
   - **Adoption is one conditional update:** `set cloud_session_id = <id> where id = <row> and cloud_session_id is null`. Whichever run gets there first wins, and a later run that found a different session simply loses the update. There is no second flag to disagree with it.
   - Every other ledger row for the request is an extra. The sweep ends and costs it, and its id is listed in `result_summary`.
   - A crash at any point loses nothing. Before adoption the row still qualifies for start recovery and its sessions are on the ledger; after it, the extras are already on the ledger.
   - **Not found** counts only when the search was **complete**: the listing ran through its last page with no error and no timeout in this run. An incomplete search is "unknown", changes nothing, and is retried next run.
     - Complete and under 30 minutes from the claim: leave the row as it is. That outlasts any late create.
     - Complete and over 30 minutes: run the terminal tail with outcome `blocked`. The message is "start didn't happen; no session found after 30 min. The orphan scan keeps watching for 48 h, so the card shows any late spend. Submit a new request to retry".
     - It never says "nothing spent", because that isn't known yet.
   - **Never create.**
0. **Orphan scan (every invocation, after the ledger sweep).** List the sessions created by `CLOUD_BUILD_AGENT_ID` in the last 48 hours. Any session id that isn't in the ledger and carries `metadata.mc_request_id` gets a ledger row. If its request is still `in_progress` with no `cloud_session_id`, start recovery adopts it; otherwise it's an extra and the sweep ends and costs it, whatever state its request is in. This is the one catch-all for a create that landed late or was never written back.
   - Bounded to 5 list pages per invocation. At v1 volume, a handful of sessions a day, that's one page.
   - If 48 hours of sessions doesn't fit in 5 pages or 30 s, the scan reports it (§ Reconcile findings) rather than silently skipping.
   - `minimal:` there is no saved cursor, so an overflowing scan re-reads the same newest pages each run. At v1 volume overflow means something is badly wrong (dozens of sessions a day against a $50 cap), and the alert is the response: David unsets `CLOUD_BUILD_ENABLED` and checks the Console. Upgrade path: a saved `created_at` watermark that the scan resumes from.
   - Piece 1 verifies how `sessions.list` filters (by agent, by date) and pages.
2. **Finish recovery.** Targets rows that are `in_progress` with a session ID and either a stale marker (no lease, or an expired lease) or no marker but a session that is now idle or terminated.
   - Set the marker if it's missing, then call `finishCloudBuild`.
   - **Stall rule:** for a session still `running` 2 hours after the claim, set the marker, claim the lease, and run the terminal tail with outcome `blocked` ("cloud build stalled"). The tail's close-out ends the running session and records its cost, and the ping goes out.
3. **Cleanup (ledger sweep).** Runs `closeOutSession` on every ledger row with `ended_at IS NULL OR cost_recorded_at IS NULL`, where either:
   - its request is no longer `in_progress`; or
   - its request has a `cloud_session_id` and this row isn't it (an extra), so it's ended even while the request is still building.
   - **Fair order.** Rows are taken by `last_attempt_at`, never-tried first, then least recently tried. The sweep stamps `last_attempt_at` before each try, so a row that keeps failing goes to the back and healthy rows behind it still get served.
   - It never archives or deletes. A failure leaves the columns null, so a later pass retries.
   - **No silent permanent failure.** A ledger row still open 24 hours after `discovered_at` is reported with its session id (§ Reconcile findings).
   - This works independently of the request's status, which is what closes the orphaning gap.

**Reconcile findings.** Reconcile runs after the cron's own alert has gone out, so it can't add to that message. Instead it collects its findings (a reconcile error, a missing cloud credential, orphan-scan overflow, ledger rows open 24 hours) and, if there are any, sends **one separate Telegram message** at the end of the run: "Cloud builds: N issues", one line each. No findings, no message. The cron runs twice a day, so a standing problem repeats twice a day until it's fixed; that's intended, and no dedupe state is kept. Retry clicks and webhook runs don't send it.

**Where it runs:**
- **Scheduled:** the existing `stuck-jobs` cron (22:00 and 05:59 UTC) calls it, **after** its alert work, so a backlog can never starve the alerts. The call is wrapped: a reconcile error or missing cloud credential becomes a reconcile finding, and the route still returns its normal response.
- **Bounded work per call:**
  - **One deadline.** Each invocation (cron, webhook `after()`, Retry click) sets a single deadline 280 s after the *route handler* started, so the cron's alert work counts against it. The deadline is passed down to every function.
  - **Every external call is bounded by the time left:** its timeout is the smaller of its cap (20 s for Anthropic and GitHub, 120 s for QC) and the time remaining minus 10 s. Inside reconcile and finishing, Anthropic calls pass `maxRetries: 0`; the retry is the next run. A QC timeout counts as a reviewer error (`blocked`).
  - **Out of time is never an outcome.** If the deadline is reached mid-finish, the run releases its lease, keeps the marker and returns. Only a decided result sets an outcome.
  - **No restarts.** Each finished step leaves a saved result that the next run reads instead of redoing: ledger columns (step 3), the saved pair and `cloud_paths_checked_at` (step 4), `cloud_qc` (step 6), `cloud_pr_url` (step 7), `cloud_outcome` (step 8). A resumed finish makes two reads before the reviewer, the session (step 1) and the review ref (step 5), about 40 s at worst against its 60 s start threshold. It doesn't repeat the tree reads or the path check.
  - **Order and budgets:**
    1. ledger sweep (known obligations), until 50 s into the invocation;
    2. orphan scan, at most 30 s of its own, so it can't eat the sweep's time;
    3. start recovery, until 110 s;
    4. finishes, least recently tried first (`cloud_finish_lease_at`, never-tried first), at most 3. A finish starts only if 60 s remain. Its reviewer call starts only if 150 s remain (120 s of QC plus 30 s for the outcome, ping and status writes); otherwise it stops after step 5 and resumes next run.
  - Start recovery works oldest claim first.
  - Unprocessed rows stay eligible, because selection is by row state, not a queue. A run cut off mid-row leaves a lease that expires in 6 minutes.
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
  - a re-run after a crash at each of steps 3, 5, 6, 7 and 8, with no duplicate cost row, review branch or PR, and no lost cost row or ping;
  - QC crash window, both sides: a crash *after* the verdict is saved → no second reviewer call; a crash *before* it is saved → exactly one repeat call, and still one outcome and one ping;
  - `HEAD_SHA` in the summary differs from the pinned head (another push landed before pinning) → `blocked`, no PR;
  - the PR is closed, merged, retargeted off `main`, from a fork, or at another head sha → `blocked`;
  - a re-run after pinning uses the saved `cloud_base_sha` even though `main` has moved;
  - deadline: with under 150 s left the reviewer isn't called, the lease is released, the row stays `in_progress`, and the next run makes no tree reads and no path check before reaching the reviewer; an out-of-time run never writes `cloud_outcome`;
  - the orphan scan overflowing its pages or its 30 s still lets the ledger sweep finish its known rows, and raises the alert;
  - `mc-build-<id>` moving after pinning changes nothing (the pinned sha is used); `mc-review-<id>` at another sha → `blocked`;
  - a submodule entry, a symlink entry, a `.gitmodules` change, and a branch with no merge-base each → `blocked`;
  - the write helper refuses any ref other than `refs/heads/mc-review-<request id>`;
  - the PR body fences and caps agent text (an `@name` in `NOTES` stays inside the code block) and omits the request text;
  - a webhook for an unknown session id returns 2xx and changes no row; a stale timestamp returns 401;
  - with `CLOUD_BUILD_ENABLED` off, the webhook, finishing and reconcile still run;
  - a reconcile throw doesn't change the `stuck-jobs` response, and a ledger row open for 24 hours appears in the alert;
  - every blocked/failed outcome (budget, bad summary, failed tests, protected file, nothing pushed, QC error, RECONSIDER) still writes the cost row and sends the ping;
  - QC lease held → row stays `in_progress`, marker kept, no ping;
  - `sessions.create` is called with `maxRetries: 0`; a create timeout leaves the row for start recovery; start recovery with two matching sessions adopts the oldest and ends and costs the other;
  - reconcile stops picking up rows past the time cutoff;
  - **merge gate:** no PR is opened when the reviewer errors, times out, returns `RECONSIDER`, or is deferred for time; a PR is opened only after `cloud_qc` holds SHIP or FIX-FIRST;
  - a verdict saved on the task for the same head by another path is not reused; only `cloud_qc` is;
  - `vercel.json` at head differs from current `main` (branch based on an older `main`) → `blocked`, no review branch;
  - fairness: a ledger row that fails every time doesn't stop a later healthy row from being closed out in the same or the next run;
  - reconcile findings are **delivered** as their own Telegram message (asserted on the send, not the log), and nothing is sent when there are none;
  - an already-finished row (no-op).
- **Pinning and completeness:**
  - a protected path that sorts beyond the first 300 changed files is caught;
  - a rename *from* a protected path is caught, and so is a rename *to* one;
  - a mode-only or symlink change on a protected path is caught;
  - `truncated: true` → `blocked`;
  - a bot push to `mc-build-<id>` after QC doesn't change the PR head, which stays `mc-review-<id>` at `cloud_head_sha`;
  - QC reviews the compare diff by sha, not the live PR diff;
  - `mc-review-<id>` already existing at another sha → `blocked`.
- **Durable outcome:** a crash after `cloud_notified_at` is saved but before the status write replays the **same** stored outcome on re-run, with no second ping and no recomputation. A transient QC error that was pinged as `blocked` stays `blocked`.
- **Marker versioning:** the finisher reads `running`, then an idle webhook bumps the marker, then the finisher's clear does nothing and the newer marker survives.
- **Clear 4xx on create** → the terminal tail runs: a ping is sent and the status is `blocked`. A 5xx, 408/409/429 or timeout → the row is left for start recovery.
- **One attempt:** `approvePlan` refuses any builder on a row with `cloud_start_claimed_at` set.
- **Recovery:**
  - start recovery: adopt vs blocked, and never create. "Not found" only becomes terminal after 30 minutes. A session that appears after the first negative lookup, or after the request is already blocked, is picked up by the orphan scan, then ended and costed;
  - start recovery with two matches, crashing after the ledger insert and before adoption, then again after adoption: both sessions end up ended and costed, with no duplicate cost row;
  - two recovery runs that each prefer a different session: exactly one adoption succeeds, and the other session is swept as an extra while the request is still building;
  - a listing that errors or times out on any page is "unknown", never "not found", even past 30 minutes;
  - "not found" and the stall rule both go through the terminal tail: a ping is sent, the status is set, and (for a stall) the session is ended and its cost recorded;
  - finish recovery selection;
  - the ledger sweep: sets `ended_at` only after confirmation, records cost only after `ended_at`, retries when the end call fails, and ends extras while the request is still `in_progress` but never ends the adopted session of a request that is still building.

### Piece 3: show it on the card, then the live runs

- **The card shows:** "Building in the cloud" with the Console session link while `in_progress`, then the PR link, the cost and the QC verdict.
- **Optional:** an Opus toggle on Approve.
- **Runbook:** `docs/runbooks/cloud-builds.md`, written for someone who isn't David. It covers:
  - rotating each credential (bot token, review token, workspace key, webhook secret);
  - overriding a `blocked` build by hand (opening a PR from its review branch), and what that skips;
  - verifying the webhook in the Console;
  - recovering a failed or stuck run (Retry finish, then the Console session viewer);
  - confirming a session ended;
  - re-running the containment proof;
  - handing the bot account and workspace to a new owner, **with a cutover** so nothing is stranded under the old owner:
    1. pause approvals: unset `CLOUD_BUILD_ENABLED` and redeploy, so the server refuses new `claude_cloud` approvals;
    2. drain: wait until no request is `in_progress` and the ledger has no open rows (`ended_at` or `cost_recorded_at` null), then merge or close the open `mc-review-*` PRs;
    3. wait out the orphan window: keep the **old** credentials and agent ID in place for 48 hours after the last cloud approval, so the orphan scan can still catch a late session. Then confirm in the old workspace's Console that no session is running and the ledger is still clean;
    4. switch the credentials and run the setup script against the new workspace;
    5. re-run the containment proof, including the review-token proof (create and delete `mc-review-proof3`) for the new owner's server token;
    6. set `CLOUD_BUILD_ENABLED=true` and make the smoke check the first and only approval. If it doesn't end with a correct draft PR, unset the flag again and fix before anything else is approved;
    7. only then revoke the old credentials, including the old review token.
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
7. **Build branches are public immediately.**
   - Gained: no private mirror or second repo to run.
   - Given up: request and plan text can surface in a public branch before any check. The Approve dialog warns, and nothing secret is in the sandbox.
8. **Branches are not cleaned up automatically.**
   - `minimal:` `mc-build-<id>` and `mc-review-<id>` stay after merge or close. The server never deletes refs. David deletes them in GitHub, or turns on "delete head branches on merge" for the review branch. The runbook lists it.
9. **Beta dependence.**
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
- Every live-run session's ledger row has `ended_at` and `cost_recorded_at` set.
- The runbook exists.

## Review stop rule

This spec has had seven CodexQC rounds, each on a longer document. A reviewer asked to find problems in a design this size will keep finding some, and this PR merges a document, not code. So the merge rule for round 8 onward is fixed in advance:

- **Fix before merge:** a finding that lets unreviewed code run or merge, or lets money be spent without David seeing it.
- **Everything else** goes on a "handle during the build" list at the end of this file, and the builder of the relevant piece closes it with a test.

The real gates come after the merge: the unit tests, the containment proof, the smoke check and the two live runs.

## Stop-loss

If the first 2 live builds don't produce a correct PR with tests actually run, stop and re-scope. Don't debug past 2 attempts. The same rule applies if the build runs past 3 relay sessions.

## Out of scope

- Other repos.
- The agent replying to PR comments.
- Opus by default.
- Scheduled builds (deployments).
- Hermes or Rio starting builds.
- Cleaning up the old dispatcher and rig code (separate request).
