import { NextResponse } from 'next/server'
import { createServerSupabaseClient } from '@/lib/supabase'

// Returns null when a valid Supabase session exists, else a 401 response. /api/* is excluded from proxy.ts, so routes call this themselves.
export async function requireUser(): Promise<NextResponse | null> {
  // createServerSupabaseClient is used only for the session check, never for data reads.
  const supabase = await createServerSupabaseClient()
  // getUser() revalidates the token against Supabase auth (same check as proxy.ts), not just decoding the cookie.
  const { data: { user } } = await supabase.auth.getUser()
  return user ? null : NextResponse.json({ error: 'Unauthorized' }, { status: 401 })
}
