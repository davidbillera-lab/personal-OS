# Hermes Ambient Layer — Design Spec

**Date:** 2026-07-16
**Status:** Approved, ready for implementation plan
**Project:** Personal OS / Mission Control (`698d6376-5819-400b-babc-cd664ee36c04`)

---

## Problem

Standing Rule #3 in `CLAUDE.md` states: *"Every kill criteria check that comes back 'fail' gets surfaced to the operator within 24 hours."*

**There is no mechanism that does this today.** Nothing in the stack can reach the operator outside of an open agent window. Claude Code and Codex are session-bound — they exist when a window is open and die when it closes. The rule is currently aspirational.

Hermes is the only always-on component in the stack: it has a cron scheduler, persistent memory, and a bridge to Telegram/Discord/Slack/WhatsApp/Signal.

## Role decision: Hermes is the ambient layer

Hermes owns always-on work that Claude Code structurally cannot do. It is **not** another builder — Claude Code and Codex already cover that, and duplicating it would create a tool turf war over the same OpenRouter models the operator already has.

Rejected alternatives:
- **Peer harness** — duplicates Claude Code; no new capability.
- **Portfolio asset** — Hermes is open-source infrastructure the operator did not write. Nothing to exit. No MC project entry, no kill-criteria.md.

## Prior art already in place (do not rebuild)

Hermes is ~70% incorporated already:

- **Vault entry exists** — `vault_items` id `cfe3faff-8a7b-4922-b1e1-f7dd1be7337b`, type `agent`. Profiles, paths, quirks documented.
- **Hermes is already an MCP client of MC** — holds the full token, 16 `mc_*` tools.
- **Hermes is already an MCP server** wired into `.mcp.json` (**uncommitted** — this is the `M .mcp.json` in git status).
- **Read-scope token layer is fully built and dormant** — `lib/mcp-tools.ts:235-245` (`toolsForScope`, `isToolAllowed`), enforced at `app/api/mcp/route.ts:107`. Per-tool `scope: 'read' | 'write'`, filtered from `tools/list` AND rejected at the route (defense in depth). The comment at `lib/mcp-tools.ts:7` reads: *"safe to expose to low-trust clients (e.g. a phone connector)."* A prior session built this exact door and never opened it.
- **`/api/kill-criteria` route exists** — the check engine is built.
- **`MCP_READONLY_API_KEY` is unset** — read scope is therefore inactive. Turning it on is config, not code.
- **No `vercel.json`** — no cron exists yet.

## Architecture — two lanes sharing a surface, not code

### Lane 1 — Delivery (Vercel, always-on)

`vercel.json` cron → `GET /api/alerts/digest` (new) → queries `projects` → posts to Telegram Bot API.

No Hermes dependency. Fires whether the operator's PC is on, off, or asleep. **This is what makes Standing Rule #3 enforceable.**

### Lane 2 — Conversation (Hermes, local, best-effort)

Operator replies to the alert in Telegram → Hermes (already the Telegram bridge) picks it up via its existing `events_poll` / `messages_read` tools → answers from the vault through read-scoped `mc_*` tools.

### Why two lanes

**Constraint:** Hermes runs locally (desktop app at `C:\Users\david\AppData\Local\hermes\`, dashboard `127.0.0.1:9119`). Mission Control runs on Vercel. **MC cannot push to Hermes** — Hermes must poll, and when the PC is off Hermes is not running.

A Hermes-owned loop would silently fail to alert whenever the rig is down, quietly breaking the rule it exists to enforce. Splitting delivery from conversation gives each piece the job it is actually good at.

**Graceful degradation:** Hermes down → alert still delivers, reply just goes unanswered. No silent hole.

### Shared bot token

Both lanes use the **same Telegram bot token already in Hermes's `.env`**. Because Hermes already listens on that bot, an operator reply lands in Hermes with zero routing code. Vercel needs only a copy of `TELEGRAM_BOT_TOKEN` plus `TELEGRAM_CHAT_ID`.

## Trust posture — this tightens Hermes

**Correction (found by Hermes, 2026-07-16):** The original build order said "repoint Hermes to the read token." That was wrong. Hermes connects to MC over **local stdio** (`node ./mcp-server.mjs`), and `mcp-server.mjs` enforces **no auth and no scope** — it serves every tool to any local caller. A read token over stdio does nothing. The read-scope layer only exists on the **HTTP** path (`app/api/mcp/route.ts`).

The real downgrade is a **transport switch**: move the GPT Hermes profile's `mission-control` server from local stdio to the production HTTPS endpoint `https://personal-os.vercel.app/api/mcp` with `Authorization: Bearer <MCP_READONLY_API_KEY>`. Only then do `mc_get_credential` and every write path cease to exist for Hermes — filtered from `tools/list` and rejected at the route even if the tool name is guessed.

Note: local stdio remains full-access for trusted builder clients (Claude Code). The scope boundary is an HTTP-path property by design; this is fine because stdio requires local machine access.

This honors the 2026-07-12 decision (`decisions.md`) exactly as written: *"If Hermes becomes a regular tool-caller, consider issuing it a separate 'read'-scope token instead of reusing the 'full' token."* Hermes gets a bigger job and less access on the same day. Access is revisited only on track record.

## Model / cost note — conversational lane runs on subscription

The lane that answers Telegram replies is the **GPT Hermes profile** (`gpt-5.6-sol` via OpenAI Codex OAuth / ChatGPT subscription), **not** the Opus default the vault entry records. This is deliberate: replies run flat-rate against the subscription, not metered per-token. Docs must state this explicitly so a future session doesn't "fix" it back to Opus and start metering.

## Digest content

One Telegram message, **Tier 1 projects first**, containing only actionable items:

| Bucket | Condition |
|---|---|
| Kill risk | `kill_criteria_status = 'fail'` |
| Blocked | `blockers` non-empty |
| Stale | `last_update` older than **14 days** AND `next_action` present |

**Exclusions:** projects at `stage = 'kill'` (already dead, not news).

**All-clear behavior:** if all three buckets are empty, send nothing and exit 200. Silence means all-clear.

### Cadence

**Daily, suppressed when there is nothing to say.**

Rationale: alert fatigue is the failure mode that kills every alert system. A daily ping repeating the same three stale fails gets muted, and a muted alert breaks Standing Rule #3 *silently* — worse than aspirational, it becomes theater. Every message that arrives must be real.

Rejected: **on-change only** (costs a `last_alerted` dedupe column; an unresolved fail would never nag again). **Daily heartbeat incl. all-clear** (fastest path to muting).

Accepted risk: a quiet week is indistinguishable from a broken cron. Deferred — revisit only if it bites.

## Safety

- **`CRON_SECRET` bearer check** on `/api/alerts/digest`. The route is a public URL on Vercel; without the check, anyone who guesses the path can spam the operator's phone. Vercel cron sends the header automatically. Fail closed.
- **Telegram send failure:** log and exit. No retry-storm. The next day's cron is the retry.
- **Supabase access:** `createAdminSupabaseClient()` (per project Standing Rule #8).

## Testing

One runnable check on the digest builder (pure function, separated from the Telegram POST):

1. Given fixture project rows across all three buckets → produces the expected message, Tier 1 ordered.
2. Given all-clear fixture rows → returns null.

The Telegram POST itself is not worth mocking.

## Poller collision — move Telegram, do not copy (hardening)

Hermes's plan copies the bot token onto the GPT profile and leaves it on the default profile, relying on "keep the default gateway stopped." Per `hermes-config-layout` memory, the desktop app auto-starts backends per-profile and reaps them after 600s idle — so the default gateway can wake on its own. Two pollers on one bot token → Telegram 409 conflict → alerts and replies silently break.

**Fix:** *move* Telegram to the GPT profile — strip it from the default profile entirely. One bot, one poller.

## Executor split (decided 2026-07-16)

Per HQ-window-workflow + credential-trust rules, production surface stays with the proven builder:

- **Claude Code (fresh build window)** — Tasks 1–5 + 7: digest builder + tests, `/api/alerts/digest` route, `vercel.json` cron, `.mcp.json` commit, docs, Vercel production env vars, deploy, production verification.
- **Hermes (self-configuration only)** — Task 6: switch its own GPT-profile `mission-control` transport from stdio to the read-only HTTPS endpoint, and take over the Telegram lane (move, not copy). Hermes only ever touches its own config.

## Build order

1. **[Claude Code]** Build `/api/alerts/digest` (pure digest builder + tests, Telegram POST, `CRON_SECRET` auth) and `vercel.json` cron entry.
2. **[Claude Code]** Generate + set `MCP_READONLY_API_KEY`, `CRON_SECRET`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_CHAT_ID` in Vercel production env. Deploy.
3. **[Claude Code]** Verify the production read-only endpoint: `tools/list` returns only the 9 read-scoped tools; a guessed write call 403s.
4. **[Claude Code]** Commit the `.mcp.json` Hermes wiring; document ambient role in `CLAUDE.md` + `AGENTS.md`; log role + trust + transport-correction decisions in `decisions.md`; update the vault agent entry.
5. **[Hermes]** Switch GPT-profile `mission-control` from stdio to the HTTPS read-only endpoint; move Telegram onto GPT (strip from default); restart gateway; verify from a fresh process that only 9 read tools appear and Telegram runs under GPT.
6. **[Claude Code]** End-to-end + graceful-degradation test (stop GPT gateway, confirm alert still delivers); MC closeout.

## Out of scope (future sub-projects)

The ambient layer is three independent subsystems. Only the first is specced here; each gets its own spec → plan → implementation cycle.

- **Inbound capture** — text a brain dump to Telegram → Haiku classifies → lands in MC inbox routed to a project. Needs write access to `brain_dumps`. Highest daily value; next in line.
- **Autonomous cron tasks** — Hermes runs scheduled agentic work and reports. Most blast radius; needs an established Hermes track record first.

The build order above is also the trust ladder: each subsystem needs strictly more access than the last, letting Hermes earn trust by track record rather than by up-front grant.
