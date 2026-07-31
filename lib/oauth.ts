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
  // Exact ChatGPT callback, once David supplies it from the draft-app screen.
  // Until set, DCR falls back to the connector-domain prefix guard below.
  chatgptRedirectUri: string | null
}

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
  cachedConfig = {
    issuer: issuer.replace(/\/$/, ''),
    resource,
    jwtSecret,
    accessTokenTtl: Number.isFinite(ttlRaw) && ttlRaw > 0 ? ttlRaw : 3600,
    chatgptRedirectUri: process.env.CHATGPT_REDIRECT_URI || null,
  }
  return cachedConfig
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
  // RFC 7636 length bounds on the verifier.
  if (verifier.length < 43 || verifier.length > 128) return false
  const computed = b64url(createHash('sha256').update(verifier).digest())
  const a = Buffer.from(computed)
  const b = Buffer.from(challenge)
  return a.length === b.length && timingSafeEqual(a, b)
}

// ---- Redirect URI validation ----------------------------------------------

// Whether a redirect_uri may be REGISTERED via DCR. Once David sets the exact
// CHATGPT_REDIRECT_URI it must match that exactly; before that, any callback
// under the ChatGPT connector prefix is allowed so registration can bootstrap.
export function isRegistrableRedirectUri(uri: string, cfg: OAuthConfig): boolean {
  if (cfg.chatgptRedirectUri) return uri === cfg.chatgptRedirectUri
  return uri.startsWith(CHATGPT_REDIRECT_PREFIX) && isHttpsUrl(uri)
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
      grant_types: ['authorization_code'],
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
    code,
    client_id: params.client_id,
    redirect_uri: params.redirect_uri,
    code_challenge: params.code_challenge,
    code_challenge_method: 'S256',
    scope: 'liaison',
    resource: params.resource,
    expires_at,
  })
  if (error) throw new Error(error.message)
  return code
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
  const { data: row } = await supabase
    .from('oauth_auth_codes')
    .select('client_id, redirect_uri, code_challenge, resource, expires_at, consumed_at')
    .eq('code', code)
    .maybeSingle()
  if (!row) return { error: 'invalid_grant: unknown code' }
  if (row.consumed_at) return { error: 'invalid_grant: code already used' }
  if (new Date(row.expires_at).getTime() < Date.now()) return { error: 'invalid_grant: code expired' }

  const { data: updated, error } = await supabase
    .from('oauth_auth_codes')
    .update({ consumed_at: new Date().toISOString() })
    .eq('code', code)
    .is('consumed_at', null)
    .select('code')
    .maybeSingle()
  if (error) return { error: `invalid_grant: ${error.message}` }
  if (!updated) return { error: 'invalid_grant: code already used' } // lost the single-use race
  return {
    client_id: row.client_id,
    redirect_uri: row.redirect_uri,
    code_challenge: row.code_challenge,
    resource: row.resource,
  }
}
