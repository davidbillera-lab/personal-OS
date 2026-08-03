# Runbook — Repoint the ChatGPT connector alias

**When:** After any production deploy that ChatGPT needs to talk to (most importantly after Codex ships a new liaison/MCP deploy). Symptom that you forgot: ChatGPT connects but is missing a tool you just shipped, or the connection stalls.

**Why this exists:** The connector talks through `personal-os-git-main-jsg1.vercel.app`. That alias was once set by hand (`vercel alias set`), which permanently turned OFF Vercel's auto-follow — so it stays frozen on an old deploy until someone repoints it. This is the fix for that chore.

## Do it (one command)

```bash
node scripts/repoint-alias.mjs
```

Points the alias at the **newest READY production deploy**. Prints what it did.

## Options

```bash
node scripts/repoint-alias.mjs --dry-run        # show what it would do, change nothing
node scripts/repoint-alias.mjs <deployment-url> # pin a specific deploy instead of latest
node scripts/repoint-alias.mjs --dry-run <url>  # preview a specific pin
```

Use `--dry-run` first if you're unsure which deploy is newest. Use the explicit `<url>` form when you deliberately want an *older* deploy live (e.g. rolling back the connector without touching the deploy itself).

## Notes

- Uses the `vercel` CLI already logged in on the rig — **no token stored anywhere.** If it errors with an auth message, run `vercel login` once.
- Safe to run repeatedly; it just re-sets the pointer.
- Defaults (project `personal-os`, alias `…-git-main-jsg1.vercel.app`, scope `jsg1`) are overridable via `ALIAS_TARGET` / `VERCEL_PROJECT` / `VERCEL_SCOPE` env vars.
- This does **not** fix the underlying manual-pin state — it makes living with it a one-liner. Restoring native auto-follow would mean removing the manual alias assignment, which risks breaking the live connection, so we deliberately don't.
