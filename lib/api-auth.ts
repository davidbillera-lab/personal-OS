import crypto from 'crypto'

/**
 * Bearer gate for server-to-server API routes that run on the service role.
 * Returns null when authorized, otherwise the Response to return immediately.
 */
export function requireBearer(req: Request): Response | null {
  const json = (body: object, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const expected = process.env.MCP_API_KEY
  if (!expected) return json({ error: 'server misconfigured' }, 503)

  const presented = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return json({ error: 'unauthorized' }, 401)

  return null
}
