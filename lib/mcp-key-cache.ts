// In-process cache over mcp_api_keys lookups (migration 027). Kept free of the
// Supabase client so it can be tested directly; lib/api-auth.ts wires the fetch.

export type KeyScope = 'full' | 'read' | 'liaison' | 'orchestrator'

export interface KeyRow {
  scope: KeyScope
  actor: string
  revoked_at: string | null
  expires_at: string | null
}

export type KeyLookup =
  | { status: 'active'; scope: KeyScope; actor: string }
  | { status: 'revoked' } // revoked or expired — rejected even if an env fallback would match
  | { status: 'unknown' } // no row for this hash
  | { status: 'error' } // datastore unreachable — callers fail closed (503)

// Rows (including "no row") are cached per hash for ttlMs, mirroring getRevokedBefore
// in lib/oauth.ts, so a revoke lands everywhere within one TTL. Expiry is re-checked
// on every call against the cached row. Fetch errors are never cached.
export function createKeyLookup(
  fetchRow: (hash: string) => Promise<KeyRow | null>,
  opts: { ttlMs?: number; maxEntries?: number; now?: () => number } = {}
) {
  const ttlMs = opts.ttlMs ?? 60_000
  const maxEntries = opts.maxEntries ?? 1000
  const now = opts.now ?? Date.now
  const cache = new Map<string, { row: KeyRow | null; at: number }>()

  return async function lookup(hash: string): Promise<KeyLookup> {
    const t = now()
    const hit = cache.get(hash)
    let row: KeyRow | null
    if (hit && t - hit.at < ttlMs) {
      row = hit.row
    } else {
      try {
        row = await fetchRow(hash)
      } catch (err) {
        console.error('[api-auth] mcp_api_keys lookup failed (refusing):', err)
        return { status: 'error' }
      }
      // minimal: flush-all bounds memory against random-bearer floods; swap for LRU if it ever churns
      if (cache.size >= maxEntries) cache.clear()
      cache.set(hash, { row, at: t })
    }
    if (!row) return { status: 'unknown' }
    if (row.revoked_at || (row.expires_at && Date.parse(row.expires_at) <= t)) return { status: 'revoked' }
    return { status: 'active', scope: row.scope, actor: row.actor }
  }
}
