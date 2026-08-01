// OAuth 2.1 + PKCE liaison facade — acceptance test matrix.
// Usage: BASE=http://localhost:3000 JWT_SECRET=<OAUTH_JWT_SECRET> node scripts/test-oauth-flow.mjs
// Exercises the happy path plus every negative case in the build spec against a
// running server. Exits non-zero if any case fails. Does not deploy or touch prod.

import { createHash, createHmac, randomBytes } from 'crypto'
import { createClient } from '@supabase/supabase-js'
import { readFileSync } from 'fs'
import { fileURLToPath } from 'url'
import { dirname, join } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// ---- .env.local bootstrap (mirror dispatcher.mjs; repo root is one level up) ----
// Lets the DB-backed rotation cases (reuse/expired/cross-client) age rows via a
// service-role client without the operator exporting anything by hand.
try {
  const raw = readFileSync(join(__dirname, '..', '.env.local'), 'utf8')
  for (const line of raw.split('\n')) {
    const t = line.trim()
    if (!t || t.startsWith('#')) continue
    const eq = t.indexOf('=')
    if (eq < 1) continue
    const k = t.slice(0, eq).trim()
    let v = t.slice(eq + 1)
    if ((v.startsWith('"') && v.endsWith('"')) || (v.startsWith("'") && v.endsWith("'"))) v = v.slice(1, -1)
    if (!(k in process.env)) process.env[k] = v
  }
} catch { /* .env.local absent — rely on already-set env */ }

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '')
// Fall back to the server's own OAUTH_*/MCP_* config (loaded from .env.local
// above) so the full matrix runs with just BASE set — no hand-copying secrets.
const JWT_SECRET = process.env.JWT_SECRET || process.env.OAUTH_JWT_SECRET || ''
const RESOURCE = process.env.RESOURCE || process.env.MCP_RESOURCE_URL || `${BASE}/api/mcp-liaison`
const ISSUER = process.env.ISSUER || process.env.OAUTH_ISSUER?.replace(/\/$/, '') || BASE
const PASSCODE = process.env.PASSCODE || process.env.OAUTH_CONSENT_PASSCODE || ''
const REDIRECT = 'https://chatgpt.com/connector/oauth/test-local'

// Service-role client for the DB-backed cases (revoking/expiring rows directly).
// Null → those cases are skipped.
const SB_URL = process.env.NEXT_PUBLIC_SUPABASE_URL || process.env.SUPABASE_URL || ''
const SB_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY || ''
const db = (SB_URL && SB_KEY) ? createClient(SB_URL, SB_KEY, { auth: { persistSession: false } }) : null
const sha256 = (t) => createHash('sha256').update(t).digest('hex')
const createdClients = []  // every client_id we register — torn down at the end

// DB-mutation safety guard: any path that writes to oauth_refresh_tokens
// directly (revoke/expire seeded rows, cleanup) requires an explicit opt-in
// AND a localhost target, so this script can never be pointed at prod and
// silently mutate real rows. Fails loudly (throws) rather than skipping quietly
// when a service-role key IS present but the guard isn't satisfied.
function assertDbMutationAllowed() {
  if (!db) return false
  let host = ''
  try { host = new URL(BASE).hostname } catch { /* leave empty → fails the check */ }
  const isLocalhost = host === 'localhost' || host === '127.0.0.1'
  const projectRef = (SB_URL.match(/^https:\/\/([^.]+)\.supabase\.co/) || [])[1] || SB_URL
  if (process.env.ALLOW_OAUTH_DB_TEST_MUTATION !== 'true' || !isLocalhost) {
    throw new Error(
      `DB-mutation guard refused: ALLOW_OAUTH_DB_TEST_MUTATION=${process.env.ALLOW_OAUTH_DB_TEST_MUTATION || 'unset'} ` +
      `BASE=${BASE} (host=${host || 'unparseable'}) supabase_project=${projectRef} — ` +
      `requires ALLOW_OAUTH_DB_TEST_MUTATION=true AND a localhost target.`
    )
  }
  console.log(`  DB-mutation guard OK — target=${BASE} supabase_project=${projectRef}`)
  return true
}

let pass = 0, fail = 0
function ok(name, cond, detail = '') {
  if (cond) { pass++; console.log(`  PASS  ${name}`) }
  else { fail++; console.log(`  FAIL  ${name}${detail ? ' — ' + detail : ''}`) }
}

const b64url = (b) => Buffer.from(b).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')

function pkcePair() {
  const verifier = b64url(randomBytes(48))
  const challenge = b64url(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

// Forge a JWT with the server secret to test verification edge cases.
function forgeJwt(claims, { secret = JWT_SECRET, badSig = false } = {}) {
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  let sig = b64url(createHmac('sha256', secret).update(`${header}.${payload}`).digest())
  if (badSig) sig = sig.slice(0, -2) + (sig.endsWith('AA') ? 'BB' : 'AA')
  return `${header}.${payload}.${sig}`
}
const now = () => Math.floor(Date.now() / 1000)
const baseClaims = () => ({ iss: ISSUER, sub: 'chatgpt-liaison', aud: RESOURCE, scope: 'liaison', iat: now(), exp: now() + 600, jti: b64url(randomBytes(8)) })

async function authorizeAndGetCode(clientId, { verifier, challenge }, overrides = {}, passcode = PASSCODE) {
  const qs = new URLSearchParams({
    response_type: 'code', client_id: clientId, redirect_uri: REDIRECT,
    scope: 'liaison', state: 'xyz', code_challenge: challenge,
    code_challenge_method: 'S256', resource: RESOURCE, passcode, ...overrides,
  })
  // POST the consent approval (skips rendering the GET page; server re-validates).
  const res = await fetch(`${BASE}/oauth/authorize`, {
    method: 'POST', redirect: 'manual',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: qs.toString(),
  })
  const loc = res.headers.get('location') || ''
  const code = loc ? new URL(loc).searchParams.get('code') : null
  return { status: res.status, loc, code }
}

async function tokenExchange(body) {
  const res = await fetch(`${BASE}/oauth/token`, {
    method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams(body).toString(),
  })
  return { status: res.status, json: await res.json().catch(() => ({})) }
}

async function rpc(token, method, params) {
  const res = await fetch(`${BASE}/api/mcp-liaison`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...(token ? { Authorization: `Bearer ${token}` } : {}) },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  })
  let json = null
  try { json = await res.json() } catch { /* 204 */ }
  return { status: res.status, json, www: res.headers.get('www-authenticate') }
}

// Register a fresh client and walk the full auth-code flow to get one live
// refresh token. Used to seed independent clients/chains for the reuse cases.
async function newClientWithRefresh(name = 'test-connector-seed') {
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: name }),
  })
  const client_id = (await reg.json()).client_id
  createdClients.push(client_id)
  const pk = pkcePair()
  const auth = await authorizeAndGetCode(client_id, pk, { scope: 'liaison offline_access' })
  const tok = await tokenExchange({ grant_type: 'authorization_code', code: auth.code, redirect_uri: REDIRECT, client_id, code_verifier: pk.verifier })
  return { client_id, refresh: tok.json.refresh_token }
}

async function main() {
  // JWT_SECRET only powers the forged-token cases (expired/wrong-aud/tampered/
  // wrong-secret). Without it, those are skipped so the real flow can be smoke-
  // tested against prod without pulling the server secret.
  const canForge = !!JWT_SECRET
  console.log(`\nOAuth liaison test matrix → ${BASE}${canForge ? '' : '  (forged-token cases skipped: no JWT_SECRET)'}\n`)

  // 1. Discovery metadata
  const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource`).then(r => r.json())
  ok('protected-resource metadata: resource + auth server', prm.resource === RESOURCE && Array.isArray(prm.authorization_servers) && prm.authorization_servers.includes(ISSUER), JSON.stringify(prm))
  const asm = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then(r => r.json())
  ok('auth-server metadata: S256 + refresh-token support', asm.code_challenge_methods_supported?.includes('S256') && asm.token_endpoint === `${ISSUER}/oauth/token` && asm.registration_endpoint === `${ISSUER}/oauth/register` && asm.grant_types_supported?.includes('refresh_token') && asm.scopes_supported?.includes('offline_access'), JSON.stringify(asm))

  // 2. DCR — good vs bad redirect
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'test-connector' }),
  })
  const regJson = await reg.json()
  const clientId = regJson.client_id
  if (clientId) createdClients.push(clientId)
  ok('DCR registers a chatgpt.com redirect with refresh-token support', reg.status === 201 && !!clientId && regJson.token_endpoint_auth_method === 'none' && regJson.grant_types?.includes('refresh_token') && /offline_access/.test(regJson.scope || ''), JSON.stringify(regJson))
  const badReg = await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://evil.example.com/cb'] }),
  })
  ok('DCR rejects a non-ChatGPT redirect', badReg.status === 400)

  // 3. Consent page renders (GET)
  const consentQs = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'liaison offline_access', state: 'xyz', code_challenge: pkcePair().challenge, code_challenge_method: 'S256', resource: RESOURCE })
  const consent = await fetch(`${BASE}/oauth/authorize?${consentQs}`)
  const consentHtml = await consent.text()
  ok('consent screen renders with an Authorize button', consent.status === 200 && /Authorize/i.test(consentHtml) && /cannot/i.test(consentHtml))

  // 3b. Operator gate: wrong / missing passcode mints no code
  const badPass = await authorizeAndGetCode(clientId, pkcePair(), {}, 'wrong-passcode')
  ok('authorize with wrong passcode → no code (401)', !badPass.code && badPass.status === 401)
  const noPass = await authorizeAndGetCode(clientId, pkcePair(), { passcode: '' })
  ok('authorize with missing passcode → no code', !noPass.code)

  // 4. Happy path: authorize → code → token
  const pk = pkcePair()
  const auth = await authorizeAndGetCode(clientId, pk, { scope: 'liaison offline_access' })
  ok('authorize (correct passcode) issues a code + redirects to registered URI', auth.status === 302 && !!auth.code && auth.loc.startsWith(REDIRECT))
  const tok = await tokenExchange({ grant_type: 'authorization_code', code: auth.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pk.verifier })
  ok('token exchange returns a liaison access token', tok.status === 200 && tok.json.token_type === 'Bearer' && tok.json.scope === 'liaison' && !!tok.json.access_token)
  ok('token exchange also returns a refresh token', !!tok.json.refresh_token)
  const accessToken = tok.json.access_token
  const firstRefreshToken = tok.json.refresh_token

  // 5. Auth-code reuse rejected
  const reuse = await tokenExchange({ grant_type: 'authorization_code', code: auth.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pk.verifier })
  ok('reused auth code → rejected', reuse.status === 400 && reuse.json.error === 'invalid_grant', JSON.stringify(reuse.json))

  // 6. Wrong PKCE verifier rejected
  const pk2 = pkcePair()
  const auth2 = await authorizeAndGetCode(clientId, pk2)
  const badVer = await tokenExchange({ grant_type: 'authorization_code', code: auth2.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pkcePair().verifier })
  ok('wrong PKCE verifier → rejected', badVer.status === 400 && badVer.json.error === 'invalid_grant')

  // 7. Wrong redirect_uri at token rejected
  const pk3 = pkcePair()
  const auth3 = await authorizeAndGetCode(clientId, pk3)
  const badRedir = await tokenExchange({ grant_type: 'authorization_code', code: auth3.code, redirect_uri: 'https://chatgpt.com/connector/oauth/other', client_id: clientId, code_verifier: pk3.verifier })
  ok('wrong redirect_uri at token → rejected', badRedir.status === 400 && badRedir.json.error === 'invalid_grant')

  // 8. Missing PKCE at authorize rejected (redirect back with error)
  const noPkce = await authorizeAndGetCode(clientId, pkcePair(), { code_challenge: '' })
  ok('missing PKCE challenge → authorize errors (no code)', !noPkce.code && (noPkce.loc.includes('error=invalid_request') || noPkce.status === 400))

  // 9. Unknown client_id at authorize → fatal (no redirect)
  const badClient = await authorizeAndGetCode('nonexistent-client', pkcePair())
  ok('unknown client_id → fatal page, no code', !badClient.code && badClient.status === 400)

  // 10. Truly unsupported grant_type rejected
  const badGrant = await tokenExchange({ grant_type: 'client_credentials' })
  ok('unsupported grant_type → rejected', badGrant.status === 400 && badGrant.json.error === 'unsupported_grant_type')

  // 10b. refresh_token: missing params
  const noRefreshTok = await tokenExchange({ grant_type: 'refresh_token', client_id: clientId })
  ok('refresh_token missing refresh_token param → invalid_request', noRefreshTok.status === 400 && noRefreshTok.json.error === 'invalid_request')
  const noRefreshClient = await tokenExchange({ grant_type: 'refresh_token', refresh_token: 'x' })
  ok('refresh_token missing client_id param → invalid_request', noRefreshClient.status === 400 && noRefreshClient.json.error === 'invalid_request')

  // 10c. refresh_token: unknown token rejected
  const unknownRefresh = await tokenExchange({ grant_type: 'refresh_token', refresh_token: 'not-a-real-token', client_id: clientId })
  ok('unknown refresh token → invalid_grant', unknownRefresh.status === 400 && unknownRefresh.json.error === 'invalid_grant')

  // 11. MCP: no token → 401 + WWW-Authenticate → resource metadata
  const noTok = await rpc(null, 'initialize', { protocolVersion: '2025-11-25' })
  ok('MCP no token → 401 with resource_metadata hint', noTok.status === 401 && /resource_metadata=/.test(noTok.www || ''))

  if (canForge) {
    // 12. Expired token → 401
    const expired = forgeJwt({ ...baseClaims(), exp: now() - 10 })
    ok('expired token → 401', (await rpc(expired, 'initialize', {})).status === 401)

    // 13. Wrong audience → 401
    const wrongAud = forgeJwt({ ...baseClaims(), aud: 'https://evil.example.com/mcp' })
    ok('wrong audience → 401', (await rpc(wrongAud, 'initialize', {})).status === 401)

    // 14. Tampered signature → 401
    const tampered = forgeJwt(baseClaims(), { badSig: true })
    ok('tampered signature → 401', (await rpc(tampered, 'initialize', {})).status === 401)

    // 15. Wrong-secret token → 401
    const wrongSecret = forgeJwt(baseClaims(), { secret: 'x'.repeat(48) })
    ok('token signed with wrong secret → 401', (await rpc(wrongSecret, 'initialize', {})).status === 401)
  }

  // 16. Real token: initialize echoes protocol version
  const init = await rpc(accessToken, 'initialize', { protocolVersion: '2025-11-25' })
  ok('initialize echoes protocolVersion 2025-11-25', init.status === 200 && init.json?.result?.protocolVersion === '2025-11-25')

  // 17. tools/list = exactly the 6 liaison tools (now includes mc_respond_approval)
  const list = await rpc(accessToken, 'tools/list', {})
  const names = (list.json?.result?.tools || []).map(t => t.name).sort()
  const expected = ['mc_get_request_status', 'mc_get_result', 'mc_list_recent_requests', 'mc_respond_approval', 'mc_submit_request', 'mc_whats_stalled'].sort()
  ok('tools/list returns exactly the 6 liaison tools', JSON.stringify(names) === JSON.stringify(expected), names.join(','))

  // 18. Worker tool via liaison → 403
  const worker = await rpc(accessToken, 'tools/call', { name: 'mc_claim_request', arguments: { request_id: 'x', worker: 'claude' } })
  ok('liaison calling a worker tool → 403', worker.status === 403)

  // 19. Credential tool via liaison → 403
  const cred = await rpc(accessToken, 'tools/call', { name: 'mc_get_credential', arguments: { key_name: 'ANTHROPIC_API_KEY' } })
  ok('liaison calling a credential tool → 403', cred.status === 403)

  // 20. Vault write via liaison → 403
  const vault = await rpc(accessToken, 'tools/call', { name: 'mc_write_vault', arguments: { title: 'x', content: 'x', type: 'x' } })
  ok('liaison calling a vault-write tool → 403', vault.status === 403)

  // 21. Happy path write: mc_submit_request succeeds + is auditable
  const submit = await rpc(accessToken, 'tools/call', { name: 'mc_submit_request', arguments: { request_text: '[oauth-facade-test] verify liaison write path — safe to delete', title: 'oauth-facade-test', client_request_id: `oauth-test-${b64url(randomBytes(6))}` } })
  const submitText = submit.json?.result?.content?.[0]?.text || ''
  let requestId = null
  try { requestId = JSON.parse(submitText).request_id } catch { /* */ }
  ok('mc_submit_request via liaison token → success', submit.status === 200 && !!requestId, submitText.slice(0, 120))

  // 22. Refresh grant: valid refresh token → new access token, SAME refresh
  // token returned unchanged (non-rotating by design — see lib/oauth.ts).
  const refreshed = await tokenExchange({ grant_type: 'refresh_token', refresh_token: firstRefreshToken, client_id: clientId })
  ok('refresh_token grant → new access token', refreshed.status === 200 && refreshed.json.token_type === 'Bearer' && refreshed.json.scope === 'liaison' && !!refreshed.json.access_token)
  ok('refresh_token grant → same refresh token returned (non-rotating)', refreshed.json.refresh_token === firstRefreshToken)

  // 23. Redeeming the SAME refresh token again (2nd and 3rd time) each succeed
  // with a fresh access token and the unchanged refresh token — naturally
  // idempotent under retries/concurrency, which is the whole point of dropping
  // rotation for this single-connector use case.
  const redeem2 = await tokenExchange({ grant_type: 'refresh_token', refresh_token: firstRefreshToken, client_id: clientId })
  ok('same refresh token redeemed a 2nd time → succeeds', redeem2.status === 200 && !!redeem2.json.access_token && redeem2.json.refresh_token === firstRefreshToken, JSON.stringify(redeem2.json))
  const redeem3 = await tokenExchange({ grant_type: 'refresh_token', refresh_token: firstRefreshToken, client_id: clientId })
  ok('same refresh token redeemed a 3rd time → succeeds', redeem3.status === 200 && !!redeem3.json.access_token && redeem3.json.refresh_token === firstRefreshToken, JSON.stringify(redeem3.json))
  ok('each redemption minted a distinct access token', new Set([tok.json.access_token, refreshed.json.access_token, redeem2.json.access_token, redeem3.json.access_token]).size === 4)

  // 24. Wrong client_id on an otherwise-valid refresh token → rejected, and inert
  // (the real client can still redeem it afterward).
  const pk4 = pkcePair()
  const auth4 = await authorizeAndGetCode(clientId, pk4)
  const tok4 = await tokenExchange({ grant_type: 'authorization_code', code: auth4.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pk4.verifier })
  const wrongClientRefresh = await tokenExchange({ grant_type: 'refresh_token', refresh_token: tok4.json.refresh_token, client_id: 'some-other-client-id' })
  ok('refresh token redeemed with wrong client_id → rejected', wrongClientRefresh.status === 400 && wrongClientRefresh.json.error === 'invalid_grant')
  const validAfterWrongClient = await tokenExchange({ grant_type: 'refresh_token', refresh_token: tok4.json.refresh_token, client_id: clientId })
  ok('wrong client_id attempt is inert (real client token still works)', validAfterWrongClient.status === 200 && validAfterWrongClient.json.refresh_token === tok4.json.refresh_token)

  // 25-26. DB-backed cases — need a service-role client to revoke/age rows
  // without sleeping. Skipped if creds are unavailable; guard throws if creds
  // ARE present but the opt-in/localhost conditions aren't met (fail loudly).
  if (db) {
    assertDbMutationAllowed()
    // 25. Revoked token → invalid_grant.
    const R = await newClientWithRefresh('revoked-client-R')
    await db.from('oauth_refresh_tokens').update({ revoked_at: new Date().toISOString() }).eq('token_hash', sha256(R.refresh))
    const revokedHit = await tokenExchange({ grant_type: 'refresh_token', refresh_token: R.refresh, client_id: R.client_id })
    ok('revoked refresh token → invalid_grant', revokedHit.status === 400 && revokedHit.json.error === 'invalid_grant', JSON.stringify(revokedHit.json))

    // 26. Expired token → invalid_grant.
    const E = await newClientWithRefresh('expiry-client-E')
    await db.from('oauth_refresh_tokens').update({ expires_at: new Date(Date.now() - 10000).toISOString() }).eq('token_hash', sha256(E.refresh))
    const expiredHit = await tokenExchange({ grant_type: 'refresh_token', refresh_token: E.refresh, client_id: E.client_id })
    ok('expired refresh token → invalid_grant', expiredHit.status === 400 && expiredHit.json.error === 'invalid_grant', JSON.stringify(expiredHit.json))
  } else {
    console.log('  SKIP  DB-backed cases (revoked / expired) — no SUPABASE_SERVICE_ROLE_KEY')
  }

  // Cleanup: drop every seeded client (FK cascade removes their refresh tokens),
  // their auth codes, and the test request row, then verify nothing lingers.
  if (db && createdClients.length) {
    await db.from('oauth_refresh_tokens').delete().in('client_id', createdClients)
    await db.from('oauth_auth_codes').delete().in('client_id', createdClients)
    await db.from('oauth_clients').delete().in('client_id', createdClients)
    try { if (requestId) await db.from('mc_requests').delete().eq('id', requestId) } catch { /* best-effort */ }
    const { count: leftTokens } = await db.from('oauth_refresh_tokens').select('token_hash', { count: 'exact', head: true }).in('client_id', createdClients)
    const { count: leftClients } = await db.from('oauth_clients').select('client_id', { count: 'exact', head: true }).in('client_id', createdClients)
    ok('cleanup: no seeded clients or refresh tokens remain', (leftTokens ?? 0) === 0 && (leftClients ?? 0) === 0, `tokens=${leftTokens} clients=${leftClients}`)
  } else if (!db) {
    console.log(`  NOTE  seeded clients not auto-cleaned (no DB creds). Request row id ${requestId ?? 'n/a'} also left in place.`)
  }

  console.log(`\n${pass} passed, ${fail} failed\n`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
