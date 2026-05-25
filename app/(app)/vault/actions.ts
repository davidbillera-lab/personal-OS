'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'
import { Credential, CredentialTier, VaultItem, VaultItemType } from '@/lib/types'
import { revalidatePath } from 'next/cache'
import { embedVaultItem } from '@/lib/vault'

export type CredentialListItem = Omit<Credential, 'value'> & { masked_value: string }

export async function listCredentials(): Promise<CredentialListItem[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('credentials')
    .select('id, name, key_name, tier, project_id, is_mcp_accessible, notes, created_at, updated_at')
    .order('tier', { ascending: true })
    .order('name', { ascending: true })
  if (error) throw new Error(error.message)
  return (data ?? []).map(row => ({ ...row, masked_value: '••••••••' })) as CredentialListItem[]
}

export async function addCredential(params: {
  name: string
  key_name: string
  value: string
  tier: CredentialTier
  project_id?: string | null
  is_mcp_accessible?: boolean
  notes?: string | null
}): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const encrypted = encrypt(params.value)
  const { error } = await supabase.from('credentials').insert({
    name: params.name,
    key_name: params.key_name,
    value: encrypted,
    tier: params.tier,
    project_id: params.project_id ?? null,
    is_mcp_accessible: params.is_mcp_accessible ?? true,
    notes: params.notes ?? null,
  })
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function updateCredential(
  id: string,
  params: {
    name?: string
    key_name?: string
    value?: string
    tier?: CredentialTier
    project_id?: string | null
    is_mcp_accessible?: boolean
    notes?: string | null
  }
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const updates: Record<string, unknown> = { ...params, updated_at: new Date().toISOString() }
  if (params.value) {
    updates.value = encrypt(params.value)
  } else {
    delete updates.value
  }
  const { error } = await supabase.from('credentials').update(updates).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function deleteCredential(id: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('credentials').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function revealCredential(id: string): Promise<{ value?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('credentials')
    .select('value, key_name')
    .eq('id', id)
    .single()
  if (error || !data) return { error: error?.message ?? 'Not found' }

  await supabase.from('credential_access_log').insert({
    key_name: data.key_name,
    accessed_by: 'ui',
  })

  try {
    return { value: decrypt(data.value) }
  } catch {
    return { error: 'Decryption failed — check CREDENTIAL_ENCRYPTION_KEY' }
  }
}

// ─── Vault Items ──────────────────────────────────────────────

export type VaultItemListItem = Omit<VaultItem, 'embedding'>

export async function listVaultItems(params?: {
  type?: VaultItemType | 'all'
  search?: string
}): Promise<VaultItemListItem[]> {
  const supabase = await createServerSupabaseClient()
  let query = supabase
    .from('vault_items')
    .select('id, type, title, content, encrypted, tags, project_id, source_table, source_id, is_mcp_accessible, metadata, created_at, updated_at')
    .order('created_at', { ascending: false })

  if (params?.type && params.type !== 'all') {
    query = query.eq('type', params.type)
  }
  if (params?.search) {
    query = query.ilike('title', `%${params.search}%`)
  }

  const { data, error } = await query
  if (error) throw new Error(error.message)
  return (data ?? []) as VaultItemListItem[]
}

export async function createVaultItem(params: {
  type: VaultItemType
  title: string
  content: string
  tags?: string[]
  project_id?: string | null
  is_mcp_accessible?: boolean
  metadata?: Record<string, unknown>
}): Promise<{ id?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()

  const isEncrypted = params.type === 'personal' || params.type === 'credential'
  const isMcpAccessible = isEncrypted ? false : (params.is_mcp_accessible ?? false)

  let storedContent = params.content
  if (isEncrypted) {
    storedContent = encrypt(params.content)
  }

  let embedding: number[] | null = null
  try {
    embedding = await embedVaultItem(params.title, params.content, isEncrypted)
  } catch {
    // Non-fatal: item saves without embedding; search will skip it
  }

  const { data, error } = await supabase
    .from('vault_items')
    .insert({
      type: params.type,
      title: params.title,
      content: storedContent,
      encrypted: isEncrypted,
      tags: params.tags ?? [],
      project_id: params.project_id ?? null,
      is_mcp_accessible: isMcpAccessible,
      metadata: params.metadata ?? {},
      embedding,
    })
    .select('id')
    .single()

  if (error) return { error: error.message }
  revalidatePath('/vault')
  return { id: data.id }
}

export async function updateVaultItem(
  id: string,
  params: {
    title?: string
    content?: string
    tags?: string[]
    project_id?: string | null
    is_mcp_accessible?: boolean
    metadata?: Record<string, unknown>
  }
): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()

  const { data: existing } = await supabase
    .from('vault_items')
    .select('type, encrypted, title, content')
    .eq('id', id)
    .single()

  if (!existing) return { error: 'Item not found' }

  const updates: Record<string, unknown> = { ...params, updated_at: new Date().toISOString() }

  if (params.content) {
    if (existing.encrypted) {
      updates.content = encrypt(params.content)
    }
    try {
      const newTitle = params.title ?? existing.title
      updates.embedding = await embedVaultItem(newTitle, params.content, existing.encrypted)
    } catch {
      // Non-fatal
    }
  } else if (params.title) {
    if (existing.encrypted) {
      try {
        updates.embedding = await embedVaultItem(params.title, '', true)
      } catch {
        // Non-fatal
      }
    }
  }

  if (existing.encrypted) {
    updates.is_mcp_accessible = false
  }

  const { error } = await supabase.from('vault_items').update(updates).eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function deleteVaultItem(id: string): Promise<{ error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { error } = await supabase.from('vault_items').delete().eq('id', id)
  if (error) return { error: error.message }
  revalidatePath('/vault')
  return {}
}

export async function revealVaultItemContent(id: string): Promise<{ content?: string; error?: string }> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase
    .from('vault_items')
    .select('content, encrypted')
    .eq('id', id)
    .single()

  if (error || !data) return { error: error?.message ?? 'Not found' }
  if (!data.encrypted) return { content: data.content }

  try {
    return { content: decrypt(data.content) }
  } catch {
    return { error: 'Decryption failed' }
  }
}

export async function getRelatedVaultItems(id: string): Promise<VaultItemListItem[]> {
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.rpc('match_vault_items_by_id', {
    source_item_id: id,
    match_count: 3,
  })
  if (error) return []
  return (data ?? []) as VaultItemListItem[]
}
