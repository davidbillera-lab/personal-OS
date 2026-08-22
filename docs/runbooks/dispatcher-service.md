# Dispatcher Service Runbook (pm2)

## What this is

The **dispatcher** (`scripts/dispatcher.mjs`) is the program that watches Mission
Control for queued build requests and runs them on this rig. If the dispatcher
isn't running, queued requests just sit there — nothing gets built.

Running it under **pm2** keeps it alive in the background:
- No terminal window needs to stay open.
- It restarts itself automatically if it crashes.
- It comes back automatically after the rig reboots (once set up below).

You do not need to understand the dispatcher's code to run this. Just follow the
steps.

---

## One-time install

Run these once, ever, on this rig.

1. Install pm2 and the Windows startup helper:
   ```powershell
   npm install -g pm2 pm2-windows-startup
   ```
2. Register pm2 to resurrect saved processes at Windows login:
   ```powershell
   pm2-startup install
   ```

---

## Start it

3. Go to the project folder:
   ```powershell
   cd C:\Users\david\Documents\personal-os
   ```
4. Start the dispatcher under pm2:
   ```powershell
   pm2 start ecosystem.config.cjs
   ```
5. Save the process list so it survives a reboot:
   ```powershell
   pm2 save
   ```

That's it — the dispatcher is now running in the background and will come back
on its own after a reboot or crash.

---

## Why this runs at login, not as a Windows SYSTEM service

**Do not "upgrade" this to a SYSTEM service.** The dispatcher launches headless
Claude, and Claude needs David's logged-in Windows user session and credentials
to work. A SYSTEM service runs before/without any user logged in, so Claude
would fail to authenticate. That's why this is set up to start at David's login
(via `pm2-startup`), running as David's own user — not as a background SYSTEM
service. If you're troubleshooting and considering converting this to a service
for "reliability," don't — it will break the Claude login instead.

---

## Daily use / checks

- **Is it running?**
  ```powershell
  pm2 status
  ```
  Look for `mc-dispatcher` with status `online`.

- **Watch live logs:**
  ```powershell
  pm2 logs mc-dispatcher
  ```
  Press Ctrl-C to stop *watching* — this does NOT stop the dispatcher itself.

- **After pulling new dispatcher code** (`git pull`), restart it to pick up the
  change:
  ```powershell
  pm2 restart mc-dispatcher
  ```

- **Pause it** (e.g. before rig maintenance):
  ```powershell
  pm2 stop mc-dispatcher
  ```
  If a build is mid-flight when you stop it, pm2 waits up to 30 seconds for the
  current tick to finish, then force-kills it. That's safe — any half-done build
  was in an isolated workspace and nothing was pushed. It gets reclaimed
  automatically the next time the dispatcher starts.

- **Full reset:**
  ```powershell
  pm2 delete mc-dispatcher
  pm2 start ecosystem.config.cjs
  pm2 save
  ```

---

## Env note

The dispatcher reads `.env.local` itself for Supabase and Telegram secrets — you
don't put secrets in `ecosystem.config.cjs`. That file only sets
`DISPATCHER_EXECUTOR` and `DISPATCHER_SKIP_PERMISSIONS`.

`DISPATCHER_EXECUTOR` ships as `docker`: every build runs inside a throwaway
container that can only reach an allowlist of hosts. **Before the dispatcher can
build anything, run `npm run executor:net`** (check with `npm run
executor:net:status`). If the network or proxy is missing, the dispatcher refuses
to build rather than running a build with open internet access — that is
deliberate. `DISPATCHER_SKIP_PERMISSIONS` ships as `0`; leave it there.

If Supabase or Telegram variables are missing from `.env.local`, the dispatcher
will still start but DB reads/writes or Telegram pings will fail — check
`pm2 logs mc-dispatcher` for errors mentioning those.

---

## Troubleshooting

**Dispatcher not picking up queued requests:**
1. `pm2 status` — is it `online`?
2. `pm2 logs mc-dispatcher` — any errors?
3. Confirm `.env.local` in the project root has the Supabase service role key set.

**Status shows "errored" or it keeps restarting in a loop:**
```powershell
pm2 logs mc-dispatcher --err
```
Read the error output — it will point at the actual failure (bad env var,
missing dependency, etc.). Fix that, then `pm2 restart mc-dispatcher`.

**Still stuck:** call David with the output of `pm2 status` and
`pm2 logs mc-dispatcher --err` — don't guess further.

---

## If the dispatcher is missing entirely (not crashed — *gone*)

**Symptom:** `npx pm2 list` is empty, or pm2 prints `[PM2] Spawning PM2 daemon` before it
answers. That means the pm2 daemon itself died (reboot, logoff, or it was killed), taking
every managed process with it. `pm2 save` writes `~/.pm2/dump.pm2`, but **nothing replays
that dump on its own** — Windows has no `pm2 startup` equivalent.

Observed 2026-08-13: the relay had been dead for hours and every surface that reports health
looked fine, because the thing that reports is the thing that was down. Docker Desktop was
also down (`AutoStart=false`), so a bare `pm2 resurrect` would have come up straight into
`[sandbox] DOWN`.

**One command fixes all of it — idempotent, safe to run any time:**
```
powershell -NoProfile -ExecutionPolicy Bypass -File scripts\rig-boot.ps1
```
It starts Docker Desktop and waits for the daemon, brings up the executor egress network and
proxy, and runs `pm2 resurrect`. Order is deliberate: the dispatcher starts last, into a
working sandbox, instead of alerting and waiting.

**Resurrect is not a start.** It restores the *saved* state, and after an idle sleep that
state is `stopped` — `rig-sleep.ps1` stops the entry and `autorestart` is `false` on purpose.
So the wake path then reads the real pm2 state and acts on it: restarts a saved-stopped or
errored `mc-dispatcher`, starts it from `ecosystem.config.cjs` if there is no entry at all,
and leaves it alone if it is already online (it may be mid-build). It then **verifies**, and
**exits non-zero** unless `mc-dispatcher` is genuinely `online` — a wake that reports success
over a dead relay is what an operator stops checking. Everything lands in `rig-boot.log`
(gitignored).

**It also runs automatically at logon**, as scheduled task `MC Rig Boot`.
```
# inspect / run / remove
Get-ScheduledTask -TaskName 'MC Rig Boot'
Start-ScheduledTask  -TaskName 'MC Rig Boot'
Unregister-ScheduledTask -TaskName 'MC Rig Boot' -Confirm:$false
```

**Still true:** the rig only runs while David is logged in. This is a logon task, not a
service, and deliberately so — the dispatcher needs the user session's Claude credentials
(`~/.claude/.credentials.json`) and a user-session Docker Desktop. A SYSTEM-level service
would have neither.
