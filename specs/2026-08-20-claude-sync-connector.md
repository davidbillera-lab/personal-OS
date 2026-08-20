# Spec: claude.ai Mission Control connector — "sync" scope on the OAuth facade

**Date:** 2026-08-20
**Author:** Claude Code (Fable 5) — design complete, edits blocked by auto-mode permission classifier (OAuth files are security-critical); execute in an interactive session with edit approval.
**Estimated execution:** ~30 min for any agent with this spec + edit permissions.

---

## Context / root cause (verified 2026-08-20)

- The claude.ai "Mission Control MCP" connector is configured with URL `https://personal-os.vercel.app/api/mcp` — **that subdomain belongs to someone else's Vercel app** (their sign-in page 307s; their Cloudflare 502s). It was never David's deployment.
- David's real deployment is healthy: `https://personal-os-jsg1.vercel.app/api/mcp` answers JSON-RPC (verified: 41 tools with the full bearer key). Team `jsg1`, project `personal-os`.
- Even with the URL corrected, the claude.ai connector cannot authenticate: the OAuth facade (spec 2026-07-30) is deliberately ChatGPT-only — DCR accepts only `chatgpt.com/connector/oauth/*` callbacks and mints only `liaison`-scope tokens (request-queue tools). A Claude client needs MC sync tools.
- Bonus bug: `OAUTH_ISSUER` and `MCP_RESOURCE_URL` are set to the `personal-os-git-main-jsg1.vercel.app` branch alias (verified via `/.well-known/oauth-authorization-server`). Spec-compliant OAuth clients can reject the issuer mismatch when discovering from the canonical domain.

## Design (locked by this spec)

New token scope **`sync`** for the claude.ai connector, on the existing facade — same consent passcode gate, same PKCE, same audit path:

- **`sync` = every read-scoped tool + exactly three writes:** `mc_claim_task`, `mc_complete_task`, `mc_update_project_status` (the session bookends). **No vault credential access** — `mc_get_credential` / `mc_capture_credential` / `mc_write_vault` are write-scoped and stay invisible. Widening later = adding a name to `SYNC_EXTRA_TOOLS`, never loosening checks.
- **Claude callbacks are exact-match**, no prefix wildcard, no bootstrap mode: `https://claude.ai/api/mcp/auth_callback` and `https://claude.com/api/mcp/auth_callback`.
- **Connector decides scope at registration:** all-Claude redirect set → client row `scope='sync'`; mixed ChatGPT+Claude set → rejected. `/token` mints from the client row's scope (`grantForClientScope`), actor `claude-ai` stamped in the audit log.
- One OAuth resource surface for both connectors: `/api/mcp-liaison` reads scope+sub from the verified JWT claims instead of hardcoded `liaison`/`chatgpt-liaison`.
- `/api/mcp` (static bearer keys) and the local stdio server are untouched.

## File-by-file edits

Anchors are exact as of commit `dcb2708`. All files CRLF.

### 1. `lib/mcp-tools.ts` (4 edits)

- `McpTokenScope` union: append `| 'sync'`.
- After the `ORCHESTRATOR_EXTRA_TOOLS` set, add:
  ```ts
  // The only write tools a 'sync' token adds on top of the read set — the
  // Mission Control session bookends for the claude.ai connector: claim a task,
  // complete it, update project status. Widen ONLY by adding a name here, never
  // by loosening the checks below. Credential reads stay impossible:
  // mc_get_credential is write-scoped and deliberately not in this set.
  export const SYNC_EXTRA_TOOLS = new Set<string>([
    'mc_claim_task',
    'mc_complete_task',
    'mc_update_project_status',
  ])
  ```
- `toolsForScope`: after the orchestrator line add
  `if (tokenScope === 'sync') return MCP_TOOLS.filter(t => t.scope === 'read' || SYNC_EXTRA_TOOLS.has(t.name))`
- `isToolAllowed`: after the orchestrator line add
  `if (tokenScope === 'sync') return tool?.scope === 'read' || SYNC_EXTRA_TOOLS.has(name)`

### 2. `lib/oauth.ts` (10 edits)

- After `CHATGPT_REDIRECT_PREFIX`, add `CLAUDE_REDIRECT_URIS` (exact set of the two callbacks above), `CONNECTOR_GRANTS = { chatgpt: { scope: 'liaison', sub: 'chatgpt-liaison' }, claude: { scope: 'sync', sub: 'claude-ai' } } as const`, types `ConnectorId` / `OAuthTokenScope` / `TokenGrant`, plus:
  ```ts
  export function grantForClientScope(scope: string): TokenGrant {
    return scope === 'sync' ? CONNECTOR_GRANTS.claude : CONNECTOR_GRANTS.chatgpt  // unknown/legacy → narrowest
  }
  export function connectorForRedirects(uris: string[]): ConnectorId | null {
    if (uris.every(u => CLAUDE_REDIRECT_URIS.has(u))) return 'claude'
    if (uris.every(u => !CLAUDE_REDIRECT_URIS.has(u))) return 'chatgpt'
    return null  // straddling set — rejected by /oauth/register
  }
  ```
- `isRegistrableRedirectUri`: first line becomes `if (CLAUDE_REDIRECT_URIS.has(uri)) return true` (exact-match set, independent of `chatgptRedirectUri`/bootstrap).
- `createOAuthClient`: add optional `scope?: OAuthTokenScope` param; insert `scope: params.scope ?? 'liaison'`.
- `insertAuthCode` + `issueRefreshToken`: same optional `scope` param, `scope: params.scope ?? 'liaison'` in the insert.
- `signAccessToken(cfg)` → `signAccessToken(cfg, grant: TokenGrant = CONNECTOR_GRANTS.chatgpt)`; claims use `grant.sub` / `grant.scope`.
- `verifyAccessToken`: scope check becomes `claims.scope !== 'liaison' && claims.scope !== 'sync'`.

### 3. `app/oauth/register/route.ts` (3 edits)

- Import `connectorForRedirects, CONNECTOR_GRANTS`.
- After the per-URI registrable check, before `createOAuthClient`:
  ```ts
  const connector = connectorForRedirects(redirectUris as string[])
  if (!connector) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris must all belong to a single connector' },
      { status: 400 }
    )
  }
  ```
  and pass `scope: CONNECTOR_GRANTS[connector].scope` to `createOAuthClient`.
- Response `scope: 'liaison offline_access'` → `` scope: `${client.scope} offline_access` ``.

### 4. `app/oauth/authorize/route.ts` (7 edits)

- Import `grantForClientScope, type OAuthClient, type OAuthTokenScope`.
- CSP `form-action`: add `https://claude.ai https://claude.com` after `https://chatgpt.com` (approval 302s the code to the connector's callback; without this the browser blocks it).
- `validateClientAndRedirect` returns `{ ok: true; client: OAuthClient }` (it already fetches the client; return it).
- `validateRequest(p, cfg, clientScope)`: default scope `p.scope || clientScope`; allowed set = `{clientScope, 'offline_access'}`; error text names `clientScope`.
- `renderConsent(p, cfg, clientScope, status, errorMsg)`: title `sync` → "Authorize Claude (Mission Control sync)", can-do list for sync = "Read Mission Control (projects, tasks, queue, vault knowledge)" + "Claim/complete tasks and update project status (session bookends)". The "cannot read credentials" line stays true for both scopes.
- GET and POST: `const clientScope = grantForClientScope(gate.client.scope).scope` after the gate; thread into `validateRequest` / `renderConsent` (incl. the 401 incorrect-passcode re-render).
- `insertAuthCode`: add `scope: clientScope`.

### 5. `app/oauth/token/route.ts` (3 edits)

- Import `getOAuthClient, grantForClientScope`.
- Both grant paths (refresh + auth-code): `const client = await getOAuthClient(<clientId>)`, `const grant = grantForClientScope(client?.scope ?? 'liaison')`, `signAccessToken(cfg, grant)`, response `scope: grant.scope`. Auth-code path also passes `scope: grant.scope` to `issueRefreshToken`.

### 6. `app/api/mcp-liaison/route.ts` (5 edits)

- Delete module consts `SCOPE` / `ACTOR`. Add `SYNC_INSTRUCTIONS` (one-liner: read state; only writes are the three bookends).
- After the revocation check: `const scope = (verdict.claims.scope === 'sync' ? 'sync' : 'liaison') as 'liaison' | 'sync'` and `const actor = verdict.claims.sub || (scope === 'sync' ? 'claude-ai' : 'chatgpt-liaison')`.
- `logAudit` gains a leading `actor` param (mirrors `/api/mcp`); update all 4 call sites.
- `initialize`: `serverInfo.name` = `mission-control-sync` for sync; `instructions` = `SYNC_INSTRUCTIONS` for sync, `LIAISON_INSTRUCTIONS` otherwise.
- `tools/list` → `toolsForScope(scope)`; `isToolAllowed(toolName, scope)`; `callTool(toolName, toolArgs, actor)`.

### 7. `.well-known` routes (2 one-liners)

- `oauth-authorization-server`: `scopes_supported: ['liaison', 'sync', 'offline_access']`.
- `oauth-protected-resource`: `scopes_supported: ['liaison', 'sync']`.

### 8. NEW `tests/oauth-sync-scope.test.ts`

Vitest, no env needed (construct `OAuthConfig` literal; `jwtSecret: 's'.repeat(32)`). Cover:
- Both Claude callbacks registrable with bootstrap off + no `CHATGPT_REDIRECT_URI`; lookalikes (`…/auth_callback/extra`, `claude.ai.evil.com`) rejected.
- `connectorForRedirects`: claude / chatgpt / mixed→null.
- `signAccessToken(cfg, CONNECTOR_GRANTS.claude)` verifies valid with scope `sync`, sub `claude-ai`; default grant still liaison.
- `toolsForScope('sync')` write tools === exactly the three bookends; `isToolAllowed('mc_get_credential','sync')` false.

## Env changes (Vercel CLI is authed as davidbillera-3794 — run from repo root)

Sequence WITH the code deploy (one redeploy picks up both):

```
vercel env rm OAUTH_ISSUER production -y
printf 'https://personal-os-jsg1.vercel.app' | vercel env add OAUTH_ISSUER production
vercel env rm MCP_RESOURCE_URL production -y
printf 'https://personal-os-jsg1.vercel.app/api/mcp-liaison' | vercel env add MCP_RESOURCE_URL production
```

**Tradeoff (accepted):** existing ChatGPT liaison tokens carry the old git-main `iss`/`aud` → they die on deploy; reconnect ChatGPT once (consent passcode). Leaving the mismatch risks claude.ai rejecting discovery — canonical wins.

## Verify after deploy

1. `npm test` + `npm run build` pass locally BEFORE pushing (push to main = auto-deploy; a broken build takes the ChatGPT liaison down).
2. `curl https://personal-os-jsg1.vercel.app/.well-known/oauth-authorization-server` → issuer canonical, scopes include `sync`.
3. DCR probe: POST `/oauth/register` with `{"redirect_uris":["https://claude.ai/api/mcp/auth_callback"],"token_endpoint_auth_method":"none"}` → 201 with `scope: "sync offline_access"`. With `["https://evil.example/cb"]` → 400.
4. Regression: `/api/mcp` with the full bearer key still lists 41 tools.
5. Log a decisions.md entry (facade extended to Claude, sync scope contents, env canonicalization).

## Operator steps (David, after deploy)

1. claude.ai → Settings → Connectors → Mission Control MCP → set URL to **`https://personal-os-jsg1.vercel.app/api/mcp-liaison`** → Connect → approve on the consent screen with the operator passcode.
2. Reconnect the ChatGPT liaison once (old tokens invalidated by the issuer fix).
3. Optional later: widen the Claude scope by adding tool names to `SYNC_EXTRA_TOOLS`.
