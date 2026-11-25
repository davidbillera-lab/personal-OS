# Mission Control step 3: approved plans build themselves on Managed Agents

**Status:** DRAFT r1, 2026-11-24. Approved in outline by David the same day.
**Gates:** David runs CodexQC on this spec. He then does piece 0 himself. Pieces 1–3 follow in a fresh build window via `phase-relay`, one piece per relay.
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
| Cron with `CRON_SECRET` auth + Telegram ping | `app/api/queue/dispatch/route.ts` |
| Owner audit rows | `recordOwnerAudit()` in the projects actions |
| Anthropic SDK with the beta agents and environments calls | `@anthropic-ai/sdk` 0.95.1, already in `package.json` |

## Design

### The flow

1. **Approve.**
   - `approvePlan` gets a third builder, `claude_cloud`. The row gets `assigned_to: 'claude'`, so the worker check constraints don't change.
   - The action then calls `startCloudBuild(requestId)`.
   - A request counts as a cloud build when `cloud_session_id` is set. No new status is added.
2. **Start.** `startCloudBuild` does the following:
   - **Repo check.** Reads the project's `repo_url` and refuses unless it is in `CLOUD_BUILD_REPOS`. v1 allows `davidbillera-lab/personal-OS` only.
   - **Session create.** Calls `client.beta.sessions.create` with:
     - the stored agent ID and environment ID;
     - a `github_repository` resource (`url`, `authorization_token: CLOUD_BUILD_GITHUB_TOKEN`, `checkout` = default branch);
     - `budget: {type: 'limit', max_list_cost: {amount: '500', currency: 'USD'}}`, a $5 hard cap;
     - `metadata: {mc_request_id}`;
     - `initial_events` holding a single `user.message` with the build prompt. A non-empty `initial_events` creates the session already running.
   - **Write back.** Writes `cloud_session_id`, `cloud_branch`, `status: 'in_progress'` and `latest_progress`.
   - **On failure.** If the create call fails, the row goes to `blocked` with the error. It never sits in `in_progress` with no session.
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
  - Never push to `main`. Push only `mc-build-<id>`.
  - Run the tests that cover the change and report the exact command and result. "Tests not run" counts as a failure to report, not a pass. Spike check 3 failed exactly this way.
  - End with the summary block (fixed headings, parsed by piece 2).

Request text and plan are wrapped as untrusted input. The agent's power is bounded by its tools, not by the prompt.

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

## Scope: piece 0 (David) + 3 code pieces, one commit each

### Piece 0: credentials and registration (David, by hand)

Under the credential rule, Claude never creates, reads or pastes these.
1. **Console workspace** `mission-control-builds` with a monthly spend limit (suggest $50). Create an API key in it and set it as `CLOUD_BUILD_ANTHROPIC_API_KEY` on Vercel prod. Use a separate key, not the existing `ANTHROPIC_API_KEY`, so build spend shows up on its own line and can be capped.
2. **Fine-grained GitHub token:** repo `personal-OS` only, Contents read/write and Metadata read, 90-day expiry. Set it as `CLOUD_BUILD_GITHUB_TOKEN`.
3. **Webhook.** Console → Manage → Webhooks:
   - URL: `https://<prod domain>/api/cloud-builds/webhook`;
   - subscribe to `session.status_idled` and `session.status_terminated`;
   - set the `whsec_` secret (shown once) as `CLOUD_BUILD_WEBHOOK_SECRET`.
   - Subscribe *before* the first run, because events are not backfilled.
4. **Allowlist:** set `CLOUD_BUILD_REPOS=davidbillera-lab/personal-OS`.
5. **Setup script:** run `node scripts/setup-cloud-builder.mjs` locally with the workspace key in his own shell. Put the two printed IDs into Vercel env.

### Piece 1: start a cloud build

- **Migration `033_cloud_builds.sql`:** add to `mc_requests` the columns `cloud_session_id TEXT UNIQUE`, `cloud_branch TEXT`, `cloud_cost_cents INTEGER` and `cloud_pr_url TEXT`.
  - Index `cloud_session_id`.
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
- **Live check:** start one session against a trivial request. Confirm it in the Console session viewer, and confirm the branch lands on GitHub. This answers the `allowed_hosts` question.

### Piece 2: the webhook, the backup check, and handing back

- **`app/api/cloud-builds/webhook/route.ts`:**
  - Verify the HMAC signature with `CLOUD_BUILD_WEBHOOK_SECRET`, using the SDK's webhook verify helper if 0.95.1 has one, otherwise standard-webhooks verification. Fail closed: no secret or a bad signature gets a 401.
  - Dedupe on the event `id`, using the existing alert dedup ledger table from migration 026 if its shape fits, otherwise a small one in 033.
  - Return 2xx fast. Never a 3xx, because a redirect auto-disables the endpoint.
- **`finishCloudBuild(sessionId)`** in `lib/cloud-build.ts`. The webhook and the backup check both call it. It is idempotent by state and acts only on rows that are `in_progress` with that session ID. It:
  1. fetches the session and its events, and reads the last `session.status_idle` `stop_reason`;
     - `budget_reached` → `blocked` ("hit the $5 cap");
     - `requires_action` → `blocked`, which shouldn't happen under `always_allow`;
     - terminated with an error → `failed`;
  2. parses the agent's summary block;
  3. records `usage.list_cost` into `cloud_cost_cents` and logs a `model_costs` row with `purpose: 'cloud_build'`;
  4. lists the branch's changed files via the GitHub compare API (`main...mc-build-<id>`) and runs `alwaysRefused` on each;
     - any hit → `blocked` with the paths, and no PR;
     - no branch or no changes → `blocked` ("agent pushed nothing");
  5. opens a draft PR with `GITHUB_PAT`. The body holds the summary, the session link and the cost;
  6. runs `runCodexQCCore` on the PR diff;
  7. sets `awaiting_approval` with `cloud_pr_url` and `result_summary`, and pings Telegram with the verdict, the PR link and the cost.
- **Ending the session.** When it reaches step 7 or a terminal error, `finishCloudBuild` ends the session through the documented session-ending call, so an idle session stops accruing runtime. That call is to be confirmed in piece 2. It ends the session; it never archives or deletes it.
- **Backup check** in `app/api/queue/dispatch/route.ts`:
  - also select rows that are `in_progress` with a `cloud_session_id` and an `updated_at` older than 10 minutes, and call `finishCloudBuild` when the session is idle or terminated;
  - rows older than 2 hours go to `blocked` ("cloud build stalled").
  - This exists because webhooks are dropped after 3 failed attempts.
- **Tests:**
  - signature verify (good, bad, missing secret);
  - dedupe;
  - `finishCloudBuild` with mocked session and GitHub calls: happy path; budget reached; protected-file hit; nothing pushed; already finished (no-op);
  - backup-check selection.

### Piece 3: show it on the card, then the live runs

- **The card shows:** "Building in the cloud" with the Console session link while `in_progress`, then the PR link, the cost and the QC verdict.
- **Optional:** an Opus toggle on Approve.
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
   - What contains it: a sandbox with no secrets, limited network, a token scoped to one repo, protected `main`, the protected-file check, and David's merge.
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
| GitHub token | Fine-grained token on David's account | Machine user or GitHub App |
| Console workspace | David's org | Transfers with the org |
| Webhook registration | Console UI, by hand | No API exists yet; documented in the runbook |
| Approval and merge | David | Intended: that's the human gate |

## Done when

- Piece 1–2 unit tests pass, alongside the existing suite.
- Both live runs finish with nobody opening a window, a draft PR, QC on it, and the agent's summary showing the tests ran.
- Each run cost under $5, and the cost is recorded.
- A forced protected-file edit (a test request that asks to touch `vercel.json`) ends `blocked` with no PR.

## Stop-loss

If the first 2 live builds don't produce a correct PR with tests actually run, stop and re-scope. Don't debug past 2 attempts. The same rule applies if the build runs past 3 relay sessions.

## Out of scope

- Other repos.
- The agent replying to PR comments.
- Opus by default.
- Scheduled builds (deployments).
- Hermes or Rio starting builds.
- Cleaning up the old dispatcher and rig code (separate request).
