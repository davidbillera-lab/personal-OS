# Runbook — On-demand relay (Hermes asks, you say yes, the rig builds)

The relay no longer runs all the time. It sleeps, Hermes offers to wake it when there is
real work, and it goes back to sleep when the work is done.

**Why it works this way.** An always-on dispatcher with nothing to do is not free: while
Docker is down, every health probe pokes Docker Desktop into showing its "cannot connect /
starting" UI. On 2026-08-13 that nagging is what led to Docker being shut off entirely,
which took the relay down for three days without a single alert — the thing that reports
health was the thing that was down. When there is no work, the correct amount of running
software is none.

---

## The loop

1. **Hermes finishes a spec** and calls `mc_submit_plan` → the row becomes
   `status='submitted'`, `phase='planned'`, with the spec in `plan`.
2. **Hermes asks you over Telegram:** *"Spec ready for &lt;title&gt;. Want me to wake the
   dispatcher and build it?"*
3. **You say yes.** Hermes runs the wake command on the rig.
4. **The rig wakes** — Docker Desktop, executor egress network + proxy, then the dispatcher.
5. **The dispatcher claims the planned row** (`DISPATCHER_CLAIM_PLANNED=1`) and hands the
   plan to Claude Code inside the C6 sandbox container. CodexQC reviews the commit.
6. **You get the approval ping** — the existing one, with the SHA and QC verdict.
7. **You approve** → SHA-gated push to `davidbillera-lab/mc-spike-test`.
8. **The rig sleeps** ~15 min after the queue empties: dispatcher exits, executor network
   comes down, Docker Desktop quits.

Nothing polls between step 8 and the next step 1.

---

## What Hermes needs to do

Add this to Hermes's instructions/profile. It is the only Hermes-side change.

```
After you successfully call mc_submit_plan, message David on Telegram:

  "📋 Spec ready — <title>
   Request: <request_id>
   Want me to wake the dispatcher and build it?"

If he answers yes / go / do it / build it, run this on the rig and report the last
few lines back to him:

  cd C:\Users\david\Documents\personal-os
  npm run rig:wake

That starts Docker Desktop, brings up the executor egress network, and starts the
dispatcher, which picks up the plan on its own within a few seconds. Do NOT approve
the build afterwards — David approves the push himself. Your job ends at the wake.

If he answers no / not now / later, do nothing. The spec is safe in Mission Control
and he can ask you to wake it any time.
```

**Why Hermes and not a cron:** Hermes is the one calling `mc_submit_plan`, so it knows the
instant a spec lands — no polling, no new infrastructure, and no alert can fire for a spec
that does not exist. If Hermes is down there is no spec either, so the failure modes line up.

---

## Commands

```
npm run rig:wake     # Docker + executor net + dispatcher   (scripts/rig-boot.ps1)
npm run rig:sleep    # dispatcher + executor net + Docker down (scripts/rig-sleep.ps1)
```

Both are idempotent and safe to run at any time. Neither touches build artifacts, Mission
Control rows, or anything under `builds/`. The wake path logs to `rig-boot.log`
(gitignored); the sleep path logs to the same file, so there is one timeline to read.

`rig:wake` does **not** rely on `pm2 resurrect` to start anything — resurrect restores the
saved state, which after a sleep is `stopped`. For a stopped or errored entry, the wake
deletes the saved PM2 definition and recreates it from `ecosystem.config.cjs`; a plain
`pm2 restart` would reuse stale pre-on-demand settings. It then saves the corrected PM2 dump.
An already-online dispatcher is left alone in case a build is running. Finally the wake
verifies the process and **exits non-zero if it is not `online`**. So a wake
that fails, fails visibly: the last log line is `FAILED: mc-dispatcher is not online` rather
than `done`. If Hermes reports the last few lines back and they say that, the relay did not
come up and nothing will be built.

---

## When it will NOT go to sleep

By design, and this is the safety rule that matters:

- **A row is `awaiting_approval`.** You approve later and the *dispatcher* performs the
  gated push — sleeping here would strand a finished build the same way the `assigned_to`
  filter did. Staying awake through the approval window costs nothing, because Docker is up
  the whole time and there is no nagging to avoid.
- **A build is running**, or anything sits in `queued` / `claimed` / `in_progress`.
- **The work-set query failed.** Unknown means stay awake; it never sleeps off an error.

It *will* sleep through a `submitted` row with no plan — that is waiting on Hermes, not on
the rig, and can sit for days (`26d1849b` sat that way for two).

---

## Turning it off

Set `DISPATCHER_IDLE_SLEEP_MS: '0'` in `ecosystem.config.cjs` and restart. The dispatcher
returns to the old always-on behaviour. Note `autorestart` is now `false`, so a crash stays
down until you wake it — deliberate, because a crash-loop against a dead Docker is exactly
the nagging this design exists to prevent.
