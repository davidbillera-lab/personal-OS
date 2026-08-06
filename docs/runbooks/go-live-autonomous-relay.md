# Runbook — Go live: autonomous Hermes→Claude relay

Enables the second half of the relay: the dispatcher claims a Hermes-deposited plan and builds it autonomously (event-triggered), instead of only building `queued` requests. **One flag flip.** Off by default because it turns on unattended autonomous execution — your call to enable.

## Prerequisites (all DONE as of 2026-08-06)
- ✅ C6 executor sandbox certified — boundary strong + **Case 7 closed** (TLS-terminating proxy blocks web_fetch/web_search/files/profile; red-team `redteam:c6:api` = CONTAINED).
- ✅ Build-from-plan wired (executor builds from the `plan` column).
- ✅ Realtime event-trigger wired (dispatcher fires the instant a row changes; 5s poll is the backstop).
- ✅ Gated `planned`-claim built (`DISPATCHER_CLAIM_PLANNED`, default off).

## Preflight (10 seconds)
```
npm run executor:net:status   # proxy + --internal network must be UP (fail-closed if down)
pm2 status                    # mc-dispatcher online
```

## The flip
1. In `ecosystem.config.cjs`, set `DISPATCHER_CLAIM_PLANNED: '1'`.
2. `pm2 restart mc-dispatcher`  (loads the latest code + the flag)
3. `pm2 save`

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

## Not yet wired (needs a decision)
- **Push target (gap D):** builds still push only to `davidbillera-lab/mc-spike-test` (approval-gated). Pushing to a real project repo needs the D build — decide which repos to allowlist and whether the build checks out the target repo vs. builds in the empty sandbox workspace.

## Rollback
Set `DISPATCHER_CLAIM_PLANNED: '0'` → `pm2 restart mc-dispatcher`. Back to queued-only, zero behavior change.
