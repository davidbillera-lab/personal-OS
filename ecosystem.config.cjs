// pm2 process config for the Mission Control rig dispatcher.
// Runs scripts/dispatcher.mjs as a supervised, auto-restarting background process
// that survives terminal close and (with pm2 startup) login/reboot. The dispatcher
// self-loads .env.local, so NO secrets are duplicated here — only non-secret runtime
// toggles. Start:  pm2 start ecosystem.config.cjs   then   pm2 save
module.exports = {
  apps: [{
    name: 'mc-dispatcher',
    script: 'scripts/dispatcher.mjs',
    cwd: __dirname,
    exec_mode: 'fork',
    instances: 1,
    // OFF, deliberately. The relay is on-demand: the dispatcher exits ON PURPOSE when the
    // work set empties (DISPATCHER_IDLE_SLEEP_MS below), and pm2 must not undo that by
    // restarting it into another idle poll loop. A genuine crash therefore also stays down
    // — acceptable, because the wake path is one command and a crash-loop against a dead
    // Docker is the exact behaviour that made the operator kill Docker on 2026-08-13.
    autorestart: false,
    max_restarts: 20,
    restart_delay: 5000,   // 5s backoff between restarts
    min_uptime: 30000,     // must stay up 30s to count as a healthy start
    kill_timeout: 30000,   // on stop: allow 30s for the current tick to finish before SIGKILL
    watch: false,
    time: true,            // timestamp each log line
    merge_logs: true,
    env: {
      // Non-secret runtime toggles. Secrets (Supabase/Telegram keys) come from
      // .env.local, which the dispatcher loads itself.
      //
      // executor=docker (C6-P4): builds run in a throwaway `mc-executor:latest`
      // container on the --internal network `mc-executor-net`, whose ONLY route off
      // the box is the allowlisting proxy. The container + egress allowlist is the
      // security boundary — not the prompt, not the deny-list.
      // PREREQUISITE: `npm run executor:net` must have been run (network + proxy up)
      // or preflight() fails closed and the dispatcher builds NOTHING. Check with
      // `npm run executor:net:status`. Fallback if Docker is down: 'claude' — but
      // that path is UNSANDBOXED (runs on the host) and is not the supported
      // production configuration.
      DISPATCHER_EXECUTOR: 'docker',
      // OFF (C6-P4, verified 2026-08-05): headless `claude -p` completes inside the
      // container without --dangerously-skip-permissions, so the workspace
      // .claude/settings.json deny-list (git push / gh / curl / rm) is genuinely
      // ENFORCED — real defense in depth behind the container boundary. Do not turn
      // this back on to "unblock" a build; it removes a layer and buys nothing.
      DISPATCHER_SKIP_PERMISSIONS: '0',
      // GO-LIVE SWITCH for the second-half relay (Hermes plan -> autonomous build).
      // OFF by default: the dispatcher claims only status='queued' rows (unchanged
      // behavior). Flip to '1' + `pm2 restart mc-dispatcher` to let it also claim
      // Hermes-deposited plans (status='submitted' phase='planned') and build them
      // FROM the plan. Safe to enable now that C6 Case 7 is closed + red-team certified
      // (2026-08-06). The classifier stays ON as the compensating control for the
      // residual inference-spend on the mounted token — do NOT relax it. Runbook:
      // docs/runbooks/go-live-autonomous-relay.md
      DISPATCHER_CLAIM_PLANNED: '1', // ENABLED 2026-08-06 (go-live). Rollback: '0' + pm2 restart.

      // Repos a build may be given a working copy of, comma-separated `owner/repo`.
      // UNSET = OFF, and off means every build gets an empty `git init` workspace —
      // exactly how the sandbox behaved before cloning existed. Leave it unset unless you
      // have a specific reason; enabling a repo is a security decision, not a convenience.
      //
      // WHAT ENABLING COSTS YOU: C6's red team found the mounted OAuth credential still
      // authorizes plain /v1/messages inference, so a build can relay small payloads out
      // as ordinary model text. With an empty workspace there was nothing worth taking.
      // Naming a repo here puts that repo's source inside the box. The clone is shallow
      // (no history) and credential-shaped files are stripped before the container starts,
      // but the source itself is readable by the build. Add a repo only when the work
      // genuinely requires seeing the code, and prefer removing it again afterwards.
      //
      // Reads projects.repo_url for the request's project; anything not matching an entry
      // here fails closed to an empty workspace. Example:
      //   DISPATCHER_CLONEABLE_REPOS: 'davidbillera-lab/personal-OS',

      // ---- on-demand relay: sleep when there is nothing to do ----
      // How long the work set must stay empty before the dispatcher exits. 0/unset = never
      // sleep (the old always-on behaviour).
      //
      // It will NOT sleep on outstanding work, and awaiting_approval counts as outstanding:
      // the operator approves later and the DISPATCHER performs the gated push, so sleeping
      // through an approval would strand a finished build. A `submitted` row with no plan
      // does NOT count — that is waiting on Hermes, not on us, and can sit for days.
      //
      // Why sleep at all: an idle dispatcher is not free. While Docker is down each health
      // probe pokes Docker Desktop into showing its "cannot connect" UI — that nagging is
      // what got Docker killed on 2026-08-13, taking the relay down for three days.
      DISPATCHER_IDLE_SLEEP_MS: String(15 * 60 * 1000), // 15 min idle -> sleep
      // On sleep, also drop the executor network and quit Docker Desktop (scripts/rig-sleep.ps1).
      // Set '0' to just stop the dispatcher and leave Docker running.
      DISPATCHER_SLEEP_TEARDOWN: '1',
    },
  }],
}
