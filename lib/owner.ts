import { createServerSupabaseClient } from '@/lib/supabase'

// Identity only, never data: the one sanctioned use of createServerSupabaseClient in server code
// (it needs the session cookie). All data access stays on createAdminSupabaseClient.
export async function requireOwner(): Promise<{ actor: 'owner'; userId: string }> {
  const ownerId = process.env.MC_OWNER_USER_ID
  if (!ownerId) throw new Error('Not authorized')
  const supabase = await createServerSupabaseClient()
  const { data, error } = await supabase.auth.getUser()
  const userId = data?.user?.id
  if (error || !userId || userId !== ownerId) throw new Error('Not authorized')
  return { actor: 'owner', userId }
}
