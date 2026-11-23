# Spike: one sandbox build against a real repo, landed as a draft PR

**Status:** DRAFT r2, 2026-11-23. CodexQC round 1 returned FIX-FIRST with 5 blockers (`.codex-qc/codex-qc-2026-11-23T05-57-37-469Z.md`). All 5 were confirmed against the code and are folded in below, along with one risk Codex missed (Vercel preview builds). Gates: CodexQC round 2 (David runs it), then David's approval, then a fresh build window for pieces 1-3, then CodexQC on that PR (David runs it), then the rig run.
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

## Two gaps

**Gap A: no path from the box to a PR on the real repo.**
- The approved push always goes to the private sandbox `davidbillera-lab/mc-spike-test` (`SANDBOX_REPO`, `dispatcher.mjs:99`). That is by design.
- `provisionWorkspace()` deletes `.git` and re-inits after the scrub, so stale credential blobs don't survive (adapter :96-106). The build commit therefore shares no ancestry with the real `main`, and GitHub can't open a PR from it.
- The fix is to carry the change across as a patch, on the host.

**Gap B: the host already trusts the box's output.** These are pre-existing and present in every build since August. They're dormant only because the dispatcher is off, and they must be closed before it comes back on.
- **Hostile `.git` (Critical).** `runHostQc()` (adapter :187) runs `git` and `codex-qc.mjs` with `cwd` set to the workspace and the host's env loaded. The box can write `.git/config`, so a `core.fsmonitor` or `diff.external` entry runs a command on the host with the dispatcher's credentials in its environment.
- **QC reviews the last commit only.** It diffs `sha^..sha` (adapter :192). A build that makes two commits gets its first one through unreviewed.
- **The scrub fails open.** `scrubClonedCredentials()` (adapter :67) returns `[]` when listing files fails and swallows removal errors. It also splits non-`-z` output, which mangles quoted (non-ASCII) filenames.
- **Executor policy leaks into the build.** The adapter writes `.claude/settings.json` after the base commit (adapter :262, :486). personal-OS doesn't track `.claude/`, so a builder's `git add -A` commits that file into the change.

**Gap C (found while checking Codex's CI finding): Vercel builds every pushed branch.**
- GitHub Actions is not the exposure. The only workflow is `secret-scan.yml` (gitleaks on push/PR, default `GITHUB_TOKEN`, runs no repo code).
- Vercel's git integration is. It builds every pushed branch as a Preview deployment, which runs the branch's code (`npm install`, `next build`, config files) with Preview-scoped env vars.
- The Next.js app also imports from `scripts/lib` (`app/api/queue/dispatch/route.ts:4`, `lib/owner-requests.ts:3`), so a "scripts-only" change can still run in that build.

## Scope: 3 code pieces, 1 run, 1 report

All three code pieces happen in one build window, one commit per piece. `scripts/dispatcher.mjs` is not changed.

### Piece 1: host-side hardening, `scripts/lib/trusted-git.mjs` (new) + `scripts/lib/claude-executor-adapter.mjs`

After the container starts, **no host `git` or `node` process ever runs with `cwd` or `--git-dir` inside the workspace.** The workspace's `.git` is hostile input.

- **`openTrusted(workspace)`** reads build output safely.
  - Create a fresh repo in a host temp dir outside the workspace.
  - Copy `<workspace>/.git/objects` into it. Copy regular files only, refuse symlinks and anything else, and skip `objects/info/` (no alternates are followed).
  - Never read the workspace's config, hooks, `info/` or `packed-refs` through git.
  - Every git call on the trusted repo also passes `-c core.fsmonitor= -c core.hooksPath=<empty dir> --no-ext-diff --no-textconv`, as a second layer.
- **`readWorkspaceHead(workspace)`.** Resolve `.git/HEAD`, and the one loose ref it names, as plain text files: regular files only, and the result must be 40 hex characters. This replaces any `git rev-parse` in the workspace.
- **A provision record outside the mount.** `provisionWorkspace()` writes `<workspace>.provision.json` beside the workspace with `{requestId, slug, originSha (full 40), baseSha}`. Only the workspace is mounted (adapter :440). Empty-init builds record `baseSha: null`, so QC keeps today's empty-tree base.
- **`runHostQc({ workspace, sha, baseSha })`.**
  - Check out `sha` from the trusted repo into a fresh host temp dir, then run `codex-qc.mjs --base <baseSha>` there.
  - QC therefore reviews the whole build, from the recorded base to `sha`. That is exactly the range piece 2 exports.
  - `launch()` passes the recorded `baseSha` through. Temp dirs are deleted in every exit path.
- **The scrub fails closed.**
  - List files with `git ls-files -z`. This runs on the host's own fresh clone, before the box exists, so it is trusted.
  - Throw if listing fails or any removal fails.
  - Re-list after removal and throw if any credential path is still present.
  - A provisioning failure fails the build before the container starts.
- **Tests.**
  - `tests/trusted-git.test.ts`: a workspace whose `.git/config` sets `core.fsmonitor` (and `diff.external`) to a command that writes a marker file. Reading HEAD, opening the trusted repo and diffing through it must never create the marker.
  - Same file: a symlink inside `objects/` is refused.
  - Same file: a two-commit build reviews from the recorded base, not `sha^`. Test the range computation, not Codex.
  - Extend the scrub cases in `tests/clone-target.test.ts`: a credential file with a non-ASCII name is removed, and a removal failure throws.

### Piece 2: `scripts/build-to-pr.mjs` (CLI) + `exportBuild()` in `scripts/lib/build-patch.mjs` + `tests/build-patch.test.ts`

The CLI runs on the host with David's own `gh` login. Nothing it uses ever enters the box.

`node scripts/build-to-pr.mjs --workspace <path> --sha <reviewed sha> --repo <owner/repo> --request <mc request id> --allow <glob> [--allow <glob> ...] [--push]`

1. **Validate inputs.**
   - `--sha` is 40 hex characters and `--request` is a UUID.
   - `--repo` must be on `cloneAllowlist()`.
   - At least one `--allow` glob is required.
2. **Bind to the provision record.** Read `<workspace>.provision.json`. Its `requestId` and `slug` must match `--request` and `--repo` (slug compared case-insensitively). Origin and base come only from this record, never from anything inside the workspace.
3. **Bind to what QC reviewed.**
   - `readWorkspaceHead()` must equal `--sha`, the SHA from the approval ping.
   - In the trusted repo, the recorded `baseSha` must exist and be an ancestor of `--sha`.
4. **Build the patch** in the trusted repo with `diff --binary --no-ext-diff --no-textconv <baseSha> <sha>`. That is the same range QC reviewed. Refuse in any of these cases:
   - The patch is empty.
   - Any changed path matches no `--allow` glob.
   - Any changed path is on the always-refused list, whatever `--allow` says:
     - credential paths (`isCredentialPath()`)
     - `.claude/`, `.github/`
     - `vercel.json`, `.gitleaks.toml`
     - `package.json`, any lockfile
     - `CLAUDE.md`, `AGENTS.md`
5. **Rebuild the change on the real repo.**
   - Clone the real repo into a fresh host temp directory.
   - Run `git checkout -b mc-build-<request id> <originSha>` using the full recorded SHA. Refuse if it's missing.
   - Then `git apply --index --3way` and commit. The commit message names the request id and the reviewed SHA.
6. **Without `--push`** (the default): print the **full diff** and the branch name, then stop. David reads that diff before anything leaves the machine, and that is the human gate.
7. **With `--push`:**
   - Refuse if the branch already exists on the remote.
   - Push, then run `gh pr create --draft --base main`. The PR body carries the request id, the reviewed SHA, the QC verdict and "built in the MC sandbox; CodexQC before merge".
   - Print the PR URL.
   - **It never merges.** `main` on personal-OS is branch-protected (verified 2026-11-22).
8. Delete temp dirs in every exit path.

**Test seam.**
- `exportBuild({ ..., cloneUrlFor })` takes the clone URL builder as a parameter. The CLI always passes the GitHub one.
- The test passes a `file://` scratch repo built the way `tests/clone-target.test.ts:112` does, then runs the full dry-run path (record, trusted read, patch, apply) offline.
- No env var or CLI flag can switch the URL in production.
- Unit-test the path policy (allow globs plus the always-refused list) and the argument validation as pure functions.

### Piece 3: no preview deployments for sandbox branches, `vercel.json`

- **Change.** Add `"git": { "deploymentEnabled": { "mc-build-*": false } }`.
  - The builder checks the key against Vercel's docs before committing.
  - This must be merged to `main` and deployed before the run.
  - The exporter builds the branch from `main` plus a patch that can't touch `vercel.json`, so the branch carries `main`'s setting.
- **Effect.** Together with Gap C's finding about Actions, pushing a sandbox branch runs no repo code anywhere, and the `--allow` list is defense in depth.
- **Cost.** Sandbox PRs get no preview URL.

**For all three pieces:** run vitest from the PowerShell tool with `Set-Location C:\Users\david\Documents\personal-os`. Lowercase `c:` breaks it.

### Piece 4: the rig run (David drives; Claude can guide from a session)

Pieces 1-3 must be merged, and piece 3 deployed, before step 2.

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
6. **Run `build-to-pr.mjs`** with `--allow scripts/lib/clone-target.mjs --allow "tests/**"`.
   - Do a dry run first. David reads the full diff it prints.
   - Then run it with `--push`. David can run it, or Claude in a session, since it only pushes a feature branch and opens a draft PR.
   - After the push, confirm Vercel created **no** deployment for `mc-build-<id>`.
7. **Reject the request** with `node scripts/rig-test.mjs reject <id>`. The build's copy must not also go to `mc-spike-test`, and an `awaiting_approval` row keeps the rig awake.
8. **Turn it back off.**
   - Remove `DISPATCHER_CLONEABLE_REPOS` from the rig config.
   - Confirm the rig slept: the dispatcher exited, the executor network is down, and Docker Desktop quit.
9. The resulting PR is real work. It gets CodexQC like any other PR and is David's to merge or close.

### Piece 5: spike report `specs/2026-11-2x-step3-spike-report.md` + `decisions.md` entry + MC status

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
| 8 | Nothing ran sandbox code outside the box | No Vercel deployment for the branch. Piece 1's hostile-`.git` test passes on the rig |

**Also record** (these don't decide pass or fail):
- total wall time;
- `npm ci` time;
- the CodexQC cost from `model_costs`;
- every manual intervention and any Docker nag;
- **every founder-dependent step**: David's `gh` identity, manual SQL, the uncommitted pm2 edit, log reading, the reject command.

Before any of this goes into the dispatcher, the step 3 spec must replace each of those with a committed config or a documented service identity.

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
2. **The PR path is a separate host-side script, not a change to the dispatcher's push gate.** The gate's "never a portfolio repo" guarantee stays intact. Folding the script into the gate is a step 3 decision. Piece 1 changes the adapter's host side, because Gap B is live risk the moment the dispatcher runs.
3. **The test target is personal-OS.** It's public, so cloning it exposes nothing new, and it's the repo step 3 will mostly build against. `main` is protected.

## Out of scope

- Any change to `scripts/dispatcher.mjs`.
- Committing `DISPATCHER_CLONEABLE_REPOS`.
- Private repos.
- Dashboard UI.
- Notifications.
- Running the dispatcher as a background service.

**Stop and re-scope** if pieces 1-3 run past one build session, or if the run needs a `dispatcher.mjs` change to get through.

## Rules for the build window (pieces 1-3)

- Read `~/.claude/CLAUDE.md`, the project `CLAUDE.md`, and this spec. Read only these:
  - `scripts/lib/clone-target.mjs`
  - `scripts/lib/claude-executor-adapter.mjs` (provisioning :60-115, `runHostQc` :187-210, the two `launch()` paths around :259 and :483)
  - `tests/clone-target.test.ts`
  - `vercel.json`
- Don't import `scripts/dispatcher.mjs`. Its env bootstrap loads production credentials. Use `node --check` only.
- Never read `.env*`, `settings.local.json` or `.mcp.json`. Never print process command lines.
- Branch `build/step3-spike-build-to-pr`, one commit per piece, open a PR, **do not merge**. David runs CodexQC on it.
