---
name: mission-control-context
description: Load Mission Control context before Codex builds in David's portfolio. Use at session start, cold pickup, cross-project work, when the user references prior work, or before touching code in personal-os, VZT, College Climb, FlipRadar, REELFLOW, or any JSG project. Adapts Claude skills vault-recall, session-context, and mission-control for Codex.
---

# Mission Control Context

Recall durable context before reading code. The vault explains why; the repo shows what.

## Preferred Path: MCP Tools

If Mission Control MCP tools are available:

1. Call `mc_get_project_context` with the project `mission_control_id` when known.
2. Call `mc_get_vault_context` with a one-sentence query containing project + task.
3. Browse recent durable context when useful:
   - `mc_browse_vault({ type: "decision_log", limit: 10 })`
   - `mc_browse_vault({ type: "build_spec", limit: 5 })`
   - `mc_browse_vault({ type: "agent_session", limit: 5 })`
4. Fetch full content only for one specific relevant item using `mc_get_vault_item`.

Keep the two-step pattern: cheap previews first, one full item only when needed.

## Fallback Path: Local Repo Files

If MCP tools are unavailable, say so once if it matters, then use local sources:

1. `AGENTS.md`
2. `CLAUDE.md`
3. `decisions.md`
4. `.claude/checkpoint.md` if resuming
5. Relevant docs/specs/plans
6. Targeted `rg` searches for symbols, routes, tables, or files

Do not block on missing MCP. Do not ask David for context that is already in local files.

## Credentials

Credentials live encrypted in Mission Control or local env files. Never print secret values. Use credential names only in handoffs and plans. Use `mc_get_credential` only when the tool exists, access is appropriate, and the task actually needs the secret value.

## Session End

For substantive work, update Mission Control if tools are available:

- `mc_update_project_status` with a one-sentence status and a specific next action.
- `mc_complete_task` if a task was claimed through MC.

If MC cannot be reached, report that and keep Git/repo state correct.

