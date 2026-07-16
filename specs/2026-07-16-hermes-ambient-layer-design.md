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

Hermes currently holds the **full** MC token. Under this design it is repointed to `MCP_READONLY_API_KEY`.

This is a **downgrade**: `mc_get_credential` and every write path cease to exist for Hermes — filtered from `tools/list` and rejected at the route even if the tool name is guessed.

This honors the 2026-07-12 decision (`decisions.md`) exactly as written: *"If Hermes becomes a regular tool-caller, consider issuing it a separate 'read'-scope token instead of reusing the 'full' token."* Hermes gets a bigger job and less access on the same day. Access is revisited only on track record.

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

## Build order

1. Generate + set `MCP_READONLY_API_KEY` in Vercel env (activates the dormant read scope).
2. Repoint Hermes from the full token to the read token — the access downgrade. Verify `tools/list` shrinks to read-scoped tools only.
3. Copy `TELEGRAM_BOT_TOKEN` + `TELEGRAM_CHAT_ID` + `CRON_SECRET` into Vercel env.
4. Build `/api/alerts/digest` (digest builder + Telegram POST + cron auth) and `vercel.json` cron entry.
5. Commit the `.mcp.json` Hermes wiring (currently uncommitted).
6. Document Hermes as the ambient layer in `CLAUDE.md`; update the vault agent entry to note read-scope.
7. Log the role + trust decisions in `decisions.md`.

## Out of scope (future sub-projects)

The ambient layer is three independent subsystems. Only the first is specced here; each gets its own spec → plan → implementation cycle.

- **Inbound capture** — text a brain dump to Telegram → Haiku classifies → lands in MC inbox routed to a project. Needs write access to `brain_dumps`. Highest daily value; next in line.
- **Autonomous cron tasks** — Hermes runs scheduled agentic work and reports. Most blast radius; needs an established Hermes track record first.

The build order above is also the trust ladder: each subsystem needs strictly more access than the last, letting Hermes earn trust by track record rather than by up-front grant.
