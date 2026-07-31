import { NextRequest, NextResponse } from 'next/server'
import { getOAuthConfig, isRegistrableRedirectUri, createOAuthClient } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// Dynamic Client Registration (RFC 7591). ChatGPT posts its client metadata
// (chiefly redirect_uris) and gets back a client_id. We are a public PKCE
// authorization server: no client_secret is issued. Registration is guarded so
// only callbacks under the ChatGPT connector domain (or the exact configured
// CHATGPT_REDIRECT_URI) can register — nothing else can obtain a client_id.
export async function POST(req: NextRequest) {
  const cfg = getOAuthConfig()

  let body: { redirect_uris?: unknown; client_name?: unknown; token_endpoint_auth_method?: unknown }
  try {
    body = await req.json()
  } catch {
    return NextResponse.json({ error: 'invalid_client_metadata', error_description: 'body must be JSON' }, { status: 400 })
  }

  const redirectUris = body.redirect_uris
  if (!Array.isArray(redirectUris) || redirectUris.length === 0 || !redirectUris.every(u => typeof u === 'string')) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: 'redirect_uris (non-empty array of strings) is required' },
      { status: 400 }
    )
  }

  // Every requested redirect_uri must be registrable — reject the whole request
  // if any one isn't, so a valid ChatGPT URI can't smuggle in an extra one.
  const bad = (redirectUris as string[]).find(u => !isRegistrableRedirectUri(u, cfg))
  if (bad) {
    return NextResponse.json(
      { error: 'invalid_redirect_uri', error_description: `redirect_uri not permitted: ${bad}` },
      { status: 400 }
    )
  }

  const client = await createOAuthClient({
    redirect_uris: redirectUris as string[],
    client_name: typeof body.client_name === 'string' ? body.client_name : undefined,
  })

  // RFC 7591 registration response for a public client.
  return NextResponse.json(
    {
      client_id: client.client_id,
      redirect_uris: client.redirect_uris,
      grant_types: ['authorization_code'],
      response_types: ['code'],
      token_endpoint_auth_method: 'none',
      scope: 'liaison',
    },
    { status: 201, headers: { 'Cache-Control': 'no-store' } }
  )
}
