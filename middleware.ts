import createIntlMiddleware from 'next-intl/middleware'
import { type NextRequest } from 'next/server'
import { locales, defaultLocale } from './i18n.config'

const handleI18n = createIntlMiddleware({
  locales,
  defaultLocale,
  localePrefix: 'always',
})

export function middleware(request: NextRequest) {
  return handleI18n(request)
}

export const config = {
  matcher: ['/((?!api|_next|_vercel|.*\\..*).*)'],
}
