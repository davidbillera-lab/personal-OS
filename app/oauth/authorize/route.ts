import { NextRequest, NextResponse } from 'next/server'
import { getOAuthConfig, getOAuthClient, insertAuthCode, safeEqual, type OAuthConfig } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Authorization endpoint (OAuth 2.1 auth-code + PKCE).
//   GET  → validate params, render the consent screen (with operator passcode field).
//   POST → verify the operator passcode, then mint a single-use code and redirect.
// The passcode is the resource-owner gate: without it, ANY caller who reaches this
// public endpoint could mint a liaison token (the auth code is otherwise scrapeable
// off the redirect). PKCE S256 is mandatory; the RFC 8707 `resource` (if sent) must
// match our MCP resource; redirect_uri is validated EXACTLY against the registered client.

// Deny framing — an approval page must not be clickjackable.
const SECURITY_HEADERS = {
  'Content-Type': 'text/html; charset=utf-8',
  'Cache-Control': 'no-store',
  'X-Frame-Options': 'DENY',
  'Content-Security-Policy': "default-src 'none'; style-src 'unsafe-inline'; form-action 'self'; frame-ancestors 'none'",
}

interface AuthParams {
  response_type: string
  client_id: string
  redirect_uri: string
  scope: string
  state: string
  code_challenge: string
  code_challenge_method: string
  resource: string
}

function readParams(sp: URLSearchParams): AuthParams {
  return {
    response_type: sp.get('response_type') ?? '',
    client_id: sp.get('client_id') ?? '',
    redirect_uri: sp.get('redirect_uri') ?? '',
    scope: sp.get('scope') ?? '',
    state: sp.get('state') ?? '',
    code_challenge: sp.get('code_challenge') ?? '',
    code_challenge_method: sp.get('code_challenge_method') ?? '',
    resource: sp.get('resource') ?? '',
  }
}

function esc(s: string): string {
  return s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

// A fatal error that must NOT be sent to the (untrusted) redirect_uri.
function fatalPage(message: string): NextResponse {
  return new NextResponse(
    `<!doctype html><html><body style="font-family:system-ui;max-width:32rem;margin:4rem auto;padding:0 1rem">
     <h1 style="font-size:1.1rem">Authorization error</h1><p>${esc(message)}</p></body></html>`,
    { status: 400, headers: SECURITY_HEADERS }
  )
}

// A recoverable error → redirect back to the client with OAuth error params.
function redirectError(redirectUri: string, state: string, error: string, description: string): NextResponse {
  const u = new URL(redirectUri)
  u.searchParams.set('error', error)
  u.searchParams.set('error_description', description)
  if (state) u.searchParams.set('state', state)
  return NextResponse.redirect(u.toString(), { status: 302 })
}

// Render the consent screen. All OAuth params ride through as hidden fields so
// the POST approval carries exactly what was validated. `errorMsg` shows a failed
// passcode attempt inline.
function renderConsent(p: AuthParams, cfg: OAuthConfig, status = 200, errorMsg = ''): NextResponse {
  const hidden = (['response_type', 'client_id', 'redirect_uri', 'scope', 'state', 'code_challenge', 'code_challenge_method', 'resource'] as const)
    .map(k => `<input type="hidden" name="${k}" value="${esc(p[k])}">`)
    .join('\n')
  const errorBlock = errorMsg
    ? `<p style="color:#b00020;margin:.5rem 0">${esc(errorMsg)}</p>`
    : ''
  const html = `<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>Authorize ChatGPT liaison</title></head>
<body style="font-family:system-ui;max-width:34rem;margin:3rem auto;padding:0 1.25rem;color:#1a1a1a">
  <h1 style="font-size:1.25rem;margin-bottom:.25rem">Authorize ChatGPT liaison</h1>
  <p style="color:#555;margin-top:0">Mission Control · ${esc(cfg.issuer)}</p>
  <div style="border:1px solid #e2e2e2;border-radius:10px;padding:1rem 1.25rem;margin:1.25rem 0;background:#fafafa">
    <p style="margin:.25rem 0"><strong>This connection can:</strong></p>
    <ul style="margin:.5rem 0 .25rem;padding-left:1.1rem;line-height:1.6">
      <li>Read Mission Control status (recent requests, what's stalled, results)</li>
      <li>Submit requests into the queue for a worker to pick up</li>
    </ul>
    <p style="margin:.75rem 0 .25rem;color:#777"><strong>It cannot:</strong> run code, deploy, read credentials, or spend money.</p>
  </div>
  <form method="POST" action="/oauth/authorize">
    ${hidden}
    <label style="display:block;margin:.25rem 0 .5rem;color:#333">Operator passcode
      <input type="password" name="passcode" autocomplete="off" required
        style="display:block;width:100%;max-width:20rem;margin-top:.35rem;padding:.55rem .6rem;border:1px solid #ccc;border-radius:8px;font-size:1rem">
    </label>
    ${errorBlock}
    <button type="submit" style="background:#111;color:#fff;border:0;border-radius:8px;padding:.7rem 1.4rem;font-size:1rem;cursor:pointer;margin-top:.5rem">Authorize</button>
  </form>
</body></html>`
  return new NextResponse(html, { status, headers: SECURITY_HEADERS })
}

// Validate hard preconditions (client + redirect) that gate everything else.
async function validateClientAndRedirect(
  p: AuthParams
): Promise<{ ok: true } | { ok: false; page: NextResponse }> {
  if (!p.client_id) return { ok: false, page: fatalPage('missing client_id') }
  const client = await getOAuthClient(p.client_id)
  if (!client) return { ok: false, page: fatalPage('unknown client_id') }
  if (!p.redirect_uri) return { ok: false, page: fatalPage('missing redirect_uri') }
  // Exact match against a registered redirect_uri — no prefix/substring leeway.
  if (!client.redirect_uris.includes(p.redirect_uri)) {
    return { ok: false, page: fatalPage('redirect_uri does not match the registered client') }
  }
  return { ok: true }
}

// Validate the remaining OAuth params. Failures here are safe to redirect back.
function validateRequest(p: AuthParams, cfg: OAuthConfig): NextResponse | null {
  if (p.response_type !== 'code') return redirectError(p.redirect_uri, p.state, 'unsupported_response_type', 'only response_type=code is supported')
  if (!p.code_challenge) return redirectError(p.redirect_uri, p.state, 'invalid_request', 'code_challenge is required (PKCE)')
  if (p.code_challenge_method !== 'S256') return redirectError(p.redirect_uri, p.state, 'invalid_request', 'code_challenge_method must be S256')
  if (p.scope && p.scope !== 'liaison') return redirectError(p.redirect_uri, p.state, 'invalid_scope', 'only the liaison scope is available')
  if (p.resource && p.resource !== cfg.resource) return redirectError(p.redirect_uri, p.state, 'invalid_target', 'resource does not match this MCP server')
  return null
}

export async function GET(req: NextRequest) {
  const cfg = getOAuthConfig()
  // Fail closed: no operator passcode configured → approval is impossible.
  if (!cfg.consentPasscode) return fatalPage('Operator approval is not configured (OAUTH_CONSENT_PASSCODE unset).')

  const p = readParams(req.nextUrl.searchParams)
  const gate = await validateClientAndRedirect(p)
  if (!gate.ok) return gate.page
  const paramErr = validateRequest(p, cfg)
  if (paramErr) return paramErr

  return renderConsent(p, cfg)
}

export async function POST(req: NextRequest) {
  const cfg = getOAuthConfig()
  if (!cfg.consentPasscode) return fatalPage('Operator approval is not configured (OAUTH_CONSENT_PASSCODE unset).')

  const form = await req.formData()
  const sp = new URLSearchParams()
  for (const [k, v] of form.entries()) sp.set(k, typeof v === 'string' ? v : '')
  const p = readParams(sp)
  const passcode = sp.get('passcode') ?? ''

  const gate = await validateClientAndRedirect(p)
  if (!gate.ok) return gate.page
  const paramErr = validateRequest(p, cfg)
  if (paramErr) return paramErr

  // Operator gate — the resource-owner proof. Wrong/missing passcode re-renders
  // the consent screen with an error and mints nothing.
  if (!passcode || !safeEqual(passcode, cfg.consentPasscode)) {
    return renderConsent(p, cfg, 401, 'Incorrect passcode.')
  }

  // Approved: mint a short-lived, single-use code bound to this client, redirect,
  // PKCE challenge, and resource. /token re-checks all of it.
  const code = await insertAuthCode({
    client_id: p.client_id,
    redirect_uri: p.redirect_uri,
    code_challenge: p.code_challenge,
    resource: p.resource || cfg.resource,
  })

  const u = new URL(p.redirect_uri)
  u.searchParams.set('code', code)
  if (p.state) u.searchParams.set('state', p.state)
  return NextResponse.redirect(u.toString(), { status: 302 })
}
