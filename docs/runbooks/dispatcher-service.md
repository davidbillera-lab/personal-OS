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
