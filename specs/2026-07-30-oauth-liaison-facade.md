# Phase 1 Piece 3 — OAuth 2.1 + PKCE facade for the ChatGPT liaison

**Status: build spec — execute in a FRESH Claude Code session.** Governing context: `specs/2026-07-28-mc-ai-orchestration-layer.md`, `decisions.md` (2026-07-30 entries), vault `59bbf2b2` / `d80be519` / `0b6bb199`.

## Objective
Give ChatGPT Work Voice an **authenticated** path to the Mission Control liaison tools. ChatGPT cannot present a static Bearer key (confirmed — its connector offers only OAuth / No-Auth / Mixed), so this piece builds an OAuth 2.1 authorization-code + PKCE facade that maps a valid ChatGPT token to the `chatgpt-liaison` identity with **liaison-only** scope. No production write is exposed to ChatGPT until a compliant OAuth flow verifies end-to-end.

## Current state (pieces 1+2, already shipped — do NOT rebuild)
- **Endpoint:** `app/api/mcp/route.ts` — JSON-RPC 2.0 over POST (`initialize` / `notifications/initialized` / `tools/list` / `tools/call`), Next.js 16 on Vercel, `runtime = 'nodejs'`.
- **Auth model:** `resolveAuth(req) → { scope, actor } | null`. Scopes: `full` (MCP_API_KEY), `liaison` (MCP_LIAISON_KEYS map), `read` (legacy MCP_READONLY_API_KEY → "hermes" + MCP_READONLY_KEYS map). Key maps parsed by `parseKeyMap()` (rejects non-object JSON). Every tool call stamped in `mcp_audit_log` via `logAudit(actor, tool, ok, error)`.
- **Scope gating (`lib/mcp-tools.ts`):** `LIAISON_TOOLS` = Set of the 5 request tools. `toolsForScope('liaison')` and `isToolAllowed(name,'liaison')` = that set only. `callTool()` dispatches all tools. **Reuse this — the OAuth path must resolve to scope `liaison` and go through the SAME `isToolAllowed` + `callTool`.**
- **Liaison tools (5):** `mc_submit_request` (write) + `mc_get_request_status` / `mc_list_recent_requests` / `mc_whats_stalled` / `mc_get_result` (read). **Worker tools (7)** and vault/credential tools are `write`/`full` scope — MUST stay invisible + forbidden to liaison (already enforced; keep it that way).
- **Queue:** `mc_requests` table (migration 017), Supabase project ref `dmtctlpzlfpcogpjweuv`. Apply new migrations via the Supabase MCP `apply_migration`.
- **Static liaison keys** (`.env.local`, and MCP_READONLY_KEYS in Vercel prod) are **curl/internal only** — never the ChatGPT connector credential.
- **Probe** `app/api/mcp-probe/route.ts` (no-auth) **stays live until the authenticated production connection passes**, then is removed.

## Deploy / test reality (important gotchas)
- Public reachability is via the **git-main alias** `personal-os-git-main-jsg1.vercel.app` only (apex `personal-os.vercel.app` has Deployment Protection → 307 to signin for bearer/OAuth calls). **The git-main alias is PINNED and does NOT follow pushes** — after each push, move it: `vercel alias set <new-deployment-url> personal-os-git-main-jsg1.vercel.app` (David authorizes Vercel). See vault/memory `vercel-git-main-alias-pinned`.
- Verify transport as an MCP Streamable-HTTP client (the probe proved the shape works). ChatGPT negotiates protocol **`2025-11-25`**; `/api/mcp` currently hard-codes `2024-11-05` in `initialize` — **apply the protocol-version negotiation fix** (echo `params.protocolVersion`, as `app/api/mcp-probe/route.ts` already does).

## Requirements (from ChatGPT/David, binding)
- Implement **protected-resource metadata** (`/.well-known/oauth-protected-resource`, RFC 9728) and **authorization-server metadata** (`/.well-known/oauth-authorization-server`, RFC 8414).
- Implement **DCR** (RFC 7591), **`/authorize`**, **`/token`**. Use DCR + PKCE unless testing shows the Business workspace requires CIMD or a pre-registered client.
- **Require PKCE S256.**
- Preserve + validate the OAuth **`resource`** parameter (RFC 8707); bind the token **audience** to the production MCP resource; verify `aud` on every MCP request.
- Map a valid ChatGPT token **only** to `chatgpt-liaison` + liaison scope. Worker, vault, credential, admin tools stay inaccessible.
- **Short-lived** authorization codes and access tokens; **prevent auth-code reuse**; **validate redirect URIs exactly**.
- **Do not hardcode/guess ChatGPT's callback URL** — make it a configurable env var and WAIT for the exact URL from the ChatGPT draft-app screen (`https://chatgpt.com/connector/oauth/{callback_id}`).
- **No production write exposed without a successfully verified OAuth flow.** If a compliant flow can't be completed, STOP before exposing write and report the exact blocker.
- Apply the MCP `2025-11-25` protocol-version fix.
- **Mandatory code-reviewer cross-check + Codex QC before deploy** (credential boundary).
- Preserve the probe until the authenticated production connection passes.

## Design guidance (fresh session decides specifics with repo in hand)
- **Routes** (Next.js App Router): `app/.well-known/oauth-protected-resource/route.ts`, `app/.well-known/oauth-authorization-server/route.ts`, `app/oauth/register/route.ts` (DCR), `app/oauth/authorize/route.ts`, `app/oauth/token/route.ts`. A dedicated **OAuth-gated MCP route** for ChatGPT (e.g. `app/api/mcp-liaison/route.ts`) that verifies the token → sets scope `liaison`, actor `chatgpt-liaison` → calls the existing `isToolAllowed`/`callTool`/`logAudit`. Keep `/api/mcp` (bearer, workers) and the probe untouched.
- **Tokens:** prefer **signed JWT access tokens** (HS256/RS256 with a server secret, `aud` = MCP resource, `scope=liaison`, short `exp`) → stateless verification, no token table. **Auth codes + DCR clients need storage** → a migration (e.g. `oauth_clients`, `oauth_auth_codes` with single-use + short TTL). Decide refresh-token/`offline_access` support (ChatGPT prefers it; acceptable to defer to a hardening pass if access-token re-consent is tolerable — flag the choice).
- **Consent screen:** a minimal `/authorize` approval page ("Authorize ChatGPT liaison — read Mission Control status + submit requests. No code, deploy, credentials, or spend.").
- Env vars (names only): e.g. `OAUTH_JWT_SECRET`, `OAUTH_ISSUER`, `MCP_RESOURCE_URL`, `CHATGPT_REDIRECT_URI` (the callback — set AFTER David supplies it). No secrets in code/logs/commits.

## Test matrix (must pass before deploy)
Invalid/expired token → 401; wrong audience → reject; missing/invalid PKCE → reject; reused auth code → reject; incorrect redirect URI → reject; insufficient scope (liaison calling a worker/vault/credential tool) → 403; unauthorized tool access → 403; happy path (authorize → code → token → `tools/list` = 5 liaison tools → `mc_submit_request`) → success + audit row actor `chatgpt-liaison`.

## Report back to David when the deployed endpoint is ready (STOP here)
1. Exact production MCP URL. 2. Env-var names (no values). 3. DB migrations required. 4. Exact steps to create the ChatGPT draft app. 5. The point where David copies the generated callback URL. 6. Expected OAuth consent screen. 7. Tests completed + results. 8. Anything still requiring David's action.
Then: after David supplies the exact callback URL, finish the redirect allowlist config and run the authenticated connection test. If the compliant OAuth connection can't complete, STOP before exposing write and report the exact blocker.
