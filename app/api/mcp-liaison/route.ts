import { NextRequest, NextResponse } from 'next/server'
import { callTool, toolsForScope, isToolAllowed } from '@/lib/mcp-tools'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { getOAuthConfig, verifyAccessToken, isOAuthConfigured, isTokenRevoked, checkRateLimit, rateKey } from '@/lib/oauth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// OAuth-gated MCP endpoint for the ChatGPT liaison.
// A valid liaison access token (JWT minted by /oauth/token, aud = this resource)
// resolves to actor 'chatgpt-liaison' + scope 'liaison' — then dispatches through
// the SAME isToolAllowed / callTool / audit path as the bearer endpoint. Workers,
// vault, and credential tools are invisible and forbidden (scope 'liaison').
// The bearer worker endpoint (/api/mcp) and the no-auth probe are untouched.

const FALLBACK_PROTOCOL = '2025-06-18'
const SCOPE = 'liaison' as const
const ACTOR = 'chatgpt-liaison'

// Append-only audit stamp — mirrors /api/mcp. Non-fatal: never breaks a response.
async function logAudit(tool: string, ok: boolean, error?: string) {
  try {
    const supabase = createAdminSupabaseClient()
    await supabase.from('mcp_audit_log').insert({ actor: ACTOR, tool, ok, error: error ?? null })
  } catch (err) {
    console.error('[mcp-liaison] audit log write failed (non-fatal):', err)
  }
}

function jsonrpcResult(id: unknown, result: unknown, version: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, result },
    { headers: { 'MCP-Protocol-Version': version } }
  )
}
function jsonrpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

// 401 that points ChatGPT at the protected-resource metadata (RFC 9728), so a
// client with no/invalid token can discover the authorization server.
// Strip anything that could break out of an HTTP header quoted-string. Reasons
// are internal literals today; this keeps the header well-formed if that changes.
function headerSafe(s: string): string {
  return s.replace(/[^\x20-\x7E]/g, '').replace(/["\\]/g, '')
}

function unauthorized(reason: string) {
  const meta = isOAuthConfigured() ? `${getOAuthConfig().issuer}/.well-known/oauth-protected-resource` : ''
  const desc = headerSafe(reason)
  const challenge = meta
    ? `Bearer error="invalid_token", error_description="${desc}", resource_metadata="${meta}"`
    : `Bearer error="invalid_token", error_description="${desc}"`
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
    { status: 401, headers: { 'WWW-Authenticate': challenge } }
  )
}

function extractBearer(req: NextRequest): string | null {
  const h = req.headers.get('authorization') ?? ''
  return h.startsWith('Bearer ') ? h.slice(7) : null
}

export async function POST(req: NextRequest) {
  if (!isOAuthConfigured()) {
    // Fail closed if the facade isn't configured, rather than serving unauthenticated.
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32002, message: 'OAuth not configured' } },
      { status: 503 }
    )
  }
  const cfg = getOAuthConfig()

  const token = extractBearer(req)
  if (!token) return unauthorized('missing bearer token')
  const verdict = verifyAccessToken(token, cfg)
  if (!verdict.valid || !verdict.claims) return unauthorized(verdict.reason ?? 'invalid token')

  // Global revocation kill-switch — reject tokens issued before oauth_config.revoked_before.
  if (await isTokenRevoked(verdict.claims.iat)) return unauthorized('token revoked')

  // Per-token throttle: 60 calls / min / jti. Caps a leaked token's blast radius
  // within its short TTL.
  if (!(await checkRateLimit(rateKey('mcp', verdict.claims.jti), 60, 60))) {
    return NextResponse.json(
      { jsonrpc: '2.0', id: null, error: { code: -32029, message: 'Rate limit exceeded' } },
      { status: 429 }
    )
  }

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonrpcError(null, -32700, 'Parse error')
  }

  const { id, method, params } = body
  const version =
    (params?.protocolVersion as string | undefined) ||
    req.headers.get('mcp-protocol-version') ||
    FALLBACK_PROTOCOL

  if (method === 'initialize') {
    return jsonrpcResult(
      id,
      {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: 'mission-control-liaison', version: '1.0.0' },
      },
      version
    )
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 })
  }

  if (method === 'tools/list') {
    return jsonrpcResult(id, { tools: toolsForScope(SCOPE) }, version)
  }

  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined
    const toolArgs = (params?.arguments ?? {}) as Record<string, string | undefined>

    if (!toolName) {
      await logAudit('(missing)', false, 'missing tool name')
      return jsonrpcError(id, -32602, 'Missing tool name')
    }
    // Scope gate — defense in depth beyond the filtered tools/list. A liaison
    // token calling a worker/vault/credential tool is denied and audited.
    if (!isToolAllowed(toolName, SCOPE)) {
      await logAudit(toolName, false, 'forbidden: out of scope')
      return NextResponse.json(
        { jsonrpc: '2.0', id: id ?? null, error: { code: -32004, message: `Tool not permitted for this scope: ${toolName}` } },
        { status: 403 }
      )
    }

    try {
      const text = await callTool(toolName, toolArgs, ACTOR)
      await logAudit(toolName, true)
      return jsonrpcResult(id, { content: [{ type: 'text', text }] }, version)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await logAudit(toolName, false, msg)
      return jsonrpcResult(id, { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }, version)
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`)
}

export function GET() {
  // No server-initiated SSE stream — Streamable-HTTP clients accept a 405 here.
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
