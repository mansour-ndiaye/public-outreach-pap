'use client'

import { useState, useEffect } from 'react'
import { usePathname } from 'next/navigation'
import Link from 'next/link'
import Image from 'next/image'
import { useTranslations } from 'next-intl'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { signOut } from '@/lib/supabase/actions'
import { cn } from '@/lib/utils'
import type { UserRow } from '@/types'

// ── Icons ─────────────────────────────────────────────────────────────────────
function IconDashboard({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/>
      <rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>
    </svg>
  )
}
function IconUsers({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M16 21v-2a4 4 0 0 0-4-4H6a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M22 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function IconMap({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
      <line x1="9" y1="3" x2="9" y2="18"/><line x1="15" y1="6" x2="15" y2="21"/>
    </svg>
  )
}
function IconTeams({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/>
      <circle cx="9" cy="7" r="4"/>
      <path d="M23 21v-2a4 4 0 0 0-3-3.87"/><path d="M16 3.13a4 4 0 0 1 0 7.75"/>
    </svg>
  )
}
function IconSettings({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round">
      <circle cx="12" cy="12" r="3"/>
      <path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 0 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 0 1-2.83-2.83l.06-.06A1.65 1.65 0 0 0 4.68 15a1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 0 1 2.83-2.83l.06.06A1.65 1.65 0 0 0 9 4.68a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 0 1 2.83 2.83l-.06.06A1.65 1.65 0 0 0 19.4 9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>
    </svg>
  )
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
function IconMenu({ className }: { className?: string }) {
  return (
    <svg className={className} xmlns="http://www.w3.org/2000/svg" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
      <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
    </svg>
  )
}

// ── Component ─────────────────────────────────────────────────────────────────
interface AdminShellProps {
  children: React.ReactNode
  user: UserRow
  locale: string
}

export function AdminShell({ children, user, locale }: AdminShellProps) {
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const pathname = usePathname()
  const t = useTranslations('admin.nav')

  // Close mobile sidebar on navigation
  useEffect(() => { setSidebarOpen(false) }, [pathname])

  const displayName = user.full_name || user.email.split('@')[0]

  const navItems = [
    { key: 'dashboard',         href: `/${locale}/admin/dashboard`,   Icon: IconDashboard },
    { key: 'users',             href: `/${locale}/admin/users`,        Icon: IconUsers     },
    { key: 'territories',       href: `/${locale}/admin/territories`,  Icon: IconMap       },
    { key: 'teams',             href: `/${locale}/admin/teams`,        Icon: IconTeams     },
    { key: 'manager_dashboard', href: `/${locale}/manager/dashboard`,  Icon: IconMap       },
    { key: 'settings',          href: `/${locale}/admin/settings`,     Icon: IconSettings  },
  ] as const

  const handleLogout = async () => {
    await signOut(locale)
  }

  // ── Sidebar markup (shared between desktop + mobile) ──────────────────────
  const SidebarContent = (
    <div className="flex flex-col h-full w-60 bg-brand-navy shrink-0">

      {/* Logo */}
      <Link href={`/${locale}/admin/dashboard`} className="flex items-center gap-3 px-5 h-16 border-b border-white/10 shrink-0 hover:bg-white/5 transition-colors">
        <Image src="/assets/logo.jpeg" alt="PO" width={30} height={30} className="rounded-full" />
        <span className="font-display text-sm font-semibold text-white tracking-wide leading-tight">
          Public Outreach
        </span>
      </Link>

      {/* Nav */}
      <nav className="flex-1 px-3 py-4 space-y-0.5 overflow-y-auto">
        {navItems.map(({ key, href, Icon }) => {
          const isActive = pathname === href || pathname.startsWith(href + '/')
          return (
            <Link
              key={key}
              href={href}
              className={cn(
                'flex items-center gap-3 px-3 py-2.5 rounded-xl',
                'font-body text-sm font-medium',
                'transition-[background-color,color] duration-150',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40 focus-visible:ring-inset',
                isActive
                  ? 'bg-white/15 text-white'
                  : 'text-white/55 hover:bg-white/8 hover:text-white/90'
              )}
            >
              <Icon className="w-[18px] h-[18px] shrink-0" />
              {t(key)}
            </Link>
          )
        })}
      </nav>

      {/* User info + logout */}
      <div className="px-3 pb-4 pt-3 border-t border-white/10 shrink-0 space-y-1">
        <div className="flex items-center gap-2.5 px-3 py-2">
          <div className="w-7 h-7 rounded-full bg-brand-teal flex items-center justify-center text-white font-display font-bold text-xs shrink-0 select-none">
            {displayName.charAt(0).toUpperCase()}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-white text-xs font-semibold truncate leading-tight">{displayName}</p>
            <p className="text-white/40 text-[10px] truncate leading-tight">{user.email}</p>
          </div>
        </div>
        <button
          onClick={handleLogout}
          className={cn(
            'w-full flex items-center gap-2.5 px-3 py-2.5 rounded-xl',
            'text-white/50 hover:text-brand-red hover:bg-white/6',
            'font-body text-sm font-medium',
            'transition-[background-color,color] duration-150',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-white/40',
            'active:scale-[0.98]',
          )}
        >
          <IconLogout className="w-[18px] h-[18px] shrink-0" />
          {t('logout')}
        </button>
      </div>
    </div>
  )

  return (
    <div className="flex h-screen overflow-hidden bg-slate-50 dark:bg-[#0f1035]">

      {/* ── Desktop sidebar ── */}
      <div className="hidden lg:flex flex-col h-full">
        {SidebarContent}
      </div>

      {/* ── Mobile sidebar overlay ── */}
      {sidebarOpen && (
        <div className="lg:hidden fixed inset-0 z-40 flex">
          {/* Backdrop */}
          <div
            className="absolute inset-0 bg-black/60 backdrop-blur-sm"
            onClick={() => setSidebarOpen(false)}
          />
          {/* Drawer */}
          <div className="relative z-10 flex flex-col h-full animate-slide-right">
            {SidebarContent}
          </div>
        </div>
      )}

      {/* ── Main area ── */}
      <div className="flex-1 flex flex-col min-w-0 overflow-hidden">

        {/* Header */}
        <header className="flex items-center justify-between px-5 h-16 shrink-0
          bg-white/80 dark:bg-white/[0.03] backdrop-blur-xl
          border-b border-slate-200/80 dark:border-white/[0.07]">

          {/* Mobile hamburger */}
          <button
            onClick={() => setSidebarOpen(true)}
            aria-label="Open menu"
            className={cn(
              'lg:hidden flex items-center justify-center w-9 h-9 rounded-xl',
              'text-slate-600 dark:text-white/70',
              'hover:bg-slate-100 dark:hover:bg-white/8',
              'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
              'transition-[background-color] duration-150',
            )}
          >
            <IconMenu className="w-5 h-5" />
          </button>

          {/* Desktop spacer */}
          <div className="hidden lg:block" />

          {/* Right controls */}
          <div className="flex items-center gap-2">
            <LocaleToggle />
            <ThemeToggle />
          </div>
        </header>

        {/* Page content */}
        <main className="flex-1 overflow-y-auto">
          {children}
        </main>

      </div>
    </div>
  )
}
