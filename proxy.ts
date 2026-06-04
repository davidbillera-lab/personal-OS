import { createServerClient } from '@supabase/ssr'
import { NextResponse, type NextRequest } from 'next/server'

// Auth gate for the whole app (Next 16 "proxy" — the renamed middleware).
// No valid Supabase session -> bounced to /login. Uses the anon key (not
// service-role): this only validates the session cookie, it never reads data.
// The /api/* routes are excluded in `config.matcher` below so the GitHub
// webhook (HMAC-signed) and MCP endpoint keep working — external callers can't
// "log in" and carry their own auth.
export async function proxy(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll() {
          return request.cookies.getAll()
        },
        setAll(cookiesToSet) {
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() revalidates the token against Supabase auth — not just decoding
  // the cookie. This is the actual gate.
  const {
    data: { user },
  } = await supabase.auth.getUser()

  const isLoginRoute = request.nextUrl.pathname === '/login'

  // Not signed in and trying to reach anything but the login page -> redirect in.
  if (!user && !isLoginRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/login'
    return NextResponse.redirect(url)
  }

  // Already signed in but sitting on /login -> send to the dashboard.
  if (user && isLoginRoute) {
    const url = request.nextUrl.clone()
    url.pathname = '/'
    return NextResponse.redirect(url)
  }

  // IMPORTANT: return supabaseResponse so any refreshed auth cookies are kept.
  return supabaseResponse
}

export const config = {
  matcher: [
    // Run on everything EXCEPT: /api/* (own auth), Next internals, and static assets.
    '/((?!api|_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
}
