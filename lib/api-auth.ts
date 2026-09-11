import crypto from 'crypto'
import { createAdminSupabaseClient } from '@/lib/supabase'
import { hashCode } from '@/lib/oauth'
import { createKeyLookup, type KeyLookup, type KeyRow } from '@/lib/mcp-key-cache'

// Datastore-backed API keys (migration 027): only SHA-256 hashes are stored, and
// revoke = UPDATE mcp_api_keys SET revoked_at = now() — live everywhere within 60s.
const lookupHash = createKeyLookup(async hash => {
  const { data, error } = await createAdminSupabaseClient()
    .from('mcp_api_keys')
    .select('scope, actor, revoked_at, expires_at')
    .eq('key_hash', hash)
    .maybeSingle()
  if (error) throw new Error(error.message)
  return data as KeyRow | null
})

export function lookupApiKey(token: string): Promise<KeyLookup> {
  return token ? lookupHash(hashCode(token)) : Promise.resolve({ status: 'unknown' })
}

export function bearerToken(req: Request): string {
  return (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '')
}

/**
 * Bearer gate for server-to-server API routes that run on the service role.
 * Requires a full-scope key. Returns null when authorized, otherwise the Response
 * to return immediately.
 */
export async function requireBearer(req: Request): Promise<Response | null> {
  const json = (body: object, status: number) =>
    new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } })

  const presented = bearerToken(req)
  const key = await lookupApiKey(presented)
  if (key.status === 'error') return json({ error: 'auth unavailable' }, 503)
  if (key.status === 'active') return key.scope === 'full' ? null : json({ error: 'forbidden' }, 403)
  if (key.status === 'revoked') return json({ error: 'unauthorized' }, 401)

  // M0 fallback (spec §3.5): the env key is honored only when no row exists for its
  // hash, so revoking its row still kills it. Delete this branch at M2.
  const expected = process.env.MCP_API_KEY
  if (!expected) return json({ error: 'unauthorized' }, 401)
  const a = Buffer.from(presented)
  const b = Buffer.from(expected)
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) return json({ error: 'unauthorized' }, 401)

  return null
}
