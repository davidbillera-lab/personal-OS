# Step 3 spike report — real-repo sandbox build to draft PR

**Date:** 2026-11-24 · **Spec:** `specs/2026-11-22-mc-step3-spike-real-repo-build.md` · **Result PR:** https://github.com/davidbillera-lab/personal-OS/pull/43

## Verdict

**Not a clean PASS.** The full path works: the rig cloned personal-OS, built a correct fix, QC reviewed it, the export guard accepted it, and a draft PR opened with no manual patching. Two problems stop it counting as a PASS:

- **Check 3 failed.** On the passing run, the builder never installed dependencies, so the tests didn't run inside the box.
- **Check 6 was never tested.** The rig was put to sleep by hand.

**The stop-loss was also exceeded.** The spec allows two run attempts and this took three. Runs 1 and 2 both failed check 5 because the export refused them. Each refusal exposed a real bug in our own pipeline, and those were fixed (PRs #41 and #42) before the next run. None of the failures were caused by the rig itself being unreliable.

The spec's rule is: "FAIL, or a marginal pass on check 6 or 7 → step 3 goes to managed cloud agents." Whether to apply that rule strictly is David's call. See "Decision needed" below.

## Pass/fail checks

| # | Check | Result | Evidence |
|---|---|---|---|
| 1 | The clone happened | ✅ | Log `17:55:34 [executor] cloned davidbillera-lab/personal-OS (scrubbed 1 credential file(s))` |
| 2 | Correct fix; the new test fails on the old code | ✅ | The diff changes `repoSlug()`. The PR's test file run against main's code fails 1 of 24 (`strips a trailing slash AFTER .git`) |
| 3 | Tests ran inside the box | ❌ | Run 3's workspace has no `node_modules`, so `npm ci` never ran. Run 1 did install and test (it has `node_modules` and `.tmp-vitest/`), but its export was refused. The likely cause is the PR #41 prompt rule ("if the task needs a dependency change, stop"), which steered the builder away from installing at all |
| 4 | QC gave a real verdict on the whole build | ✅ | `.qc.json` verdict SHIP. Its `baseSha` `1d35fd42…` equals the provision record's. The report is at `.qc/bd6579dd….md` |
| 5 | The draft PR opened cleanly | ✅ (run 3) | PR #43. `git apply --index --3way` needed no help. Runs 1 and 2 were refused, see "Runs" |
| 6 | The rig slept on its own | ⚠️ not tested | David ran `npm run rig:sleep` by hand. Docker nags during the run: none seen |
| 7 | Wake to PR in 45 min or less of machine time | ✅ | Run 3: claim to QC verdict in 137 s, export about 25 s. Run 1: 1,116 s, including dependency install and tests |
| 8 | No sandbox code ran outside the box | ✅ | No Vercel deployment for `mc-build-40c73507-*`. The hostile-`.git` tests are in the suite that passes on the rig (463/463) |

## Runs

| Run | Request | Build time | QC | Export | Why |
|---|---|---|---|---|---|
| 1 | `8ae64d32` | 1,116 s | SHIP | refused | The builder commit included a tracked config file, lockfile churn and a `.tmp-vitest/` scratch folder |
| 2 | `f17a5f2b` | 171 s | SHIP | refused | The tracked config file still showed up (root cause below) |
| 3 | `40c73507` | 137 s | SHIP | **clean → PR #43** | — |

The CodexQC cost per build (`model_costs`) was $0.065, $0.016 and $0.013. Builder-side Claude usage inside the box is not logged to `model_costs`.

## Bugs the spike found (all fixed)

1. **The host's global git ignore shaped the base commit** (PR #42).
   - David's `~/.config/git/ignore` lists the MCP config dotfile. The host-side `git add -A` for the base commit silently skipped that tracked file, even though it was still on disk.
   - The box has no global ignore, so the builder's `git add -A` re-added the file and it looked like a new file.
   - The fix: the workspace gets a repo-local `core.excludesFile`.
   - It was first misdiagnosed as the scrubber putting a file back. The file the scrubber actually removed was the mitmproxy CA cert.
2. **The builder committed scratch folders and protected-file churn** (PR #41).
   - Scrubbed paths and `.tmp-*/` now go into `.git/info/exclude`.
   - The prompt tells the builder not to touch protected files.
3. **An attempted fix in PR #41 would have silently dropped protected-file edits** (caught by CodexQC).
   - `skip-worktree` hid those edits from the PR, while the builder still tested against them.
   - It was removed. The export guard stays the loud enforcer.

## Other findings

- **A stale request jumped the queue.** `716f5e08`, an old `clone=none` request, was claimed first after the wake. That cost about 6 minutes and $0.033 of QC on junk. Before the dispatcher runs unattended, eligibility needs a freshness or opt-in rule.
- **Realtime drops after every build.** `TIMED_OUT` / `CHANNEL_ERROR` appeared right after each build finished. Each one recovered within about 2 s and the poll loop backstopped it, but it's noisy.
- **RAM pressure.** Memory was at 97.8% at wake. Two idle local Supabase stacks (Prime Cut Club and REELFLOW dev) were stopped to make room. The rig shares a desktop with dev work.
- **A flaky test.** `trusted-git.test.ts` "leaves no trusted temp dir behind" counts `mc-trusted-*` folders in the shared temp folder. It failed in 3 of 4 full runs while other test files ran in parallel. It needs a per-test temp root.
- **The dispatcher doesn't hot-reload.** After each merge, a running dispatcher keeps the old code until `pm2 restart`, and `rig:wake` skips the restart if it's already online.

## Founder-dependent steps (each must become committed config or a service identity before step 3)

- **PR author** is David's `gh` identity (`davidbillera-lab`).
- **Requests are queued** by hand-run SQL in the Supabase editor. The auto-mode classifier blocked an agent from inserting them.
- **The clone allowlist** is an uncommitted edit to `ecosystem.config.cjs` (`DISPATCHER_CLONEABLE_REPOS`), added and removed by hand.
- **Starting and stopping the rig** is done by hand (`rig:wake`, `rig:sleep`, `pm2 restart` after merges).
- **Rejecting a build** is a CLI command (`rig-test.mjs reject`).
- **Reading progress** means reading the pm2 logs and running `build-to-pr` by hand: the dry run, then `--push`.
- **CodexQC on pipeline PRs** is run by David, because the script reads a key file.
- **Everything runs on one home PC** shared with dev work. The spec says an acquirer can't take this over, whatever the result.

## Decision needed (David)

- **A. Apply the stop-loss strictly: FAIL → evaluate managed cloud agents for step 3** (Claude Code cloud sessions or Codex cloud).
  - Keep the hardening built here; the trusted reader, export guard and QC record all port.
  - What you give up: per-run spend and some control over the sandbox.
- **B. Treat it as a conditional pass.** One more run, solely to prove checks 3 and 6:
  - change the prompt rule to "run `npm ci` then the relevant tests";
  - let the rig sleep on its own.
  - What you give up: the stop-loss loses its teeth, and the founder-dependence list above stays.

**Recommendation: A.** The spike did its job by proving the path and flushing out three real bugs. But the spec set the stop-loss for exactly this situation, and the rig is founder-dependent no matter how many checks pass.
