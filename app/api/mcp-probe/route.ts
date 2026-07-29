import { NextRequest, NextResponse } from 'next/server'

// THROWAWAY Phase-0 Voice-reachability probe.
// No auth, canned data only, NO real Mission Control access. Its sole purpose is
// to prove that a custom MCP connector actually FIRES from ChatGPT Voice in Work
// (desktop + iPhone Remote) in David's workspace, before any OAuth facade is built.
// Every call is console.logged so invocation can be confirmed in Vercel runtime
// logs — proof the tool ran on the server, not that ChatGPT guessed from the schema.
// DELETE this route after Phase 0.

export const runtime = 'nodejs'

// If the client doesn't advertise a protocol version, answer with a current one.
const FALLBACK_PROTOCOL = '2025-06-18'

// Read-only mock tools with obviously-fake data. readOnlyHint so a client treats
// them as non-mutating (also exercises annotation handling end-to-end).
const TOOLS = [
  {
    name: 'mc_probe_whats_stalled',
    description: 'MOCK PROBE. Returns a canned example of what is "stalled" — fake data for a connectivity test only, NOT real Mission Control status.',
    inputSchema: { type: 'object', properties: {} },
    annotations: { readOnlyHint: true },
  },
  {
    name: 'mc_probe_echo',
    description: 'MOCK PROBE. Echoes the given message back with a server-generated timestamp and marker, proving the tool executed on the server.',
    inputSchema: {
      type: 'object',
      properties: { message: { type: 'string', description: 'Any text to echo back' } },
      required: ['message'],
    },
    annotations: { readOnlyHint: true },
  },
]

function callProbeTool(name: string, args: Record<string, unknown>): string {
  const now = new Date().toISOString()
  if (name === 'mc_probe_whats_stalled') {
    return JSON.stringify({
      note: 'MOCK PROBE DATA — not real Mission Control state',
      server_time: now,
      stalled: [
        { project: 'Example Alpha (FAKE)', blocker: 'Waiting on a spec approval that does not exist', since: '3 days' },
        { project: 'Example Beta (FAKE)', blocker: 'Placeholder blocker for the voice connectivity test', since: '1 day' },
      ],
    })
  }
  if (name === 'mc_probe_echo') {
    const message = typeof args.message === 'string' ? args.message : ''
    return JSON.stringify({ note: 'MOCK PROBE ECHO', echoed: message, server_time: now, marker: 'VOICE-PROBE-OK' })
  }
  throw new Error(`Unknown probe tool: ${name}`)
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

export async function POST(req: NextRequest) {
  let body: { jsonrpc?: string; id?: unknown; method?: string; params?: Record<string, unknown> }
  try {
    body = await req.json()
  } catch {
    return jsonrpcError(null, -32700, 'Parse error')
  }

  const { id, method, params } = body
  // Version negotiation: echo the client's requested version (from initialize
  // params, or the MCP-Protocol-Version header on later calls) rather than
  // hard-coding a legacy one — the fix flagged on the real /api/mcp endpoint.
  const version =
    (params?.protocolVersion as string | undefined) ||
    req.headers.get('mcp-protocol-version') ||
    FALLBACK_PROTOCOL

  if (method === 'initialize') {
    console.log(`[mcp-probe] initialize protocol=${version} at ${new Date().toISOString()}`)
    return jsonrpcResult(
      id,
      {
        protocolVersion: version,
        capabilities: { tools: {} },
        serverInfo: { name: 'mc-voice-probe (throwaway)', version: '0.1.0' },
      },
      version
    )
  }

  if (method === 'notifications/initialized') {
    return new NextResponse(null, { status: 204 })
  }

  if (method === 'tools/list') {
    console.log(`[mcp-probe] tools/list at ${new Date().toISOString()}`)
    return jsonrpcResult(id, { tools: TOOLS }, version)
  }

  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined
    const toolArgs = (params?.arguments ?? {}) as Record<string, unknown>
    console.log(`[mcp-probe] tools/call name=${toolName ?? '(missing)'} at ${new Date().toISOString()}`)
    if (!toolName) return jsonrpcError(id, -32602, 'Missing tool name')
    try {
      const text = callProbeTool(toolName, toolArgs)
      return jsonrpcResult(id, { content: [{ type: 'text', text }] }, version)
    } catch (err) {
      const msg = err instanceof Error ? err.message : String(err)
      return jsonrpcResult(id, { content: [{ type: 'text', text: `Error: ${msg}` }], isError: true }, version)
    }
  }

  return jsonrpcError(id, -32601, `Method not found: ${method}`)
}

export function GET() {
  // No server-initiated SSE stream on this probe. Streamable-HTTP clients accept
  // a 405 here when the server offers no GET stream.
  return new NextResponse('Method Not Allowed', { status: 405, headers: { Allow: 'POST' } })
}
