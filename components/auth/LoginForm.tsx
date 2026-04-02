'use client'

import { useState } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createClient } from '@/lib/supabase/client'
import { useRouter } from 'next/navigation'
import { useLocale } from 'next-intl'
import type { UserRole } from '@/types'

const ROLE_ROUTES: Record<UserRole, string> = {
  admin:              'admin',
  territory_manager:  'manager',
  supervisor:         'supervisor',
  field_team:         'field',
}

export function LoginForm() {
  const t = useTranslations('auth')
  const locale = useLocale()
  const router = useRouter()

  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [loading, setLoading] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [showPassword, setShowPassword] = useState(false)

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setLoading(true)

    try {
      const supabase = createClient()

      console.log('[PAP login] 1. Supabase URL:', process.env.NEXT_PUBLIC_SUPABASE_URL)
      console.log('[PAP login] 2. Anon key present:', !!process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY)
      console.log('[PAP login] 3. Attempting signInWithPassword for:', email)

      // Step 1: authenticate
      const { data: authData, error: authError } =
        await supabase.auth.signInWithPassword({ email, password })

      if (authError) {
        console.error('[PAP login] 4. AUTH FAILED:', authError.message, '| status:', authError.status)
        setError(
          authError.message.toLowerCase().includes('invalid')
            ? t('error_invalid')
            : t('error_generic')
        )
        return
      }

      console.log('[PAP login] 4. Auth SUCCESS — user id:', authData.user.id)
      console.log('[PAP login] 5. user_metadata:', JSON.stringify(authData.user.user_metadata))
      console.log('[PAP login] 6. email_confirmed_at:', authData.user.email_confirmed_at)

      // Step 2: read role from user_metadata (set at creation time, no DB query needed)
      const role = authData.user.user_metadata?.role as UserRole | undefined
      console.log('[PAP login] 7. role from metadata:', role)

      // Step 3: redirect to role-specific dashboard
      const route = ROLE_ROUTES[role ?? 'field_team'] ?? 'field'
      console.log('[PAP login] 8. Redirecting to:', `/${locale}/${route}/dashboard`)
      router.push(`/${locale}/${route}/dashboard`)
      router.refresh()
    } catch (err) {
      console.error('[PAP login] UNEXPECTED EXCEPTION:', err)
      setError(t('error_generic'))
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className={cn(
      'relative rounded-2xl p-8 sm:p-10',
      // Light mode: clean white card with subtle border
      'bg-white/80 backdrop-blur-xl border border-slate-200/80',
      'shadow-[0_4px_24px_rgba(0,0,0,0.06),0_1px_4px_rgba(0,0,0,0.04)]',
      // Dark mode: navy glass card
      'dark:bg-white/[0.04] dark:border-white/[0.08]',
      'dark:shadow-[0_4px_40px_rgba(0,0,0,0.4),0_1px_4px_rgba(0,0,0,0.3)]',
    )}>

      {/* Top accent line */}
      <div className="absolute top-0 left-8 right-8 h-[2px] rounded-b-full bg-gradient-to-r from-brand-navy via-brand-teal to-brand-red opacity-80" />

      {/* Heading */}
      <div className="mb-8">
        <h1 className="font-display text-2xl font-700 tracking-tight text-brand-navy dark:text-white leading-tight">
          {t('welcome_back')}
        </h1>
        <p className="mt-1.5 font-body text-sm text-slate-500 dark:text-white/50 leading-relaxed">
          {t('subtitle')}
        </p>
      </div>

      {/* Form */}
      <form onSubmit={handleSubmit} noValidate className="space-y-5">

        {/* Email */}
        <div className="space-y-1.5">
          <label
            htmlFor="email"
            className="block font-body text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-white/50"
          >
            {t('email')}
          </label>
          <input
            id="email"
            type="email"
            autoComplete="email"
            required
            value={email}
            onChange={(e) => setEmail(e.target.value)}
            placeholder={t('email_placeholder')}
            className={cn(
              'w-full rounded-xl px-4 py-3 font-body text-sm',
              'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
              'dark:bg-white/[0.06] dark:border-white/[0.10] dark:text-white dark:placeholder:text-white/30',
              'hover:border-brand-navy/30 dark:hover:border-white/20',
              'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
              'transition-[border-color,box-shadow] duration-200',
            )}
          />
        </div>

        {/* Password */}
        <div className="space-y-1.5">
          <label
            htmlFor="password"
            className="block font-body text-xs font-semibold uppercase tracking-widest text-slate-500 dark:text-white/50"
          >
            {t('password')}
          </label>
          <div className="relative">
            <input
              id="password"
              type={showPassword ? 'text' : 'password'}
              autoComplete="current-password"
              required
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              placeholder={t('password_placeholder')}
              className={cn(
                'w-full rounded-xl px-4 py-3 pr-11 font-body text-sm',
                'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
                'dark:bg-white/[0.06] dark:border-white/[0.10] dark:text-white dark:placeholder:text-white/30',
                'hover:border-brand-navy/30 dark:hover:border-white/20',
                'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
                'transition-[border-color,box-shadow] duration-200',
              )}
            />
            <button
              type="button"
              onClick={() => setShowPassword((v) => !v)}
              aria-label={showPassword ? 'Hide password' : 'Show password'}
              className={cn(
                'absolute right-3 top-1/2 -translate-y-1/2',
                'p-1 rounded-md text-slate-400 dark:text-white/30',
                'hover:text-slate-600 dark:hover:text-white/60',
                'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal',
                'transition-[color] duration-150',
              )}
            >
              {showPassword ? (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M17.94 17.94A10.07 10.07 0 0 1 12 20c-7 0-11-8-11-8a18.45 18.45 0 0 1 5.06-5.94"/>
                  <path d="M9.9 4.24A9.12 9.12 0 0 1 12 4c7 0 11 8 11 8a18.5 18.5 0 0 1-2.16 3.19"/>
                  <line x1="1" y1="1" x2="23" y2="23"/>
                </svg>
              ) : (
                <svg xmlns="http://www.w3.org/2000/svg" width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                  <path d="M1 12s4-8 11-8 11 8 11 8-4 8-11 8-11-8-11-8z"/>
                  <circle cx="12" cy="12" r="3"/>
                </svg>
              )}
            </button>
          </div>

          {/* Forgot password */}
          <div className="flex justify-end pt-0.5">
            <button
              type="button"
              className={cn(
                'font-body text-xs text-brand-teal',
                'hover:text-brand-teal-dark',
                'focus-visible:outline-none focus-visible:underline',
                'transition-[color] duration-150',
              )}
            >
              {t('forgot_password')}
            </button>
          </div>
        </div>

        {/* Error message */}
        {error && (
          <div
            role="alert"
            className={cn(
              'flex items-start gap-2.5 rounded-xl px-4 py-3',
              'bg-brand-red/5 border border-brand-red/20 text-brand-red',
              'dark:bg-brand-red/10 dark:border-brand-red/30',
              'animate-fade-in',
            )}
          >
            <svg xmlns="http://www.w3.org/2000/svg" width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round" className="mt-px shrink-0">
              <circle cx="12" cy="12" r="10"/><line x1="12" y1="8" x2="12" y2="12"/><line x1="12" y1="16" x2="12.01" y2="16"/>
            </svg>
            <p className="font-body text-xs leading-relaxed">{error}</p>
          </div>
        )}

        {/* Submit */}
        <button
          type="submit"
          disabled={loading || !email || !password}
          className={cn(
            'relative w-full rounded-xl px-4 py-3.5 font-display text-sm font-semibold text-white',
            'bg-brand-navy',
            'shadow-navy-sm',
            'hover:bg-brand-navy-light hover:shadow-navy-md',
            'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2',
            'active:scale-[0.98]',
            'disabled:opacity-50 disabled:cursor-not-allowed disabled:active:scale-100',
            'transition-[background-color,box-shadow,transform,opacity] duration-200',
          )}
        >
          {loading ? (
            <span className="flex items-center justify-center gap-2">
              <svg className="animate-spin h-4 w-4" xmlns="http://www.w3.org/2000/svg" fill="none" viewBox="0 0 24 24">
                <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4"/>
                <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z"/>
              </svg>
              {t('signing_in')}
            </span>
          ) : t('sign_in')}
        </button>
      </form>

      {/* Decorative corner dots */}
      <div aria-hidden className="absolute bottom-6 right-6 flex gap-1">
        {[0, 1, 2].map((i) => (
          <div
            key={i}
            className="w-1.5 h-1.5 rounded-full"
            style={{
              backgroundColor: i === 0 ? '#E8174B' : i === 1 ? '#00B5A3' : '#2E3192',
              opacity: 0.4,
            }}
          />
        ))}
      </div>
    </div>
  )
}
