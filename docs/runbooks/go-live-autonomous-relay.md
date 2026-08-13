# Runbook — Go live: autonomous Hermes→Claude relay

Enables the second half of the relay: the dispatcher claims a Hermes-deposited plan and builds it autonomously (event-triggered), instead of only building `queued` requests. **One flag flip.** Off by default because it turns on unattended autonomous execution — your call to enable.

## Prerequisites (all DONE as of 2026-08-06)
- ✅ C6 executor sandbox certified — boundary strong + **Case 7 closed** (TLS-terminating proxy blocks web_fetch/web_search/files/profile; red-team `redteam:c6:api` = CONTAINED).
- ✅ Build-from-plan wired (executor builds from the `plan` column).
- ✅ Realtime event-trigger wired (dispatcher fires the instant a row changes; 5s poll is the backstop).
- ✅ Gated `planned`-claim built (`DISPATCHER_CLAIM_PLANNED`, default off).

## Preflight (10 seconds)
```
docker info                   # Docker Desktop must be RUNNING (everything below depends on it)
npm run executor:net:status   # proxy + --internal network must be UP (fail-closed if down)
pm2 status                    # mc-dispatcher online
```

**Docker Desktop is the prerequisite behind the prerequisite.** On 2026-08-11 it was down for
hours: `pm2 status` showed online, Realtime was subscribed, the queue looked healthy — and the
network + proxy were simply gone, because they live in Docker. Every build would have failed.
If `executor:net:status` says MISSING, start Docker Desktop first, then `npm run executor:net`.

Since that day the dispatcher checks sandbox health **before claiming**: while the sandbox is
down it claims nothing (queued work waits instead of being burned into failed rows) and sends
one Telegram alert on the down edge. Path B — pushing an already-approved build — is
deliberately NOT gated, so an outage can never strand a finished commit.

## The flip
1. In `ecosystem.config.cjs`, set `DISPATCHER_CLAIM_PLANNED: '1'`.
2. `pm2 restart mc-dispatcher`  (loads the latest code + the flag)
3. `pm2 save`

(Windows PowerShell: run these on separate lines, or join with `;` — `&&` is a bash-ism and errors in PowerShell 5.1.)

That's it. The dispatcher now, on any Realtime change or poll tick, claims the oldest `status='submitted' AND phase='planned' AND plan IS NOT NULL` row (after queued rows), transitions it to building, and builds **from the deposited plan**. CodexQC runs in-build; then it waits for your push approval.

## Verify
Your two parked plans flow immediately on enable:
- `20d5c8af` Homeroom Tutor · `66143987` Telegram alerts
Watch: `/queue` in the MC UI, or `pm2 logs mc-dispatcher`. You'll get a Telegram approval ping when a build is ready to push.

## Guards still active (do not remove)
- **Classifier** — screens every request pre-build. **Keep it ON** — it's the compensating control for Case 7's one accepted residual (a build can still spend inference on the mounted token; it just can't exfil). Do NOT relax `secrets`/`live-deploy`.
- **Approval-before-push** — SHA-gated; nothing reaches a repo without your approval.
- **C6 sandbox** — every build runs in the certified container.
- **Kill-switch** — `node scripts/rig-test.mjs pause` halts everything within one tick.

## Working on real code (gap D, half closed 2026-08-11)

**The build can now check out a real repo** — `DISPATCHER_CLONEABLE_REPOS` in
`ecosystem.config.cjs`, comma-separated `owner/repo`, **unset = off**. Unset means every build
gets an empty `git init` workspace exactly as before, and every ambiguity (no `repo_url`,
non-GitHub host, not on the list, lookup error) fails closed to that same empty workspace.

When enabled, the **host** clones (the container never receives a git credential),
`--depth 1 --single-branch`, credential-shaped files are stripped, and the cloned `.git` is
discarded and re-initialised — deleting the files alone left the blobs recoverable via
`git show <base>:.env.local`. Proven end to end 2026-08-11 against `mc-spike-test`: the build
correctly named a pre-existing file, history came out exactly 2 commits, and CodexQC diffed
only the build's own commit.

**Enabling a repo is a security decision, not a convenience.** C6's red team found the mounted
OAuth credential still authorizes plain `/v1/messages` inference, so a build can relay small
payloads out as ordinary model text. An empty workspace has nothing worth taking; a cloned one
does. Add a repo when the work genuinely needs to see the code, and remove it afterwards.

**Still not wired:** the push target. Builds push only to `davidbillera-lab/mc-spike-test`
(approval-gated) — never back to the repo they were cloned from. A cloned build therefore
produces a reviewable branch in the sandbox, not a PR against the real project.

## Rollback
Set `DISPATCHER_CLAIM_PLANNED: '0'` → `pm2 restart mc-dispatcher`. Back to queued-only, zero behavior change.
