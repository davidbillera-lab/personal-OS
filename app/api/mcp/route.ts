import { NextRequest, NextResponse } from 'next/server'
import crypto from 'crypto'
import { callTool, toolsForScope, isToolAllowed, type McpTokenScope } from '@/lib/mcp-tools'
import { createAdminSupabaseClient } from '@/lib/supabase'

export const runtime = 'nodejs' // needs Node crypto for the timing-safe token check

// Append-only audit stamp for every tool call through this HTTP route. Records the
// resolved actor, the tool, and whether it succeeded. Non-fatal: an audit failure
// must never break the caller's tool response.
async function logAudit(actor: string, tool: string, ok: boolean, error?: string) {
  try {
    const supabase = createAdminSupabaseClient()
    await supabase.from('mcp_audit_log').insert({ actor, tool, ok, error: error ?? null })
  } catch (err) {
    console.error('[mcp] audit log write failed (non-fatal):', err)
  }
}

const MCP_API_KEY = process.env.MCP_API_KEY
// Legacy single read-only token. When set, it grants access to read-scoped tools
// only and is now mapped to the actor "hermes" (its original consumer). Kept for
// back-compat so Hermes never breaks; new per-agent keys live in MCP_READONLY_KEYS.
const MCP_READONLY_API_KEY = process.env.MCP_READONLY_API_KEY
// Per-agent read-only keys as a JSON object of { actor: key }, e.g.
// {"hermes":"...","chatgpt-liaison":"..."}. Each key grants the read scope; the
// matched actor name is stamped into the audit log so we can tell callers apart.
const MCP_READONLY_KEYS = process.env.MCP_READONLY_KEYS

// Parse MCP_READONLY_KEYS into a { actor: key } map once at module load. The
// legacy MCP_READONLY_API_KEY is deliberately NOT merged in here — it is checked
// independently in resolveAuth so a map entry can never shadow or disable it.
function loadReadonlyKeys(): Record<string, string> {
  const map: Record<string, string> = {}
  if (!MCP_READONLY_KEYS) return map
  let parsed: unknown
  try {
    parsed = JSON.parse(MCP_READONLY_KEYS)
  } catch {
    // Fail closed on the read scope only — never affects the full token.
    console.error('[mcp] MCP_READONLY_KEYS is not valid JSON — ignoring')
    return map
  }
  // Must be a plain object of { actor: key }. A bare string or array would make
  // Object.entries() emit per-character/per-index entries — i.e. turn a paste
  // mistake into a set of one-character read keys. Reject anything else, loudly.
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    console.error('[mcp] MCP_READONLY_KEYS must be a JSON object of {actor: key} — ignoring')
    return map
  }
  for (const [actor, key] of Object.entries(parsed as Record<string, unknown>)) {
    if (typeof key === 'string' && key) map[actor] = key
  }
  return map
}
const READONLY_KEYS = loadReadonlyKeys()

// What a resolved token grants: a scope plus the actor name for the audit trail.
// Full-token callers (Claude Code, the dashboard) share one identity: "full".
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
//   { scope: 'full', actor: 'full' }        — MCP_API_KEY, every tool
//   { scope: 'read', actor: <name> }        — a per-agent read key, read-scoped tools only
//   null                                     — no match, reject
// Every comparison runs (no early break) so timing doesn't reveal which token matched.
function resolveAuth(req: NextRequest): ResolvedAuth | null {
  const isFull = MCP_API_KEY ? bearerMatches(req, MCP_API_KEY) : false
  let readActor: string | null = null
  // Legacy single read key — checked independently so the per-agent map can never
  // shadow or disable it. Maps to the "hermes" actor (its original consumer).
  if (MCP_READONLY_API_KEY && bearerMatches(req, MCP_READONLY_API_KEY)) readActor = 'hermes'
  // Per-agent read keys. No early break: every comparison runs so timing doesn't
  // reveal which key (if any) matched.
  for (const [actor, key] of Object.entries(READONLY_KEYS)) {
    if (bearerMatches(req, key)) readActor = actor
  }
  if (isFull) return { scope: 'full', actor: 'full' }
  if (readActor) return { scope: 'read', actor: readActor }
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
  const auth = resolveAuth(req)
  if (!auth) return unauthorized()
  const { scope, actor } = auth

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

    if (!toolName) {
      await logAudit(actor, '(missing)', false, 'missing tool name')
      return jsonrpcError(id, -32602, 'Missing tool name')
    }

    // Scope gate — a read-only token can't call write/privileged tools even if
    // it knows the name. Defense in depth beyond filtering tools/list. Logged as a
    // denied call so a read key probing a write tool leaves an audit trail.
    if (!isToolAllowed(toolName, scope)) {
      await logAudit(actor, toolName, false, 'forbidden: out of scope')
      return forbidden(id, `Tool not permitted for this scope: ${toolName}`)
    }

    try {
      const text = await callTool(toolName, toolArgs)
      await logAudit(actor, toolName, true)
      return jsonrpcResult(id, {
        content: [{ type: 'text', text }],
      })
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      await logAudit(actor, toolName, false, msg)
      return jsonrpcResult(id, {
        content: [{ type: 'text', text: `Error: ${msg}` }],
        isError: true,
      })
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`)
}
