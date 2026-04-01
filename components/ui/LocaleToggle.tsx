'use client'

import { useLocale } from 'next-intl'
import { useRouter, usePathname } from 'next/navigation'
import { cn } from '@/lib/utils'

interface LocaleToggleProps {
  className?: string
}

export function LocaleToggle({ className }: LocaleToggleProps) {
  const locale = useLocale()
  const router = useRouter()
  const pathname = usePathname()

  const toggle = () => {
    const nextLocale = locale === 'fr' ? 'en' : 'fr'
    // Replace the locale prefix in the path
    const segments = pathname.split('/')
    segments[1] = nextLocale
    router.push(segments.join('/'))
  }

  return (
    <button
      onClick={toggle}
      aria-label={`Switch to ${locale === 'fr' ? 'English' : 'French'}`}
      className={cn(
        'inline-flex items-center gap-1 px-2.5 py-1 rounded-full',
        'text-xs font-semibold tracking-widest uppercase',
        'text-brand-navy dark:text-white/80',
        'border border-brand-navy/20 dark:border-white/20',
        'hover:bg-brand-navy/8 dark:hover:bg-white/10 hover:border-brand-navy/40 dark:hover:border-white/40',
        'focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-brand-teal focus-visible:ring-offset-2',
        'active:scale-95',
        'transition-[background-color,border-color,transform] duration-200',
        className
      )}
    >
      <span className={locale === 'fr' ? 'text-brand-teal dark:text-brand-teal' : ''}>FR</span>
      <span className="opacity-30">/</span>
      <span className={locale === 'en' ? 'text-brand-teal dark:text-brand-teal' : ''}>EN</span>
    </button>
  )
}
