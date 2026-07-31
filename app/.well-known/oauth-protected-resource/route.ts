import { NextResponse } from 'next/server'
import { getOAuthConfig } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// RFC 9728 protected-resource metadata. ChatGPT reads this (directly or via the
// WWW-Authenticate hint on a 401 from /api/mcp-liaison) to learn which
// authorization server guards the MCP resource.
export function GET() {
  const cfg = getOAuthConfig()
  return NextResponse.json(
    {
      resource: cfg.resource,
      authorization_servers: [cfg.issuer],
      scopes_supported: ['liaison'],
      bearer_methods_supported: ['header'],
      resource_documentation: `${cfg.issuer}/oauth/authorize`,
    },
    { headers: { 'Cache-Control': 'no-store' } }
  )
}
