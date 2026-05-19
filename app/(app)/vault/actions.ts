'use server'

import { createServerSupabaseClient } from '@/lib/supabase'
import { encrypt, decrypt } from '@/lib/crypto'
import { Credential, CredentialTier } from '@/lib/types'
import { revalidatePath } from 'next/cache'

type CredentialListItem = Omit<Credential, 'value'> & { masked_value: string }

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
