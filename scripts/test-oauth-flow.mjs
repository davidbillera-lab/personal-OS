// OAuth 2.1 + PKCE liaison facade — acceptance test matrix.
// Usage: BASE=http://localhost:3000 JWT_SECRET=<OAUTH_JWT_SECRET> node scripts/test-oauth-flow.mjs
// Exercises the happy path plus every negative case in the build spec against a
// running server. Exits non-zero if any case fails. Does not deploy or touch prod.

import { createHash, createHmac, randomBytes } from 'crypto'

const BASE = (process.env.BASE || 'http://localhost:3000').replace(/\/$/, '')
const JWT_SECRET = process.env.JWT_SECRET || ''
const RESOURCE = process.env.RESOURCE || `${BASE}/api/mcp-liaison`
const ISSUER = process.env.ISSUER || BASE
const PASSCODE = process.env.PASSCODE || ''
const REDIRECT = 'https://chatgpt.com/connector/oauth/test-local'

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

async function main() {
  if (!JWT_SECRET) { console.error('JWT_SECRET env required (the OAUTH_JWT_SECRET value)'); process.exit(2) }
  console.log(`\nOAuth liaison test matrix → ${BASE}\n`)

  // 1. Discovery metadata
  const prm = await fetch(`${BASE}/.well-known/oauth-protected-resource`).then(r => r.json())
  ok('protected-resource metadata: resource + auth server', prm.resource === RESOURCE && Array.isArray(prm.authorization_servers) && prm.authorization_servers.includes(ISSUER), JSON.stringify(prm))
  const asm = await fetch(`${BASE}/.well-known/oauth-authorization-server`).then(r => r.json())
  ok('auth-server metadata: S256 + endpoints', asm.code_challenge_methods_supported?.includes('S256') && asm.token_endpoint === `${ISSUER}/oauth/token` && asm.registration_endpoint === `${ISSUER}/oauth/register`, JSON.stringify(asm))

  // 2. DCR — good vs bad redirect
  const reg = await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: [REDIRECT], client_name: 'test-connector' }),
  })
  const regJson = await reg.json()
  const clientId = regJson.client_id
  ok('DCR registers a chatgpt.com redirect', reg.status === 201 && !!clientId && regJson.token_endpoint_auth_method === 'none', JSON.stringify(regJson))
  const badReg = await fetch(`${BASE}/oauth/register`, {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ redirect_uris: ['https://evil.example.com/cb'] }),
  })
  ok('DCR rejects a non-ChatGPT redirect', badReg.status === 400)

  // 3. Consent page renders (GET)
  const consentQs = new URLSearchParams({ response_type: 'code', client_id: clientId, redirect_uri: REDIRECT, scope: 'liaison', state: 'xyz', code_challenge: pkcePair().challenge, code_challenge_method: 'S256', resource: RESOURCE })
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
  const auth = await authorizeAndGetCode(clientId, pk)
  ok('authorize (correct passcode) issues a code + redirects to registered URI', auth.status === 302 && !!auth.code && auth.loc.startsWith(REDIRECT))
  const tok = await tokenExchange({ grant_type: 'authorization_code', code: auth.code, redirect_uri: REDIRECT, client_id: clientId, code_verifier: pk.verifier })
  ok('token exchange returns a liaison access token', tok.status === 200 && tok.json.token_type === 'Bearer' && tok.json.scope === 'liaison' && !!tok.json.access_token)
  const accessToken = tok.json.access_token

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

  // 10. refresh_token grant unsupported
  const refresh = await tokenExchange({ grant_type: 'refresh_token', refresh_token: 'x' })
  ok('unsupported grant_type → rejected', refresh.status === 400 && refresh.json.error === 'unsupported_grant_type')

  // 11. MCP: no token → 401 + WWW-Authenticate → resource metadata
  const noTok = await rpc(null, 'initialize', { protocolVersion: '2025-11-25' })
  ok('MCP no token → 401 with resource_metadata hint', noTok.status === 401 && /resource_metadata=/.test(noTok.www || ''))

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

  // 16. Real token: initialize echoes protocol version
  const init = await rpc(accessToken, 'initialize', { protocolVersion: '2025-11-25' })
  ok('initialize echoes protocolVersion 2025-11-25', init.status === 200 && init.json?.result?.protocolVersion === '2025-11-25')

  // 17. tools/list = exactly the 5 liaison tools
  const list = await rpc(accessToken, 'tools/list', {})
  const names = (list.json?.result?.tools || []).map(t => t.name).sort()
  const expected = ['mc_get_request_status', 'mc_get_result', 'mc_list_recent_requests', 'mc_submit_request', 'mc_whats_stalled'].sort()
  ok('tools/list returns exactly the 5 liaison tools', JSON.stringify(names) === JSON.stringify(expected), names.join(','))

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

  console.log(`\n${pass} passed, ${fail} failed\n`)
  if (requestId) console.log(`(test request row id ${requestId} — created via the verified OAuth flow; delete if you want the queue clean)\n`)
  process.exit(fail ? 1 : 0)
}

main().catch(e => { console.error(e); process.exit(2) })
