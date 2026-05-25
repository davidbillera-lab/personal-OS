import OpenAI from 'openai'
import { createServerSupabaseClient } from '@/lib/supabase'
import { encrypt } from '@/lib/crypto'
import type { VaultItem } from '@/lib/types'

let _openai: OpenAI | null = null
function openaiClient() {
  if (!_openai) _openai = new OpenAI({ apiKey: process.env.OPENAI_API_KEY })
  return _openai
}

// For encrypted items, embed title only — content never sent to OpenAI
export async function embedVaultItem(title: string, content: string, isEncrypted: boolean): Promise<number[]> {
  const input = isEncrypted ? title : `${title} ${content}`
  const res = await openaiClient().embeddings.create({
    model: 'text-embedding-3-small',
    input,
  })
  return res.data[0].embedding
}

// MCP semantic search: returns only is_mcp_accessible items, excludes encrypted + personal
export async function queryVaultContext(query: string, limit = 8): Promise<Omit<VaultItem, 'embedding'>[]> {
  const supabase = await createServerSupabaseClient()
  const queryEmbedding = await embedVaultItem(query, '', false)

  const { data, error } = await supabase.rpc('match_vault_items', {
    query_embedding: queryEmbedding,
    match_count: limit,
  })

  if (error) throw new Error(error.message)
  return (data ?? []) as Omit<VaultItem, 'embedding'>[]
}

// One-time seed: copy existing credentials table rows into vault_items
export async function seedCredentialsToVault(): Promise<{ seeded: number; skipped: number }> {
  const supabase = await createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('vault_items')
    .select('source_id')
    .eq('source_table', 'credentials')
    .eq('type', 'credential')

  const existingSourceIds = new Set((existing ?? []).map(r => r.source_id))

  const { data: creds, error } = await supabase
    .from('credentials')
    .select('id, name, key_name, notes, tier, is_mcp_accessible')

  if (error) throw new Error(error.message)

  let seeded = 0
  let skipped = 0

  for (const cred of (creds ?? [])) {
    if (existingSourceIds.has(cred.id)) { skipped++; continue }

    const title = cred.name
    const content = encrypt(`key_name: ${cred.key_name}`)
    const embedding = await embedVaultItem(title, '', true)

    await supabase.from('vault_items').insert({
      type: 'credential' as const,
      title,
      content,
      encrypted: true,
      is_mcp_accessible: false,
      source_table: 'credentials',
      source_id: cred.id,
      metadata: { key_name: cred.key_name, notes: cred.notes ?? null, tier: cred.tier },
      embedding,
    })
    seeded++
  }

  return { seeded, skipped }
}
