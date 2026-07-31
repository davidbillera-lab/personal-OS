import { NextRequest, NextResponse } from 'next/server'
import { getOAuthConfig, consumeAuthCode, verifyPkceS256, signAccessToken } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Token endpoint. Exchanges a single-use authorization code + PKCE verifier for
// a short-lived liaison access token (JWT, aud = MCP resource). Rejects: wrong
// grant, unknown/expired/reused code, client mismatch, redirect mismatch, bad
// or missing PKCE verifier, wrong resource. No refresh tokens in this pass.

function tokenError(error: string, description: string, status = 400): NextResponse {
  return NextResponse.json(
    { error, error_description: description },
    { status, headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}

export async function POST(req: NextRequest) {
  const cfg = getOAuthConfig()

  // OAuth token requests are application/x-www-form-urlencoded.
  let form: URLSearchParams
  try {
    form = new URLSearchParams(await req.text())
  } catch {
    return tokenError('invalid_request', 'malformed request body')
  }

  const grantType = form.get('grant_type') ?? ''
  if (grantType !== 'authorization_code') {
    return tokenError('unsupported_grant_type', `grant_type '${grantType}' is not supported`)
  }

  const code = form.get('code') ?? ''
  const clientId = form.get('client_id') ?? ''
  const redirectUri = form.get('redirect_uri') ?? ''
  const codeVerifier = form.get('code_verifier') ?? ''
  const resource = form.get('resource') ?? ''

  if (!code) return tokenError('invalid_request', 'code is required')
  if (!codeVerifier) return tokenError('invalid_request', 'code_verifier is required (PKCE)')

  // Single-use redemption. Any replay / expiry / unknown code fails here.
  const consumed = await consumeAuthCode(code)
  if ('error' in consumed) {
    const [err, ...rest] = consumed.error.split(': ')
    return tokenError(err || 'invalid_grant', rest.join(': ') || 'authorization code is invalid')
  }

  // Bind the exchange to the same client + redirect the code was issued to.
  if (clientId && clientId !== consumed.client_id) {
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
  return NextResponse.json(
    { access_token: token, token_type: 'Bearer', expires_in: expiresIn, scope: 'liaison' },
    { headers: { 'Cache-Control': 'no-store', Pragma: 'no-cache' } }
  )
}
