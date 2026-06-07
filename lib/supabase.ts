import { createBrowserClient, createServerClient } from '@supabase/ssr'
import { createClient as createSupabaseClient } from '@supabase/supabase-js'
import { cookies } from 'next/headers'

export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  )
}

// Use this for operations that need to bypass RLS (vault_items has deny-all policies for non-service-role).
// @supabase/ssr's createServerClient forwards user cookies as the Authorization header, which causes
// Supabase to apply RLS using the user's JWT role instead of the service role — even when the service
// role key is passed as the API key. Plain createClient has no cookie layer, so service role fully bypasses RLS.
export function createAdminSupabaseClient() {
  return createSupabaseClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  )
}

export async function createServerSupabaseClient() {
  const cookieStore = await cookies()
  // Use service role key (bypasses RLS) when available — auth has been removed
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY ?? process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!
  return createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    key,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll()
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            )
          } catch {
            // Server Component — cookie writes are ignored
          }
        },
      },
    }
  )
}
