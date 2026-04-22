'use client'

import { useState, useTransition } from 'react'
import { useRouter } from 'next/navigation'
import { useTheme } from 'next-themes'
import { useLocale } from 'next-intl'
import { cn } from '@/lib/utils'
import { AvatarButton } from '@/components/ui/AvatarButton'
import { LocaleToggle } from '@/components/ui/LocaleToggle'
import { ThemeToggle } from '@/components/ui/ThemeToggle'
import { updateProfile, updatePassword } from '@/lib/supabase/user-actions'
import type { UserRow } from '@/types'

interface Props {
  user: UserRow
  locale: string
}

const inputCls = cn(
  'w-full rounded-xl px-4 py-3 font-body text-sm',
  'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
  'transition-[border-color,box-shadow] duration-200 disabled:opacity-60',
)

export default function ProfilePageClient({ user, locale }: Props) {
  const isFr = locale !== 'en'
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const currentLocale = useLocale()

  // Back destination based on role
  const backHref = user.role === 'admin'
    ? `/${locale}/admin/dashboard`
    : user.role === 'territory_manager'
    ? `/${locale}/manager/dashboard`
    : `/${locale}/supervisor/dashboard`

  // ── Section B: display name ───────────────────────────────────────────────
  const [displayName, setDisplayName] = useState(user.full_name ?? '')
  const [namePending, startNameTransition] = useTransition()
  const [nameSuccess, setNameSuccess] = useState(false)
  const [nameError,   setNameError]   = useState('')

  const handleSaveName = () => {
    setNameError('')
    setNameSuccess(false)
    startNameTransition(async () => {
      const result = await updateProfile({ full_name: displayName.trim() || undefined })
      if (result.error) {
        setNameError(result.error)
      } else {
        setNameSuccess(true)
        router.refresh()
        setTimeout(() => setNameSuccess(false), 3000)
      }
    })
  }

  // ── Section C: password ───────────────────────────────────────────────────
  const [newPassword,     setNewPassword]     = useState('')
  const [confirmPassword, setConfirmPassword] = useState('')
  const [pwPending,   startPwTransition]   = useTransition()
  const [pwSuccess,   setPwSuccess]        = useState(false)
  const [pwError,     setPwError]          = useState('')

  const handleSavePassword = () => {
    setPwError('')
    setPwSuccess(false)
    if (newPassword.length < 8) {
      setPwError(isFr ? 'Le mot de passe doit contenir au moins 8 caractères' : 'Password must be at least 8 characters')
      return
    }
    if (newPassword !== confirmPassword) {
      setPwError(isFr ? 'Les mots de passe ne correspondent pas' : 'Passwords do not match')
      return
    }
    startPwTransition(async () => {
      const result = await updatePassword(newPassword)
      if (result.error) {
        setPwError(result.error)
      } else {
        setPwSuccess(true)
        setNewPassword('')
        setConfirmPassword('')
        setTimeout(() => setPwSuccess(false), 3000)
      }
    })
  }

  return (
    <div className="max-w-xl mx-auto px-4 py-6 space-y-6">
      {/* Header */}
      <div className="flex items-center gap-3">
        <button
          onClick={() => router.push(backHref)}
          className="w-9 h-9 flex items-center justify-center rounded-xl hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors text-slate-600 dark:text-white/60"
          aria-label={isFr ? 'Retour' : 'Back'}
        >
          <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7"/>
          </svg>
        </button>
        <div>
          <h1 className="font-display text-xl font-bold text-brand-navy dark:text-white">
            {isFr ? 'Mon profil' : 'My profile'}
          </h1>
          <p className="font-body text-xs text-slate-500 dark:text-white/40 mt-0.5">{user.email}</p>
        </div>
      </div>

      {/* ── Section A: Profile picture ─────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl border border-slate-200/80 dark:border-white/[0.07]',
        'bg-white dark:bg-white/[0.02] p-6',
      )}>
        <h2 className="font-display text-sm font-bold text-brand-navy dark:text-white mb-4">
          {isFr ? 'Photo de profil' : 'Profile picture'}
        </h2>
        <div className="flex items-center gap-4">
          <AvatarButton
            userId={user.id}
            name={user.full_name || user.email.split('@')[0]}
            avatarUrl={user.avatar_url}
            size="lg"
            locale={locale}
            bgClass="bg-brand-teal"
          />
          <div>
            <p className="font-body text-sm font-semibold text-brand-navy dark:text-white">
              {user.full_name || user.email.split('@')[0]}
            </p>
            <p className="font-body text-xs text-slate-500 dark:text-white/40 mt-0.5">
              {isFr ? 'Cliquez sur la photo pour la modifier' : 'Click the photo to change it'}
            </p>
            <p className="font-body text-[11px] text-slate-400 dark:text-white/30 mt-1">
              JPG, PNG, WebP — max 2 MB
            </p>
          </div>
        </div>
      </div>

      {/* ── Section B: Display name ────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl border border-slate-200/80 dark:border-white/[0.07]',
        'bg-white dark:bg-white/[0.02] p-6 space-y-4',
      )}>
        <h2 className="font-display text-sm font-bold text-brand-navy dark:text-white">
          {isFr ? 'Nom affiché' : 'Display name'}
        </h2>
        <input
          type="text"
          value={displayName}
          onChange={e => setDisplayName(e.target.value)}
          placeholder={isFr ? 'Votre nom complet' : 'Your full name'}
          className={inputCls}
          onKeyDown={e => e.key === 'Enter' && handleSaveName()}
        />
        {nameError && (
          <p className="font-body text-xs text-brand-red">{nameError}</p>
        )}
        {nameSuccess && (
          <p className="font-body text-xs text-brand-teal">
            {isFr ? 'Nom mis à jour ✓' : 'Name updated ✓'}
          </p>
        )}
        <button
          onClick={handleSaveName}
          disabled={namePending || !displayName.trim()}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
            'bg-brand-navy text-white font-body text-sm font-semibold',
            'hover:bg-brand-navy-light active:scale-[0.98] disabled:opacity-50',
            'transition-[background-color,transform,opacity] duration-150',
          )}
        >
          {namePending ? (
            <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (isFr ? 'Enregistrer le nom' : 'Save name')}
        </button>
      </div>

      {/* ── Section C: Password ────────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl border border-slate-200/80 dark:border-white/[0.07]',
        'bg-white dark:bg-white/[0.02] p-6 space-y-4',
      )}>
        <h2 className="font-display text-sm font-bold text-brand-navy dark:text-white">
          {isFr ? 'Mot de passe' : 'Password'}
        </h2>
        <div className="space-y-3">
          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {isFr ? 'Nouveau mot de passe' : 'New password'}
            </label>
            <input
              type="password"
              value={newPassword}
              onChange={e => setNewPassword(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
              autoComplete="new-password"
            />
          </div>
          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {isFr ? 'Confirmer le mot de passe' : 'Confirm password'}
            </label>
            <input
              type="password"
              value={confirmPassword}
              onChange={e => setConfirmPassword(e.target.value)}
              placeholder="••••••••"
              className={inputCls}
              autoComplete="new-password"
            />
          </div>
        </div>
        {pwError && (
          <p className="font-body text-xs text-brand-red">{pwError}</p>
        )}
        {pwSuccess && (
          <p className="font-body text-xs text-brand-teal">
            {isFr ? 'Mot de passe mis à jour ✓' : 'Password updated ✓'}
          </p>
        )}
        <button
          onClick={handleSavePassword}
          disabled={pwPending || !newPassword || !confirmPassword}
          className={cn(
            'w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
            'bg-brand-navy text-white font-body text-sm font-semibold',
            'hover:bg-brand-navy-light active:scale-[0.98] disabled:opacity-50',
            'transition-[background-color,transform,opacity] duration-150',
          )}
        >
          {pwPending ? (
            <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
          ) : (isFr ? 'Changer le mot de passe' : 'Change password')}
        </button>
      </div>

      {/* ── Section D: Preferences ─────────────────────────────────────── */}
      <div className={cn(
        'rounded-2xl border border-slate-200/80 dark:border-white/[0.07]',
        'bg-white dark:bg-white/[0.02] p-6 space-y-4',
      )}>
        <h2 className="font-display text-sm font-bold text-brand-navy dark:text-white">
          {isFr ? 'Préférences' : 'Preferences'}
        </h2>
        <div className="space-y-3">
          <div className="flex items-center justify-between">
            <div>
              <p className="font-body text-sm font-semibold text-brand-navy dark:text-white">
                {isFr ? 'Langue' : 'Language'}
              </p>
              <p className="font-body text-xs text-slate-500 dark:text-white/40 mt-0.5">
                {isFr ? 'Français / English' : 'French / English'}
              </p>
            </div>
            <LocaleToggle />
          </div>
          <div className="border-t border-slate-100 dark:border-white/[0.04]" />
          <div className="flex items-center justify-between">
            <div>
              <p className="font-body text-sm font-semibold text-brand-navy dark:text-white">
                {isFr ? 'Apparence' : 'Appearance'}
              </p>
              <p className="font-body text-xs text-slate-500 dark:text-white/40 mt-0.5">
                {resolvedTheme === 'dark'
                  ? (isFr ? 'Mode sombre' : 'Dark mode')
                  : (isFr ? 'Mode clair' : 'Light mode')}
              </p>
            </div>
            <ThemeToggle />
          </div>
        </div>
      </div>

      {/* Bottom padding for mobile */}
      <div className="h-6" />
    </div>
  )
}
