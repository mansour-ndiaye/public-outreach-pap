import { createServerClient } from '@supabase/ssr'
import createIntlMiddleware from 'next-intl/middleware'
import { type NextRequest, NextResponse } from 'next/server'
import { locales, defaultLocale } from './i18n.config'

const handleI18n = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
})

// These path prefixes (after the locale segment) require authentication
const PROTECTED_PREFIXES = ['/admin', '/manager', '/supervisor', '/field']

export async function middleware(request: NextRequest) {
  // ── 1. Refresh Supabase session (must run on every request) ──────────────
  // We start with a base response; setAll() will replace it if cookies change.
  let supabaseResponse = NextResponse.next({ request })

  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
    {
      cookies: {
        getAll: () => request.cookies.getAll(),
        setAll: (cookiesToSet: { name: string; value: string; options?: object }[]) => {
          // Write new cookie values back onto the request so downstream
          // server components see the refreshed session.
          cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value))
          supabaseResponse = NextResponse.next({ request })
          cookiesToSet.forEach(({ name, value, options }) =>
            supabaseResponse.cookies.set(name, value, options)
          )
        },
      },
    }
  )

  // getUser() validates the JWT with the Supabase server (more secure than getSession())
  const { data: { user } } = await supabase.auth.getUser()

  // ── 2. Determine locale and path-without-locale ───────────────────────────
  const { pathname } = request.nextUrl
  const segments = pathname.split('/') // ['', 'fr', 'admin', 'dashboard']
  const locale = locales.includes(segments[1] as typeof locales[number])
    ? segments[1]
    : defaultLocale
  const pathWithoutLocale = '/' + segments.slice(2).join('/') // '/admin/dashboard'

  const isProtected = PROTECTED_PREFIXES.some((p) => pathWithoutLocale.startsWith(p))

  // ── 3. Auth guards ────────────────────────────────────────────────────────
  if (isProtected && !user) {
    // Not logged in → send to login page
    return NextResponse.redirect(new URL(`/${locale}`, request.url))
  }

  // ── 4. Run i18n middleware, then merge in any updated auth cookies ─────────
  const intlResponse = handleI18n(request)

  supabaseResponse.cookies.getAll().forEach((cookie) => {
    intlResponse.cookies.set(cookie.name, cookie.value, { path: '/' })
  })

  return intlResponse
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
