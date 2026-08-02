import { NextRequest, NextResponse } from 'next/server'
import { getOAuthConfig, consumeAuthCode, verifyPkceS256, signAccessToken, checkRateLimit, rateKey, issueRefreshToken, consumeRefreshToken } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

function clientIp(req: NextRequest): string {
  return req.headers.get('x-forwarded-for')?.split(',')[0]?.trim() || 'unknown'
}

// Token endpoint. Two grants:
// - authorization_code: exchanges a single-use code + PKCE verifier for a
//   short-lived liaison access token (JWT, aud = MCP resource) plus a
//   long-lived refresh token with a sliding inactivity window and annual hard cap. Rejects: wrong grant, unknown/expired/
//   reused code, client mismatch, redirect mismatch, bad or missing PKCE
//   verifier, wrong resource.
// - refresh_token: exchanges a valid (unrevoked, unexpired) refresh token for
//   a new access token; the refresh token itself is returned unchanged
//   (non-rotating — see lib/oauth.ts consumeRefreshToken). Rejects: missing
//   params, unknown/expired/revoked token, client mismatch.

function tokenError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}

export async function POST(req: NextRequest) {
  const cfg = getOAuthConfig()

  // 30 token requests / min / IP — generous for a real client, caps grinding.
  if (!(await checkRateLimit(rateKey('token', clientIp(req)), 30, 60))) {
    return tokenError('rate_limited', 'too many token requests', 429)
  }

  // OAuth token requests are application/x-www-form-urlencoded.
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await req.text())
  } catch {
    return tokenError('invalid_request', 'malformed request body')
  }

  const grantType = form.get('grant_type') ?? ''
  if (grantType !== 'authorization_code' && grantType !== 'refresh_token') {
    return tokenError('unsupported_grant_type', `grant_type '${grantType}' is not supported`)
  }

  if (grantType === 'refresh_token') {
    const refreshToken = form.get('refresh_token') ?? ''
    const clientId = form.get('client_id') ?? ''
    if (!refreshToken) return tokenError('invalid_request', 'refresh_token is required')
    if (!clientId) return tokenError('invalid_request', 'client_id is required')

    const result = await consumeRefreshToken(refreshToken, clientId)
    if ('code' in result) {
      // Structured error from consumeRefreshToken — server_error maps to 500,
      // every invalid_grant variant to 400.
      return tokenError(result.code, result.message, result.code === 'server_error' ? 500 : 400)
    }

    const { token, expiresIn } = signAccessToken(cfg)
    return NextResponse.json(
      {
        access_token: token,
        token_type: 'Bearer',
        expires_in: expiresIn,
        refresh_token: refreshToken, // non-rotating: unchanged
        scope: 'liaison',
      },
      { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
    )
  }

  const code = form.get('code') ?? ''
  const clientId = form.get('client_id') ?? ''
  const redirectUri = form.get('redirect_uri') ?? ''
  const codeVerifier = form.get('code_verifier') ?? ''
  const resource = form.get('resource') ?? ''

  // Validate cheap required params BEFORE consuming, so a malformed request
  // never burns a valid single-use code.
  if (!code) return tokenError('invalid_request', 'code is required')
  if (!codeVerifier) return tokenError('invalid_request', 'code_verifier is required (PKCE)')
  if (!clientId) return tokenError('invalid_request', 'client_id is required')
  if (!redirectUri) return tokenError('invalid_request', 'redirect_uri is required')

  // Single-use redemption. Any replay / expiry / unknown code fails here.
  const consumed = await consumeAuthCode(code)
  if ('error' in consumed) {
    const [err, ...rest] = consumed.error.split(': ')
    return tokenError(err || 'invalid_grant', rest.join(': ') || 'authorization code is invalid')
  }

  // Bind the exchange to the same client + redirect the code was issued to.
  if (clientId !== consumed.client_id) {
    return tokenError('invalid_grant', 'client_id does not match the authorization code')
  }
  if (redirectUri !== consumed.redirect_uri) {
    return tokenError('invalid_grant', 'redirect_uri does not match the authorization code')
  }
  // PKCE proof.
  if (!verifyPkceS256(codeVerifier, consumed.code_challenge)) {
    return tokenError('invalid_grant', 'PKCE verification failed')
  }
  // Audience binding: a resource param, if resent, must still match.
  const boundResource = consumed.resource ?? cfg.resource
  if (resource && resource !== boundResource) {
    return tokenError('invalid_target', 'resource does not match the authorization code')
  }

  const { token, expiresIn } = signAccessToken(cfg)
  let refreshToken: string
  try {
    // Single-purpose server: refresh always issued; offline_access is advertised
    // for client compatibility but not gated (no scope-conditional issuance).
    refreshToken = await issueRefreshToken({ client_id: consumed.client_id, resource: boundResource })
  } catch (error) {
    console.error('[oauth] refresh-token issuance failed:', error)
    return tokenError('server_error', 'refresh token issuance failed', 500)
  }
  return NextResponse.json(
    { access_token: token, token_type: 'Bearer', expires_in: expiresIn, refresh_token: refreshToken, scope: 'liaison' },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}
