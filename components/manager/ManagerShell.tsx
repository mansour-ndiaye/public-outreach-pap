'use client'

import Image from 'next/image'
import Link from 'next/link'
import { useTranslations } from 'next-intl'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { AvatarDisplay } from '@/components/ui/AvatarButton'
import { NotificationBell } from '@/components/ui/NotificationBell'
import { signOut } from '@/lib/supabase/actions'
import { cn } from '@/lib/utils'
import type { UserRow } from '@/types'

interface ManagerShellProps {
  children: React.ReactNode
  user: UserRow
  locale: string
}

function IconLogout({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M9 21H5a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h4"/>
      <polyline points="16 17 21 12 16 7"/>
      <line x1="21" y1="12" x2="9" y2="12"/>
    </svg>
  )
}

export function ManagerShell({ children, user, locale }: ManagerShellProps) {
  const t = useTranslations('manager.nav')
  const displayName = user.full_name || user.email.split('@')[0]

  const handleLogout = async () => { await signOut(locale) }

  return (
    <div className="flex flex-col h-screen overflow-hidden bg-slate-50 dark:bg-[#0f1035]">

      {/* Header */}
      <header className={cn(
        'flex items-center justify-between px-5 h-16 shrink-0',
        'bg-white/90 dark:bg-white/[0.04] backdrop-blur-xl',
        'border-b border-slate-200/80 dark:border-white/[0.07]',
        'z-30',
      )}>
        {/* Left: Logo + role (links to home based on role) */}
        <Link
          href={user.role === 'admin' ? `/${locale}/admin/dashboard` : `/${locale}/manager/dashboard`}
          className="flex items-center gap-3 hover:opacity-80 transition-opacity"
        >
          <Image src="/assets/logo.jpeg" alt="PO" width={30} height={30} className="rounded-full shrink-0" />
          <div>
            <p className="font-display text-sm font-bold text-brand-navy dark:text-white leading-tight">
              Public Outreach
            </p>
            <p className="font-body text-[11px] text-brand-teal dark:text-brand-teal leading-tight">
              {t('title')}
            </p>
          </div>
        </Link>

        {/* Right: user info + controls */}
        <div className="flex items-center gap-2">
          {/* User badge */}
          <Link
            href={`/${locale}/profile`}
            className="hidden md:flex items-center gap-2 px-3 py-1.5 rounded-full bg-slate-100 dark:bg-white/[0.06] hover:bg-slate-200 dark:hover:bg-white/[0.10] transition-colors"
          >
            <AvatarDisplay
              name={displayName}
              avatarUrl={user.avatar_url}
              size="xs"
            />
            <span className="font-body text-xs font-semibold text-slate-700 dark:text-white/70">
              {displayName}
            </span>
          </Link>

          <NotificationBell userId={user.id} locale={locale} />
          <LocaleToggle />
          <ThemeToggle />

          <button
            onClick={handleLogout}
            className={cn(
              'inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full',
              'text-xs font-semibold font-body text-brand-red',
              'border border-brand-red/25',
              'hover:bg-brand-red/8 hover:border-brand-red/50',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-red/40',
              'active:scale-95 transition-all duration-150',
            )}
          >
            <IconLogout className="w-3.5 h-3.5" />
            <span className="hidden sm:inline">{t('logout')}</span>
          </button>
        </div>
      </header>

      {/* Main content */}
      <main className="flex-1 overflow-hidden">
        {children}
      </main>

    </div>
  )
}
