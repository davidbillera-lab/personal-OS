# Rio watcher: human-in-the-loop work nudges

**Date:** 2026-10-17 · **Status:** approved by David, ready to build · **Decision log:** `decisions.md` 2026-10-17

## Why

The rig dispatcher (`scripts/dispatcher.mjs`) checked MC every 5 seconds and ran builds in Docker. The constant Docker churn made David shut it off entirely. Its Hermes plan-nudge (`nudgeUnplanned()`) went down with it. That nudge was also one-shot: an ignored nudge went silent for good.

Replacement, chosen by David:

- **Rio**, David's Meta Muse agent, checks MC once an hour and messages **David**.
- David relays to Claude Code or Hermes.
- Humans stay in the loop on purpose. Nothing builds autonomously, and the dispatcher stays off.
- The serverless stuck-jobs sweep (`vercel.json`, twice daily, Telegram) stays on as a backstop in case Rio fails silently.

## Decisions (David, 2026-10-17)

| Question | Choice | Accepted tradeoff |
|---|---|---|
| Who gets pinged | David, not an auto-build | Work waits for a human relay |
| Rio key | Keep the existing `orchestrator` key. No rotation, no scope change. | Orchestrator gets every `read` tool, vault search included, plus claim, reassign and submit-plan. Only Rio's instructions keep it watch-only, not the key. |
| Stuck-jobs Telegram sweep | Keep as backstop | Occasional double ping (Rio + Telegram) for the same item |

## Gaps this build closes

1. **Rio can't see the main case.** When Hermes deposits a plan, `mc_submit_plan` leaves the row at `status = 'submitted', phase = 'planned'`. `mc_whats_stalled` (`lib/mcp-tools.ts`) only returns `blocked`, `awaiting_approval` and `failed` rows, plus `claimed`/`in_progress` rows with no update in 30 minutes. So a ready plan never shows up. The stuck-jobs sweep already classifies these rows correctly with `alertBucket()` in `lib/alerts/stuck-jobs.ts`.
2. **Claude Code can't read the plan when David relays.** `mc_get_request` doesn't return `phase` or `plan`. The local stdio MC server (`mcp-server.mjs`) exposes no request tools at all.

## Build (personal-os, one PR, branch off `main`)

1. **`mc_whats_stalled` uses the sweep's classifier.**
   - Select the fields `alertBucket()` needs, and match the sweep's row filter in `app/api/alerts/stuck-jobs/route.ts`, so Rio and the sweep see the same rows.
   - Classify each row with `alertBucket(r, now)`. Rows it returns `null` for still count as `no_progress` if they meet today's "claimed/in_progress, no update in 30 min" rule; otherwise drop them.
   - Keep every field the tool returns today. The ChatGPT liaison connector relies on them.
   - Add three fields:
     - `bucket`: an `AlertBucket` value, or `no_progress`.
     - `reason`: plain English, e.g. "plan ready, not picked up" or "waiting for Hermes's plan".
     - `waiting_minutes`: whole minutes since the row **became actionable** for its bucket. That is the stale threshold added to the anchor timestamp for `stale_*`, `stuck_pushing` and `no_progress`, and `updated_at` for `failed`, `blocked` and `awaiting`. Export the threshold constants from `lib/alerts/stuck-jobs.ts`; don't copy them.
   - Rio's "new since my last check" rule depends on `waiting_minutes < 60` meaning exactly that.
2. **`mc_get_request` returns the plan.** Add `phase`, `plan`, `plan_submitted_at` and `plan_by` to its select and its output.
3. **The local stdio server exposes both tools.** `mcp-server.mjs` has its own `tools[]` list and its own `callTool`. Add `mc_whats_stalled` and `mc_get_request` there with the same behaviour, so Claude Code can answer "check MC" in one call. New and changed MCP tools must stay consistent across `lib/mcp-tools.ts`, `mcp-server.mjs` and `app/api/mcp/route.ts`.
4. **Tests:**
   - A `submitted` + `planned` row past the threshold shows up in `mc_whats_stalled` with `bucket: 'stale_planned'` and a correct `waiting_minutes`.
   - A fresh `blocked` row shows `waiting_minutes` under 60.
   - `mc_get_request` includes `plan`.
   - Run the suite from an uppercase-drive cwd: `cd /c/Users/david/Documents/personal-os && npx vitest run`. Vitest breaks on a lowercase `c:\` cwd. Baseline is 293/293.
5. **Remove the temporary 401 diagnostic.** This is `logRejected` in `app/api/mcp/route.ts`, added in PR #16. Rio has been connecting successfully since 2026-10-16, so remove it in this PR.

**Out of scope:** autonomous builds, dispatcher changes, new key scopes, the Hermes vault-read discrepancy (see Open).

## Operator step (David)

Paste the instructions below into Muse and schedule them hourly. No key work is needed.

Rio already connects with its existing `orchestrator` key. That is the key issued 2026-10-15 01:59 UTC, re-activated at orchestrator scope on 2026-10-16. The spare `full` key was revoked the same day. `mcp_audit_log` shows Rio making successful `mc_queue_status` and `mc_whats_stalled` calls. All three tools Rio needs are `read` tools, which orchestrator includes.

## Rio's instructions (paste into Muse)

```
You are Rio, David's Mission Control watcher. Run this every hour.

1. Call the Mission Control tool mc_whats_stalled. The only other tools you may call are mc_get_request (to read one item) and mc_queue_status. Never submit, assign, approve, resume or start anything. You watch and report; you never act.
2. From the results, keep only items with waiting_minutes under 60. Those are new since your last check. If there are none, send nothing. Silence means all clear.
3. For each new item, send David one short line saying what it is, who it's waiting on, and the next move. Use the first 8 characters of request_id as the ID:
   - stale_planned: "Build spec ready: <title> (<id>). Tell Claude Code to check MC."
   - stale_unplanned: "Waiting on Hermes for a plan: <title> (<id>)."
   - blocked: "Blocked: <title> (<id>), <blocker>."
   - awaiting: "Needs your approval: <title> (<id>)."
   - failed: "Failed: <title> (<id>)."
   - stuck_pushing or no_progress: "Stuck: <title> (<id>), <reason>."
4. On your first run after 8:00 am Mountain time, also send one morning roll-up: every item in the list, oldest first, one line each, even ones you already reported. If the list is empty, skip the roll-up.

Keep it plain. No greetings, no sign-offs, no extra commentary.
```

## Done when

- `mc_whats_stalled` lists a Hermes-planned row 2 hours after the plan lands, with `bucket: 'stale_planned'`.
- Claude Code can pull that plan with `mc_get_request` over its local MC connection.
- Rio's hourly run pings David once per new item and once each morning. It stays silent when nothing is waiting.
- The test suite is green.

## Open (not this build)

- **Hermes vault access.** `CLAUDE.md` says Hermes's orchestrator key can't reach the vault. But orchestrator gets every `read` tool, and `mc_get_vault_context` is `read`. Either the doc or the scope is wrong; decide which.
- **Duplicate Claude Code keys.** `claude-code` has two active `full` keys, issued 2026-10-10 and 2026-10-14. Revoke whichever one is unused.
