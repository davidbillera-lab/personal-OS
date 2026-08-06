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
    autorestart: true,
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
    },
  }],
}
