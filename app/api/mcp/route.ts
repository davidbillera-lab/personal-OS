'use server'

import { NextRequest, NextResponse } from 'next/server'
import { MCP_TOOLS, callTool } from '@/lib/mcp-tools'

const MCP_API_KEY = process.env.MCP_API_KEY

function unauthorized() {
  return NextResponse.json(
    { jsonrpc: '2.0', id: null, error: { code: -32001, message: 'Unauthorized' } },
    { status: 401 }
  )
}

function jsonrpcError(id: unknown, code: number, message: string) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } })
}

function jsonrpcResult(id: unknown, result: unknown) {
  return NextResponse.json({ jsonrpc: '2.0', id: id ?? null, result })
}

export async function POST(req: NextRequest) {
  // Auth
  const auth = req.headers.get('authorization') ?? ''
  if (MCP_API_KEY && auth !== `Bearer ${MCP_API_KEY}`) {
    return unauthorized()
  }

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

  // Tool discovery
  if (method === 'tools/list') {
    return jsonrpcResult(id, { tools: MCP_TOOLS })
  }

  // Tool execution
  if (method === 'tools/call') {
    const toolName = params?.name as string | undefined
    const toolArgs = (params?.arguments ?? {}) as Record<string, string | undefined>

    if (!toolName) return jsonrpcError(id, -32602, 'Missing tool name')

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
