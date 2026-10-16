import { NextRequest, NextResponse } from 'next/server'
import { callTool, toolsForScope, isToolAllowed, type McpTokenScope } from '@/lib/mcp-tools'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { bearerToken, lookupApiKey } from '@/lib/api-auth'

export const runtime = 'nodejs' // needs Node crypto to hash the presented key

// Append-only audit stamp for every tool call through this HTTP route. Records the
// resolved actor, the tool, and whether it succeeded. Non-fatal: an audit failure
// must never break the caller's tool response.
async function logAudit(actor: string, tool: string, ok: boolean, error?: string, requestId?: string | null) {
  try {
    const supabase = createAdminSupabaseClient()
    const { error: auditError } = await supabase
      .from('mcp_audit_log')
      .insert({ actor, tool, ok, error: error ?? null, request_id: requestId ?? null })
    // PostgREST reports failures in the response rather than throwing, so a bare await
    // would drop audit rows silently while the route still claims a complete trail.
    if (auditError) console.error('[mcp] audit log write rejected (non-fatal):', auditError.message)
  } catch (err) {
    console.error('[mcp] audit log write failed (non-fatal):', err)
  }
}

function auditRequestId(args: Record<string, string | undefined>): string | null {
  const value = args.request_id ?? args.workflow_id
  return value && /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(value)
    ? value
    : null
}

// What a resolved token grants: a scope plus the actor name for the audit trail.
interface ResolvedAuth {
  scope: McpTokenScope
  actor: string
}

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
    { status: 401 }
  )
}

function misconfigured() {
  // Fail CLOSED: if the key datastore is unreachable, refuse everything rather
  // than falling back to an unrevocable env compare.
  console.error('[mcp] mcp_api_keys lookup unavailable — refusing request')
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32002, message: 'Server auth not configured' } },
    { status: 503 }
  )
}

function forbidden(id: unknown, message: string) {
  return NextResponse.json(
    { jsonrpc: '2.0', id: id ?? null, error: { code: -32004, message } },
    { status: 403 }
  )
}

// Resolve the privilege the presented token grants. Only an active mcp_api_keys row
// grants access; an unknown, revoked or expired key is rejected. No env-var fallback
// since M2 (spec §3.5) — env vars bake into immutable deployments and can't be revoked.
async function resolveAuth(req: NextRequest): Promise<ResolvedAuth | null | 'unavailable'> {
  const key = await lookupApiKey(bearerToken(req))
  if (key.status === 'error') return 'unavailable'
  if (key.status === 'active') return { scope: key.scope, actor: key.actor }
  return null
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

function jsonrpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result })
}

export async function POST(req: NextRequest) {
  // Auth — fail closed. Key datastore unreachable -> refuse everything.
  const auth = await resolveAuth(req)
  if (auth === 'unavailable') return misconfigured()
  if (!auth) return unauthorized()
  const { scope, actor } = auth

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonrpcError(null, -32700, 'Parse error')
  }

  const { id, method, params } = body

  // MCP initialize handshake. Echo the client's requested protocol version
  // (falling back to a current one) rather than hard-coding a legacy version —
  // a hard-coded '2024-11-05' fails newer clients' handshakes.
  if (method === 'initialize') {
    const version =
      (params?.protocolVersion as string | undefined) ||
      req.headers.get('mcp-protocol-version') ||
      '2025-06-18'
    return jsonrpcResult(id, {
      protocolVersion: version,
      capabilities: { tools: {} },
      serverInfo: { name: 'mission-control', version: '1.0.0' },
    })
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 })
  }

  // Tool discovery — only advertise tools the caller's token may use.
  if (method === 'tools/list') {
    return jsonrpcResult(id, { tools: toolsForScope(scope) })
  }

  // Tool execution
  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined
    const toolArgs = (params?.arguments ?? {}) as Record<string, string | undefined>
    const requestId = auditRequestId(toolArgs)

    if (!toolName) {
      await logAudit(actor, '(missing)', false, 'missing tool name')
      return jsonrpcError(id, -32602, 'Missing tool name')
    }

    // Scope gate — a read-only token can't call write/privileged tools even if
    // it knows the name. Defense in depth beyond filtering tools/list. Logged as a
    // denied call so a read key probing a write tool leaves an audit trail.
    if (!isToolAllowed(toolName, scope)) {
      await logAudit(actor, toolName, false, 'forbidden: out of scope', requestId)
      return forbidden(id, `Tool not permitted for this scope: ${toolName}`)
    }

    try {
      const text = await callTool(toolName, toolArgs, actor)
      await logAudit(actor, toolName, true, undefined, requestId)
      return jsonrpcResult(id, {
        content: [{ type: 'text', text }],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await logAudit(actor, toolName, false, msg, requestId)
      return jsonrpcResult(id, {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      })
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`)
}
