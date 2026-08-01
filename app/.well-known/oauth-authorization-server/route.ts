import { NextResponse } from 'next/server'
import { getOAuthConfig } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RFC 8414 authorization-server metadata. Advertises the endpoints, the
// authorization-code + refresh_token grants, mandatory PKCE S256, DCR, and the
// 'liaison' + 'offline_access' scopes. Public PKCE client →
// token_endpoint_auth_method 'none'.
export function GET() {
  const cfg = getOAuthConfig()
  return NextResponse.json(
    {
      issuer: cfg.issuer,
      authorization_endpoint: `${cfg.issuer}/oauth/authorize`,
      token_endpoint: `${cfg.issuer}/oauth/token`,
      registration_endpoint: `${cfg.issuer}/oauth/register`,
      response_types_supported: ['code'],
      grant_types_supported: ['authorization_code', 'refresh_token'],
      code_challenge_methods_supported: ['S256'],
      token_endpoint_auth_methods_supported: ['none'],
      scopes_supported: ['liaison', 'offline_access'],
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
