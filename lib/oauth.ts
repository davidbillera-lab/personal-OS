import { createHmac, createHash, randomBytes, timingSafeEqual } from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase'

// OAuth 2.1 + PKCE facade core for the ChatGPT liaison.
// A valid access token minted here grants ONLY the 'liaison' scope mapped to the
// 'chatgpt-liaison' identity — the same narrow surface as the static liaison
// key. Access tokens are stateless signed JWTs (HS256); only DCR clients and
// short-lived single-use auth codes persist (migration 018).

// ---- Config (fail closed) --------------------------------------------------

export interface OAuthConfig {
  issuer: string        // OAUTH_ISSUER — base URL that hosts /oauth/* + /.well-known/*
  resource: string      // MCP_RESOURCE_URL — canonical MCP resource id == token aud
  jwtSecret: string     // OAUTH_JWT_SECRET — HMAC signing key (>=32 chars)
  accessTokenTtl: number // seconds
  refreshTokenTtl: number // seconds — OAUTH_REFRESH_TOKEN_TTL, default 90 days. Non-rotating: this is the token's absolute lifetime.
  // Exact ChatGPT callback, once David supplies it from the draft-app screen.
  // Until set, DCR falls back to the connector-domain prefix guard below.
  chatgptRedirectUri: string | null
  // Operator approval secret. The /authorize consent screen requires it before
  // minting a code, so only David (who knows it) can approve the connection —
  // not any ChatGPT user who discovers the endpoint. Fail-closed: no passcode
  // (or one under the entropy floor) → no approval possible.
  consentPasscode: string | null
  // Whether DCR may register callbacks under the ChatGPT connector prefix while
  // CHATGPT_REDIRECT_URI is unset. Off by default → prod fails closed (only the
  // exact configured redirect registers). Turn on ONLY for the first-connect
  // bootstrap, then set CHATGPT_REDIRECT_URI and turn it back off.
  allowDcrBootstrap: boolean
}

// Minimum operator-passcode length. A high-entropy secret makes the /authorize
// approval infeasible to brute-force even without a rate limiter.
const MIN_PASSCODE_LEN = 16

// ChatGPT connector callbacks always live under this host+path. Until the exact
// callback URL is known (set via CHATGPT_REDIRECT_URI), DCR accepts only
// redirect_uris under this prefix so nothing outside ChatGPT can register.
export const CHATGPT_REDIRECT_PREFIX = 'https://chatgpt.com/connector/oauth/'

let cachedConfig: OAuthConfig | null = null

export function getOAuthConfig(): OAuthConfig {
  if (cachedConfig) return cachedConfig
  const issuer = process.env.OAUTH_ISSUER
  const resource = process.env.MCP_RESOURCE_URL
  const jwtSecret = process.env.OAUTH_JWT_SECRET
  if (!issuer || !resource || !jwtSecret) {
    throw new Error('OAuth not configured: OAUTH_ISSUER, MCP_RESOURCE_URL, and OAUTH_JWT_SECRET are required')
  }
  if (jwtSecret.length < 32) {
    throw new Error('OAUTH_JWT_SECRET must be at least 32 characters')
  }
  const ttlRaw = parseInt(process.env.OAUTH_ACCESS_TOKEN_TTL ?? '', 10)
  const refreshTtlRaw = parseInt(process.env.OAUTH_REFRESH_TOKEN_TTL ?? '', 10)
  cachedConfig = {
    issuer: issuer.replace(/\/$/, ''),
    resource,
    jwtSecret,
    // Short-lived by default (15 min). Stateless JWTs have no revocation path,
    // so keep the window tight for a token that fronts a write-capable queue.
    accessTokenTtl: Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 900,
    // Non-rotating, so this is the token's absolute lifetime (90 days default).
    // Persisted + hashed, unlike the stateless access token, so a longer window
    // is safe here; theft is bounded by this expiry + manual revocation.
    refreshTokenTtl: Number.isFinite(refreshTtlRaw) && refreshTtlRaw > 0 ? refreshTtlRaw : 7776000,
    chatgptRedirectUri: process.env.CHATGPT_REDIRECT_URI || null,
    consentPasscode: passcodeOrNull(process.env.OAUTH_CONSENT_PASSCODE),
    allowDcrBootstrap: process.env.OAUTH_ALLOW_DCR_BOOTSTRAP === 'true',
  }
  return cachedConfig
}

// Accept the passcode only if it clears the entropy floor. A too-short value is
// treated as unset (fail-closed) with a loud log, so a weak passcode can never
// silently guard the approval endpoint.
function passcodeOrNull(raw: string | undefined): string | null {
  if (!raw) return null
  if (raw.length < MIN_PASSCODE_LEN) {
    console.error(`[oauth] OAUTH_CONSENT_PASSCODE is under ${MIN_PASSCODE_LEN} chars — treating as unset (approval disabled)`)
    return null
  }
  return raw
}

// True only when the core secrets exist — lets metadata endpoints answer while
// still failing closed on token issuance if misconfigured.
export function isOAuthConfigured(): boolean {
  try { getOAuthConfig(); return true } catch { return false }
}

// ---- base64url -------------------------------------------------------------

function b64url(input: Buffer | string): string {
  return Buffer.from(input).toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function b64urlDecode(input: string): Buffer {
  return Buffer.from(input.replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

// ---- Random generators -----------------------------------------------------

export function randomToken(bytes = 32): string {
  return b64url(randomBytes(bytes))
}

// Auth codes are bearer credentials — store only their SHA-256 so a DB/log leak
// never yields a usable code. The plaintext lives only in the redirect to
// ChatGPT and the client's token request.
export function hashCode(code: string): string {
  return createHash('sha256').update(code).digest('hex')
}

// Constant-time string equality for the operator consent passcode.
export function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a)
  const bb = Buffer.from(b)
  return ba.length === bb.length && timingSafeEqual(ba, bb)
}

// ---- JWT (HS256) -----------------------------------------------------------

interface AccessTokenClaims {
  iss: string
  sub: string
  aud: string
  scope: string
  iat: number
  exp: number
  jti: string
}

// Mint a liaison access token bound to the MCP resource audience.
export function signAccessToken(cfg: OAuthConfig): { token: string; expiresIn: number } {
  const now = Math.floor(Date.now() / 1000)
  const claims: AccessTokenClaims = {
    iss: cfg.issuer,
    sub: 'chatgpt-liaison',
    aud: cfg.resource,
    scope: 'liaison',
    iat: now,
    exp: now + cfg.accessTokenTtl,
    jti: randomToken(12),
  }
  const header = b64url(JSON.stringify({ alg: 'HS256', typ: 'JWT' }))
  const payload = b64url(JSON.stringify(claims))
  const signature = b64url(createHmac('sha256', cfg.jwtSecret).update(`${header}.${payload}`).digest())
  return { token: `${header}.${payload}.${signature}`, expiresIn: cfg.accessTokenTtl }
}

export interface VerifyResult { valid: boolean; reason?: string; claims?: AccessTokenClaims }

// Verify signature (constant-time), then exp, iss, aud, and liaison scope.
// Rejects any token that isn't a well-formed HS256 JWT we minted for this resource.
export function verifyAccessToken(token: string, cfg: OAuthConfig): VerifyResult {
  const parts = token.split('.')
  if (parts.length !== 3) return { valid: false, reason: 'malformed token' }
  const [header, payload, signature] = parts

  let head: { alg?: string; typ?: string }
  try { head = JSON.parse(b64urlDecode(header).toString('utf8')) } catch { return { valid: false, reason: 'bad header' } }
  if (head.alg !== 'HS256') return { valid: false, reason: 'unexpected alg' }

  const expected = b64url(createHmac('sha256', cfg.jwtSecret).update(`${header}.${payload}`).digest())
  const a = Buffer.from(signature)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !timingSafeEqual(a, b)) return { valid: false, reason: 'bad signature' }

  let claims: AccessTokenClaims
  try { claims = JSON.parse(b64urlDecode(payload).toString('utf8')) } catch { return { valid: false, reason: 'bad payload' } }

  const now = Math.floor(Date.now() / 1000)
  if (typeof claims.exp !== 'number' || claims.exp < now) return { valid: false, reason: 'expired' }
  if (claims.iss !== cfg.issuer) return { valid: false, reason: 'wrong issuer' }
  if (claims.aud !== cfg.resource) return { valid: false, reason: 'wrong audience' }
  if (claims.scope !== 'liaison') return { valid: false, reason: 'insufficient scope' }
  return { valid: true, claims }
}

// ---- PKCE (S256 only) ------------------------------------------------------

// RFC 7636 S256: challenge == base64url(SHA256(verifier)). No plain method.
export function verifyPkceS256(verifier: string, challenge: string): boolean {
  if (!verifier || !challenge) return false
  // RFC 7636 length bounds + unreserved character set on the verifier.
  if (verifier.length < 43 || verifier.length > 128) return false
  if (!/^[A-Za-z0-9\-._~]+$/.test(verifier)) return false
  const computed = b64url(createHash('sha256').update(verifier).digest())
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---- Redirect URI validation ----------------------------------------------

// Whether a redirect_uri may be REGISTERED via DCR. Once David sets the exact
// CHATGPT_REDIRECT_URI it must match that exactly. If it isn't set, registration
// is refused UNLESS bootstrap mode is explicitly enabled — in which case any
// callback under the ChatGPT connector prefix is allowed, purely for first-connect.
export function isRegistrableRedirectUri(uri: string, cfg: OAuthConfig): boolean {
  if (cfg.chatgptRedirectUri) return uri === cfg.chatgptRedirectUri
  if (cfg.allowDcrBootstrap) return uri.startsWith(CHATGPT_REDIRECT_PREFIX) && isHttpsUrl(uri)
  return false // fail closed: no exact redirect configured and no bootstrap
}

function isHttpsUrl(uri: string): boolean {
  try { return new URL(uri).protocol === 'https:' } catch { return false }
}

// ---- DB helpers ------------------------------------------------------------

export interface OAuthClient {
  client_id: string
  redirect_uris: string[]
  client_name: string | null
  scope: string
}

export async function createOAuthClient(params: {
  redirect_uris: string[]
  client_name?: string
}): Promise<OAuthClient> {
  const supabase = createAdminSupabaseClient()
  const client_id = randomToken(16)
  const { data, error } = await supabase
    .from('oauth_clients')
    .insert({
      client_id,
      client_secret: null, // public PKCE client
      client_name: params.client_name ?? null,
      redirect_uris: params.redirect_uris,
      grant_types: ['authorization_code', 'refresh_token'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'liaison',
    })
    .select('client_id, redirect_uris, client_name, scope')
    .single()
  if (error || !data) throw new Error(error?.message ?? 'client registration failed')
  return { ...data, redirect_uris: data.redirect_uris as string[] }
}

export async function getOAuthClient(client_id: string): Promise<OAuthClient | null> {
  const supabase = createAdminSupabaseClient()
  const { data } = await supabase
    .from('oauth_clients')
    .select('client_id, redirect_uris, client_name, scope')
    .eq('client_id', client_id)
    .maybeSingle()
  if (!data) return null
  return { ...data, redirect_uris: data.redirect_uris as string[] }
}

export async function insertAuthCode(params: {
  client_id: string
  redirect_uri: string
  code_challenge: string
  resource: string | null
  ttlSeconds?: number
}): Promise<string> {
  const supabase = createAdminSupabaseClient()
  const code = randomToken(32)
  const expires_at = new Date(Date.now() + (params.ttlSeconds ?? 300) * 1000).toISOString()
  const { error } = await supabase.from('oauth_auth_codes').insert({
    code: hashCode(code), // store only the hash; return the plaintext to the caller
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: 'S256',
    scope: 'liaison',
    resource: params.resource,
    expires_at,
  })
  if (error) throw new Error(error.message)
  // Opportunistic cleanup of expired codes so the table doesn't accumulate junk.
  void supabase.from('oauth_auth_codes').delete().lt('expires_at', new Date().toISOString())
    .then(({ error: e }) => { if (e) console.error('[oauth] expired-code cleanup failed (non-fatal):', e.message) })
  return code
}

// ---- Rate limiting + revocation (migration 019) ----------------------------

// Fixed-window rate limit via the atomic oauth_rate_check() function. Returns
// true if the call is within budget. Fails OPEN on a DB error — a limiter
// outage must not lock out the real connector; the other gates still hold.
export async function checkRateLimit(key: string, max: number, windowSec: number): Promise<boolean> {
  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase.rpc('oauth_rate_check', { p_key: key, p_max: max, p_window_sec: windowSec })
    if (error) { console.error('[oauth] rate check failed (allowing):', error.message); return true }
    return data !== false
  } catch (e) {
    console.error('[oauth] rate check threw (allowing):', e)
    return true
  }
}

// Build a rate-limit key from a caller identity (IP or token jti) + a label.
export function rateKey(label: string, id: string | null | undefined): string {
  return `${label}:${id || 'unknown'}`
}

// Cached revocation cutoff. Access tokens are stateless JWTs; setting
// oauth_config.revoked_before = now() invalidates every token issued before it.
// Cached ~60s so the check adds ~no latency to steady-state MCP calls.
let revokedCache = { value: 0, fetchedAt: 0 }
async function getRevokedBefore(): Promise<number> {
  const now = Date.now()
  if (now - revokedCache.fetchedAt < 60_000) return revokedCache.value
  try {
    const supabase = createAdminSupabaseClient()
    const { data, error } = await supabase.from('oauth_config').select('value').eq('key', 'revoked_before').maybeSingle()
    // Kill-switch read errors must be loud — a silent failure would let revoked
    // tokens through. Serve the last-known cutoff rather than resetting to 0.
    if (error) { console.error('[oauth] revoked_before read failed (serving cached cutoff):', error.message); return revokedCache.value }
    const ts = data?.value ? Math.floor(new Date(data.value).getTime() / 1000) : 0
    revokedCache = { value: Number.isFinite(ts) ? ts : 0, fetchedAt: now }
    return revokedCache.value
  } catch (e) {
    console.error('[oauth] revoked_before read threw (serving cached cutoff):', e)
    return revokedCache.value // serve the last-known value on a read error
  }
}

// True if a token issued at `iat` (unix seconds) has been globally revoked.
export async function isTokenRevoked(iat: number): Promise<boolean> {
  return iat < (await getRevokedBefore())
}

export interface ConsumedCode {
  client_id: string
  redirect_uri: string
  code_challenge: string
  resource: string | null
}

// Atomically redeem an auth code: mark consumed only if it is currently unconsumed
// and unexpired. The conditional UPDATE (consumed_at IS NULL) is the single-use
// guard — a replayed code updates zero rows and is rejected.
export async function consumeAuthCode(code: string): Promise<ConsumedCode | { error: string }> {
  const supabase = createAdminSupabaseClient()
  const hashed = hashCode(code)
  const nowIso = new Date().toISOString()

  // Single-use AND unexpired are both enforced in the conditional UPDATE, so
  // redemption is fully atomic — no check-then-act window. A replayed, expired,
  // or unknown code updates zero rows and is rejected.
  const { data: updated, error } = await supabase
    .from('oauth_auth_codes')
    .update({ consumed_at: nowIso })
    .eq('code', hashed)
    .is('consumed_at', null)
    .gt('expires_at', nowIso)
    .select('client_id, redirect_uri, code_challenge, resource')
    .maybeSingle()
  if (error) return { error: `invalid_grant: ${error.message}` }
  if (!updated) return { error: 'invalid_grant: code is invalid, expired, or already used' }
  return {
    client_id: updated.client_id,
    redirect_uri: updated.redirect_uri,
    code_challenge: updated.code_challenge,
    resource: updated.resource,
  }
}

// ---- Refresh tokens (migrations 021 + 023) ---------------------------------
// Long-lived (90-day default), NON-ROTATING refresh tokens so ChatGPT can
// silently mint new short-lived access tokens without re-consent. Same
// narrow 'liaison' scope as the access token — no privilege escalation.
// Note: access tokens already issued stay valid until their 15-min exp even
// after a revoke — inherent to stateless JWTs; revocation gates issuance of
// NEW access tokens, not the ~15-min tail on ones already minted.

// Issue a new refresh token bound to a client + resource. Only the SHA-256
// hash is persisted; the plaintext is returned once to the caller (mirrors
// insertAuthCode).
export async function issueRefreshToken(params: {
  client_id: string
  resource: string | null
}): Promise<string> {
  const supabase = createAdminSupabaseClient()
  const cfg = getOAuthConfig()
  const token = randomToken(32)
  const expires_at = new Date(Date.now() + cfg.refreshTokenTtl * 1000).toISOString()
  const { error } = await supabase.from('oauth_refresh_tokens').insert({
    token_hash: hashCode(token),
    client_id: params.client_id,
    scope: 'liaison',
    resource: params.resource,
    expires_at,
  })
  if (error) throw new Error(error.message)
  // Opportunistic cleanup of expired/revoked rows so the table doesn't accumulate junk.
  void supabase.from('oauth_refresh_tokens').delete().lt('expires_at', new Date().toISOString())
    .then(({ error: e }) => { if (e) console.error('[oauth] expired-refresh-token cleanup failed (non-fatal):', e.message) })
  return token
}

export interface RefreshTokenError { code: string; message: string }

// Validate a refresh token WITHOUT rotating it — non-rotating by design (single
// personal connector): the refresh token is stable across refreshes —
// retries/concurrency are naturally idempotent. Theft is mitigated by the
// 15-min access-token window, the 90-day absolute expiry, and manual
// revocation (UPDATE oauth_refresh_tokens SET revoked_at = now() WHERE ... —
// bulk = the kill-switch).
export async function consumeRefreshToken(
  token: string,
  client_id: string
): Promise<{ resource: string | null } | RefreshTokenError> {
  const supabase = createAdminSupabaseClient()
  const hashed = hashCode(token)
  const { data: row, error } = await supabase
    .from('oauth_refresh_tokens')
    .select('client_id, resource, revoked_at, expires_at')
    .eq('token_hash', hashed)
    .maybeSingle()

  if (error) {
    // Log the real DB error server-side; never leak it to the client.
    console.error('[oauth] refresh-token lookup failed:', error.message)
    return { code: 'server_error', message: 'refresh lookup failed' }
  }
  if (!row) return { code: 'invalid_grant', message: 'refresh token is invalid' }
  // Wrong client is inert — no side effects, same error as unknown.
  if (row.client_id !== client_id) return { code: 'invalid_grant', message: 'refresh token is invalid' }
  if (row.revoked_at) return { code: 'invalid_grant', message: 'refresh token revoked' }
  if (new Date(row.expires_at) <= new Date()) return { code: 'invalid_grant', message: 'refresh token expired' }

  // Best-effort touch; never blocks or fails the response.
  const nowIso = new Date().toISOString()
  void supabase.from('oauth_refresh_tokens').update({ last_used_at: nowIso }).eq('token_hash', hashed)
    .then(({ error: e }) => { if (e) console.error('[oauth] last_used_at touch failed (non-fatal):', e.message) })

  return { resource: row.resource ?? null }
}
