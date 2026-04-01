import { getTranslations } from 'next-intl/server'
import { redirect } from 'next/navigation'
import Image from 'next/image'
import { getCurrentUser, signOut } from '@/lib/supabase/actions'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import type { UserRole } from '@/types'

interface DashboardShellProps {
  locale: string
  /** Expected role for this dashboard — mismatched users are redirected. */
  requiredRole: UserRole
}

const ROLE_ROUTES: Record<UserRole, string> = {
  admin:             'admin',
  territory_manager: 'manager',
  supervisor:        'supervisor',
  field_team:        'field',
}

const ROLE_COLORS: Record<UserRole, string> = {
  admin:             'bg-brand-red/10 text-brand-red border-brand-red/25',
  territory_manager: 'bg-brand-navy/10 text-brand-navy border-brand-navy/25 dark:bg-brand-navy/30 dark:text-white dark:border-brand-navy/50',
  supervisor:        'bg-brand-teal/10 text-brand-teal border-brand-teal/25',
  field_team:        'bg-slate-100 text-slate-600 border-slate-200 dark:bg-white/10 dark:text-white/70 dark:border-white/15',
}

const ROLE_DOT: Record<UserRole, string> = {
  admin:             'bg-brand-red',
  territory_manager: 'bg-brand-navy dark:bg-white',
  supervisor:        'bg-brand-teal',
  field_team:        'bg-slate-400 dark:bg-white/50',
}

export async function DashboardShell({ locale, requiredRole }: DashboardShellProps) {
  const t = await getTranslations('dashboard')
  const tRoles = await getTranslations('roles')

  const user = await getCurrentUser()

  // Guard: not authenticated
  if (!user) redirect(`/${locale}`)

  // Guard: wrong role — redirect to correct dashboard
  if (user.role !== requiredRole) {
    const correctRoute = ROLE_ROUTES[user.role as UserRole] ?? 'field'
    redirect(`/${locale}/${correctRoute}/dashboard`)
  }

  const displayName = user.full_name || user.email.split('@')[0]

  return (
    <main className="relative min-h-screen w-full flex flex-col bg-white dark:bg-[#0f1035] overflow-hidden">

      {/* ── Background blobs ── */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute -top-40 -left-40 w-[500px] h-[500px] rounded-full bg-brand-navy/4 dark:bg-brand-navy/25 blur-[120px]" />
        <div className="absolute -bottom-40 -right-40 w-[400px] h-[400px] rounded-full bg-brand-teal/4 dark:bg-brand-teal/15 blur-[120px]" />
      </div>

      {/* ── Header ── */}
      <header className="relative z-10 flex items-center justify-between px-6 py-4 sm:px-10 border-b border-slate-100 dark:border-white/[0.06] bg-white/60 dark:bg-white/[0.02] backdrop-blur-xl">

        {/* Left: Logo + wordmark */}
        <div className="flex items-center gap-3">
          <Image
            src="/assets/logo.jpeg"
            alt="Public Outreach"
            width={32}
            height={32}
            className="rounded-full"
          />
          <span className="hidden sm:block font-display text-sm font-semibold tracking-wide text-brand-navy dark:text-white/90">
            Public Outreach
          </span>
        </div>

        {/* Right: controls */}
        <div className="flex items-center gap-2">
          <LocaleToggle />
          <ThemeToggle />

          {/* Logout form — server action */}
          <form
            action={async () => {
              'use server'
              await signOut(locale)
            }}
          >
            <button
              type="submit"
              className="inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full
                text-xs font-semibold font-body text-brand-red
                border border-brand-red/25
                hover:bg-brand-red/8 hover:border-brand-red/50
                focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40 focus-visible:ring-offset-2
                active:scale-95
                transition-[background-color,border-color,transform] duration-150"
            >
              <svg xmlns="http://www.w3.org/2000/svg" width="13" height="13" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round">
                <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/><polyline points="16 17 21 12 16 7"/><line x1="21" y1="12" x2="9" y2="12"/>
              </svg>
              {t('logout')}
            </button>
          </form>
        </div>
      </header>

      {/* ── Body ── */}
      <div className="relative z-10 flex flex-1 items-center justify-center px-4 py-12">
        <div className="w-full max-w-lg animate-slide-up space-y-6">

          {/* Banner */}
          <div className="overflow-hidden rounded-2xl shadow-navy-md">
            <div className="relative">
              <Image
                src="/assets/banner.jpeg"
                alt="Public Outreach"
                width={840}
                height={200}
                className="w-full object-cover"
              />
              <div className="absolute inset-0 bg-gradient-to-t from-black/40 to-transparent" />
            </div>
          </div>

          {/* User card */}
          <div className="rounded-2xl p-8
            bg-white/80 backdrop-blur-xl border border-slate-200/80
            shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)]
            dark:bg-white/[0.04] dark:border-white/[0.08]
            dark:shadow-[0_4px_40px_rgba(0,0,0,0.4)]">

            {/* Top accent */}
            <div className="absolute top-0 left-8 right-8 h-[2px] rounded-b-full bg-gradient-to-r from-brand-navy via-brand-teal to-brand-red opacity-70" />

            {/* Avatar + name */}
            <div className="flex items-center gap-4 mb-6">
              <div className="flex items-center justify-center w-12 h-12 rounded-full bg-brand-navy text-white font-display font-bold text-lg shadow-navy-sm select-none">
                {displayName.charAt(0).toUpperCase()}
              </div>
              <div>
                <h1 className="font-display text-xl font-700 tracking-tight text-brand-navy dark:text-white leading-snug">
                  {t('welcome', { name: displayName })}
                </h1>
                <p className="font-body text-sm text-slate-500 dark:text-white/45 mt-0.5">
                  {user.email}
                </p>
              </div>
            </div>

            {/* Role badge */}
            <div className="flex items-center gap-2 mb-8">
              <span className={`inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-semibold font-body border ${ROLE_COLORS[user.role as UserRole]}`}>
                <span className={`w-1.5 h-1.5 rounded-full ${ROLE_DOT[user.role as UserRole]}`} />
                {tRoles(user.role as UserRole)}
              </span>
            </div>

            {/* Coming soon */}
            <div className="rounded-xl p-6 bg-slate-50/80 dark:bg-white/[0.04] border border-slate-100 dark:border-white/[0.06] text-center space-y-2">
              <div className="text-2xl mb-3">🗺️</div>
              <h2 className="font-display font-semibold text-base text-brand-navy dark:text-white tracking-tight">
                {t('coming_soon')}
              </h2>
              <p className="font-body text-sm text-slate-500 dark:text-white/45 leading-relaxed max-w-xs mx-auto">
                {t('coming_soon_desc')}
              </p>
            </div>

          </div>
        </div>
      </div>

      {/* ── Footer ── */}
      <div className="relative z-10 py-5 text-center">
        <p className="text-xs text-slate-400 dark:text-white/30 font-body">
          © {new Date().getFullYear()} Public Outreach™. All rights reserved.
        </p>
      </div>

    </main>
  )
}
