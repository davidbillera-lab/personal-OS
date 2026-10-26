import { NextRequest, NextResponse } from 'next/server'
import { callTool, toolsForScope, isToolAllowed } from '@/lib/mcp-tools'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { getOAuthConfig, verifyAccessToken, isOAuthConfigured, isTokenRevoked, checkRateLimit, rateKey } from '@/lib/oauth'
import { LIAISON_INSTRUCTIONS } from '@/lib/liaison-workflows'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

// OAuth-gated MCP endpoint for the ChatGPT liaison and the claude.ai connector.
// A valid access token (JWT minted by /oauth/token, aud = this resource) carries
// its scope and actor: 'liaison' / 'chatgpt-liaison' or 'sync' / 'claude-ai'.
// Both dispatch through the SAME isToolAllowed / callTool / audit path as the
// bearer endpoint. Credential tools are invisible and forbidden to both scopes.
// The bearer worker endpoint (/api/mcp) and the no-auth probe are untouched.

const FALLBACK_PROTOCOL = '2025-06-18'
const SYNC_INSTRUCTIONS =
  'Mission Control sync for Claude. Read projects, tasks, the request queue and vault knowledge. ' +
  'The only writes are the session bookends: claim a task, complete it, update project status.'

// Append-only audit stamp — mirrors /api/mcp. Non-fatal: never breaks a response.
async function logAudit(actor: string, tool: string, ok: boolean, error?: string, requestId?: string | null) {
  try {
    const supabase = createAdminSupabaseClient()
    await supabase.from('mcp_audit_log').insert({
      actor,
      tool,
      ok,
      error: error ?? null,
      request_id: requestId ?? null,
    })
  } catch (err) {
    console.error('[mcp-liaison] audit log write failed (non-fatal):', err)
  }
}

function auditRequestId(args: Record<string, string | undefined>): string | null {
  const value = args.request_id ?? args.workflow_id
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
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

  // Scope and actor come from the verified claims; anything else gets the narrowest.
  const scope = (verdict.claims.scope === 'sync' ? 'sync' : 'liaison') as 'liaison' | 'sync'
  const actor = verdict.claims.sub || (scope === 'sync' ? 'claude-ai' : 'chatgpt-liaison')

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
        serverInfo: { name: scope === 'sync' ? 'mission-control-sync' : 'mission-control-liaison', version: '1.0.0' },
        instructions: scope === 'sync' ? SYNC_INSTRUCTIONS : LIAISON_INSTRUCTIONS,
      },
      version
    )
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 })
  }

  if (method === 'tools/list') {
    return jsonrpcResult(id, { tools: toolsForScope(scope) }, version)
  }

  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined
    const toolArgs = (params?.arguments ?? {}) as Record<string, string | undefined>
    const requestId = auditRequestId(toolArgs)

    if (!toolName) {
      await logAudit(actor, '(missing)', false, 'missing tool name')
      return jsonrpcError(id, -32602, 'Missing tool name')
    }
    // Scope gate — defense in depth beyond the filtered tools/list. A token
    // calling a tool outside its scope (e.g. credentials) is denied and audited.
    if (!isToolAllowed(toolName, scope)) {
      await logAudit(actor, toolName, false, 'forbidden: out of scope', requestId)
      return NextResponse.json(
        { jsonrpc: '2.0', id: id ?? null, error: { code: -32004, message: `Tool not permitted for this scope: ${toolName}` } },
        { status: 403 }
      )
    }

    try {
      const text = await callTool(toolName, toolArgs, actor)
      await logAudit(actor, toolName, true, undefined, requestId)
      return jsonrpcResult(id, { content: [{ type: 'text', text }] }, version)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await logAudit(actor, toolName, false, msg, requestId)
      return jsonrpcResult(id, { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }, version)
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`)
}

export function GET() {
  // No server-initiated SSE stream — Streamable-HTTP clients accept a 405 here.
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
