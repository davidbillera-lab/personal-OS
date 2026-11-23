# Spike: one sandbox build against a real repo, landed as a draft PR

**Status:** DRAFT, 2026-11-22. Gates: Codex attack (David runs it), then David's approval, then a fresh build window for piece 1, then CodexQC on that PR (David runs it), then the rig run.
**Step 3 of 3** toward running Mission Control from the dashboard (`decisions.md` 2026-11-06). Steps 1 and 2 shipped in PRs #29, #32 and #33.
**Why a spike and not the full step 3 spec:** step 3 rests on one unproven claim, that the rig's sandbox can build against an existing repo and hand back a reviewable PR. If that claim fails, the step 3 design changes. One run settles it before any multi-piece build gets specced.

## The question this answers

Can one Mission Control request do all of this with no one opening a Claude Code window? Wake the rig, clone a real repo into the C6 sandbox, make a correct change that needs the existing code, pass CodexQC, open a draft PR on the real repo, then put the rig back to sleep.

David still approves at two points, as today: he wakes the rig, and he decides on the PR. "Hands-off" means nobody opens a window to do the build.

## What already exists (reuse, don't rebuild)

| Capability | Where | State |
|---|---|---|
| Clone a real repo into the box | `provisionWorkspace()` in `scripts/lib/claude-executor-adapter.mjs:83`, gated by `resolveCloneTarget()` in `scripts/lib/clone-target.mjs` | Built 2026-08-11. **Off by default**: `DISPATCHER_CLONEABLE_REPOS` is unset in `ecosystem.config.cjs:71`. |
| Shallow clone, credential-file scrub, history discarded | same function, lines 87-114 | Built and tested (`tests/clone-target.test.ts`). |
| Claim a Hermes-style planned row | `isClaimablePlanned()` in `scripts/lib/planned-claim.mjs` (`submitted` + `planned` + plan not null) | Live since 2026-08-06. |
| Host-side CodexQC on the build commit, plus the approval ping | `scripts/dispatcher.mjs` | Proven end to end 2026-08-01. |
| Wake on demand, sleep after 15 idle minutes | `scripts/lib/rig-wake.mjs`, `scripts/lib/idle-sleep.mjs`, `docs/runbooks/on-demand-relay.md` | Built. Not run since the dispatcher was switched off on 2026-10-17. |
| npm inside the box | `docker/executor-proxy/allowlist.txt` allows `registry.npmjs.org` | Present. |

## The one gap: no path from the box to a PR on the real repo

- The approved push always goes to the private sandbox `davidbillera-lab/mc-spike-test` (`SANDBOX_REPO`, `dispatcher.mjs:99`). That is by design.
- The box's git history can't be pushed to the real repo even if we wanted to. `provisionWorkspace()` deletes `.git` and re-inits after the scrub, so stale credential blobs don't survive (lines 96-106). The build commit therefore shares no ancestry with the real `main`, and GitHub can't open a PR from it.
- What survives is enough to rebuild the change: the base commit's subject records the origin commit (`base: <slug> @ <12-hex>`), and `git diff base..reviewed` is exactly the build's change.

**Fix (piece 1):** a host-side script that carries the change across as a patch. It never touches the dispatcher's push gate.

## Scope: 1 code piece, 1 run, 1 report

### Piece 1: `scripts/build-to-pr.mjs` + pure helpers in `scripts/lib/build-patch.mjs` + `tests/build-patch.test.ts` (one commit)

The CLI runs on the host with David's own `gh` login. Nothing it uses ever enters the box.

`node scripts/build-to-pr.mjs --workspace <path> --sha <reviewed sha> --repo <owner/repo> --request <mc request id> [--push]`

1. **Validate inputs.** `--sha` is 40 hex characters and `--request` is a UUID. `--repo` must be on `cloneAllowlist()`, so it reuses the same opt-in as the clone.
2. **Bind to what QC reviewed.** The workspace `HEAD` must equal `--sha`, the SHA from the approval ping. Otherwise refuse.
3. **Find the base.** Take `git rev-list --max-parents=0 HEAD`. There must be exactly one root commit, and its subject must match `^base: <repo> @ ([0-9a-f]{12}) ` (repo compared case-insensitively). Otherwise refuse.
4. **Build the patch** with `git diff --binary <base> <sha>`. Refuse in any of these cases:
   - The patch is empty.
   - It touches a path `isCredentialPath()` flags.
   - It touches anything under `.github/`. A same-repo branch runs Actions with the repo's secrets, so a build must not be able to change a workflow.
5. **Rebuild the change on the real repo.**
   - Clone the real repo into a fresh temp directory (`--filter=blob:none`).
   - Resolve the 12-hex origin to exactly one commit. Refuse if it's ambiguous or missing.
   - Run `git checkout -b mc-build-<request id> <origin>`, then `git apply --index --3way`, then commit. The commit message names the request id and the reviewed SHA.
6. **Without `--push`** (the default): print the diffstat and the branch name, then stop. That is the dry run.
7. **With `--push`:**
   - Refuse if the branch already exists on the remote.
   - Push the branch, then run `gh pr create --draft --base main`. The PR body carries the request id, the reviewed SHA and "built in the MC sandbox; CodexQC before merge".
   - Print the PR URL.
   - **It never merges.** `main` on personal-OS is branch-protected (verified 2026-11-22), so it also couldn't.
8. Delete the temp clone in every exit path.

**Helpers to unit-test** (pure, no git, no network): `parseBaseSubject(subject, repo)`, `checkPatchPaths(paths)` (credential paths and `.github/` are refused) and `validateArgs(argv, allowlist)`.

- Add one integration test that builds a real scratch repo the way `tests/clone-target.test.ts:112` does, makes a build commit, and checks the dry run's diffstat.
- No network, no push.
- Run vitest from the PowerShell tool with `Set-Location C:\Users\david\Documents\personal-os`. Lowercase `c:` breaks it.

### Piece 2: the rig run (David drives; Claude can guide from a session)

Claude can't start the executor. The auto-mode classifier blocks it by design, so David runs steps 3-6.

1. **Precheck (read-only SQL).** Mission Control's `projects.repo_url` must resolve through `repoSlug()` to `davidbillera-lab/personal-OS`. If it doesn't, fix the row first.
2. **Opt the repo in for this run only.**
   - Set `DISPATCHER_CLONEABLE_REPOS: 'davidbillera-lab/personal-OS'` in the rig's `ecosystem.config.cjs`. **Do not commit it.**
   - personal-OS is public, so its source in the box exposes nothing new. The residual risk C6 accepted (the box's OAuth credential can relay text out) is unchanged.
3. **Seed the request** in the SQL editor:
   ```sql
   insert into mc_requests (project_id, title, request_text, status, phase, plan, source, created_by, preferred_worker, assigned_to)
   values ('698d6376-5819-400b-babc-cd664ee36c04',
           'Spike: repoSlug trailing .git/',
           'Step 3 spike build. See plan.',
           'submitted', 'planned',
           'A projects.repo_url ending in ".git/" (for example https://github.com/owner/repo.git/) resolves to the slug "owner/repo.git", so it never matches the clone allowlist and silently falls back to an empty workspace. Find the cause in scripts/lib/clone-target.mjs, fix it with the smallest change, and add a test to tests/clone-target.test.ts that fails before the fix. Run the clone-target tests and commit.',
           'step3-spike', 'david', 'claude', 'claude')
   returning id;
   ```
   - The task is a real bug, found 2026-11-22: `repoSlug()` strips `.git` before it strips the trailing slash.
   - The plan states only the symptom, so a correct fix proves the build read the existing code.
4. **Wake the rig** following `docs/runbooks/on-demand-relay.md`.
   - Use `pm2 delete` + `pm2 start ecosystem.config.cjs`, not `pm2 restart`. A saved definition can predate the env change (`decisions.md`, the pm2 note).
   - Confirm the dispatcher log shows `clone=davidbillera-lab/personal-OS` and `cloned ... (scrubbed N credential file(s))`.
5. **Wait for the approval ping.** It carries the SHA and the QC verdict. The workspace path is in the `[build] start` log line.
6. **Run `build-to-pr.mjs`**: a dry run first, then `--push`. David can run it, or Claude in a session, since it only pushes a feature branch and opens a draft PR.
7. **Reject the request** with `node scripts/rig-test.mjs reject <id>`. The build's copy must not also go to `mc-spike-test`, and an `awaiting_approval` row keeps the rig awake.
8. **Turn it back off.**
   - Remove `DISPATCHER_CLONEABLE_REPOS` from the rig config.
   - Confirm the rig slept: the dispatcher exited, the executor network is down, and Docker Desktop quit.
9. The resulting PR is real work. It gets CodexQC like any other PR and is David's to merge or close.

### Piece 3: spike report `specs/2026-11-2x-step3-spike-report.md` + `decisions.md` entry + MC status

Record each measurement below with its evidence (a log line, the PR URL, a `model_costs` row).

## Pass/fail

**PASS** requires all of these:

| # | Check | Evidence |
|---|---|---|
| 1 | The clone happened | The dispatcher log `cloned davidbillera-lab/personal-OS` |
| 2 | The fix is correct and needed the existing code | The diff changes `repoSlug()`, and the new test fails on the pre-fix code |
| 3 | Tests ran inside the box | The build output shows the clone-target tests passing. `npm ci` time is recorded |
| 4 | QC produced a real verdict | SHIP or FIX-FIRST, not UNKNOWN, and the report is on disk |
| 5 | The draft PR opened cleanly on personal-OS | The PR URL. `git apply` needed no manual help |
| 6 | The rig slept on its own | Within 20 min of the reject, with no Docker "cannot connect" prompts during the run |
| 7 | It was fast enough to be worth it | Wake to PR in 45 min or less, counting only machine time |

**Also record** (these don't decide pass or fail): total wall time, `npm ci` time, the CodexQC cost from `model_costs`, every manual intervention, and any Docker nag.

**Stop-loss:** two run attempts at most. If both fail, for any reason, stop and write the report. The answer is then "redesign", not "debug the rig for a week".

## What the result decides

- **PASS.** The full step 3 spec builds on the rig. Its pieces would be:
  - opting repos in per project instead of globally;
  - `build-to-pr` folded into the approved-push path;
  - a "Built, PR ready" line on the task card;
  - Telegram pings for the Codex and Claude routes;
  - reject/re-plan;
  - the step 1 index.
- **FAIL, or a marginal pass on check 6 or 7.** Step 3 sends dashboard tasks to managed cloud agents instead: Claude Code cloud sessions or Codex cloud, which already clone, sandbox and open PRs.
  - **What you give up:** per-run spend, and less control over the sandbox.
  - **What you get back:** no Docker on one home PC. The rig is founder-dependent infrastructure, and an acquirer can't take it over. That counts against the "every build is a sellable asset" rule even if the spike passes, and the full step 3 spec must weigh it either way.

## Decisions made in this spec (David can override)

1. **The dispatcher comes back on for this one run, then goes off again.** The 2026-10-17 decision ("dispatcher stays off, no autonomous builds") stands until the report says otherwise. Rio keeps watching.
2. **The PR path is a separate host-side script, not a change to the dispatcher's push gate.** The gate's "never a portfolio repo" guarantee stays intact. Folding the script into the gate is a step 3 decision.
3. **The test target is personal-OS.** It's public, so cloning it exposes nothing new, and it's the repo step 3 will mostly build against. `main` is protected.

## Out of scope

- Any dispatcher code change.
- Committing `DISPATCHER_CLONEABLE_REPOS`.
- Private repos.
- Dashboard UI.
- Notifications.
- Running the dispatcher as a background service.

**Stop and re-scope** if piece 1 runs past one build session, or if the run needs a dispatcher code change to get through.

## Rules for the build window (piece 1)

- Read `~/.claude/CLAUDE.md`, the project `CLAUDE.md`, and this spec. Read only `scripts/lib/clone-target.mjs`, `scripts/lib/claude-executor-adapter.mjs:60-115` and `tests/clone-target.test.ts`.
- Don't import `scripts/dispatcher.mjs`. Its env bootstrap loads production credentials. Use `node --check` only.
- Never read `.env*`, `settings.local.json` or `.mcp.json`. Never print process command lines.
- Branch `build/step3-spike-build-to-pr`, one commit, open a PR, **do not merge**. David runs CodexQC on it.
