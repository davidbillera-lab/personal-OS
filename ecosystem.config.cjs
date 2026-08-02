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
      DISPATCHER_EXECUTOR: 'claude',
      DISPATCHER_SKIP_PERMISSIONS: '1',
    },
  }],
}
