import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { callTool, toolsForScope, isToolAllowed, type McpTokenScope } from '@/lib/mcp-tools'

export const runtime = 'nodejs' // needs Node crypto for the timing-safe token check

const MCP_API_KEY = process.env.MCP_API_KEY
// Optional read-only token. When set, it grants access to read-scoped tools
// only — intended for low-trust clients like a phone connector. If unset, the
// read scope is simply inactive and only the full token works (back-compat).
const MCP_READONLY_API_KEY = process.env.MCP_READONLY_API_KEY

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
    { status: 401 }
  )
}

function misconfigured() {
  // Fail CLOSED: if no key is configured on the server, refuse everything
  // rather than silently serving an open endpoint.
  console.error('[mcp] MCP_API_KEY not set — refusing all requests')
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

// Constant-time bearer comparison (avoids leaking the token via response timing).
function bearerMatches(req: NextRequest, key: string): boolean {
  const presented = Buffer.from(req.headers.get('authorization') ?? '')
  const expected = Buffer.from(`Bearer ${key}`)
  return presented.length === expected.length && crypto.timingSafeEqual(presented, expected)
}

// Resolve the privilege the presented token grants:
//   'full' — MCP_API_KEY, every tool
//   'read' — MCP_READONLY_API_KEY (if configured), read-scoped tools only
//   null   — no match, reject
// Both comparisons run when applicable so timing doesn't reveal which token matched.
function resolveScope(req: NextRequest): McpTokenScope | null {
  const isFull = MCP_API_KEY ? bearerMatches(req, MCP_API_KEY) : false
  const isRead = MCP_READONLY_API_KEY ? bearerMatches(req, MCP_READONLY_API_KEY) : false
  if (isFull) return 'full'
  if (isRead) return 'read'
  return null
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

function jsonrpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result })
}

export async function POST(req: NextRequest) {
  // Auth — fail closed. No full key configured -> refuse everything.
  if (!MCP_API_KEY) return misconfigured()
  const scope = resolveScope(req)
  if (!scope) return unauthorized()

  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonrpcError(null, -32700, 'Parse error')
  }

  const { id, method, params } = body

  // MCP initialize handshake
  if (method === 'initialize') {
    return jsonrpcResult(id, {
      protocolVersion: '2024-11-05',
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

    if (!toolName) return jsonrpcError(id, -32602, 'Missing tool name')

    // Scope gate — a read-only token can't call write/privileged tools even if
    // it knows the name. Defense in depth beyond filtering tools/list.
    if (!isToolAllowed(toolName, scope)) {
      return forbidden(id, `Tool not permitted for this scope: ${toolName}`)
    }

    try {
      const text = await callTool(toolName, toolArgs)
      return jsonrpcResult(id, {
        content: [{ type: 'text', text }],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return jsonrpcResult(id, {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      })
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`)
}
