import Link from 'next/link'
import { cn } from '@/lib/utils'

interface StatsCardProps {
  label: string
  value: number
  icon: React.ReactNode
  accent: 'navy' | 'red' | 'teal' | 'slate'
  href?: string
}

const accentStyles = {
  navy:  { icon: 'bg-brand-navy/10 text-brand-navy dark:bg-brand-navy/30 dark:text-white', number: 'text-brand-navy dark:text-white' },
  red:   { icon: 'bg-brand-red/10 text-brand-red',   number: 'text-brand-red' },
  teal:  { icon: 'bg-brand-teal/10 text-brand-teal', number: 'text-brand-teal' },
  slate: { icon: 'bg-slate-100 text-slate-500 dark:bg-white/10 dark:text-white/60', number: 'text-slate-700 dark:text-white' },
}

export function StatsCard({ label, value, icon, accent, href }: StatsCardProps) {
  const styles = accentStyles[accent]

  const cardClass = cn(
    'relative flex items-center gap-4 rounded-2xl px-6 py-5',
    'bg-white dark:bg-white/[0.04]',
    'border border-slate-100 dark:border-white/[0.07]',
    'shadow-[0_1px_4px_rgba(0,0,0,0.04),0_4px_16px_rgba(0,0,0,0.04)]',
    'dark:shadow-[0_1px_4px_rgba(0,0,0,0.2),0_4px_16px_rgba(0,0,0,0.2)]',
    href && [
      'cursor-pointer group',
      'transition-[border-color,box-shadow,transform] duration-200',
      'hover:border-brand-teal/40 dark:hover:border-brand-teal/40',
      'hover:shadow-[0_4px_20px_rgba(0,181,163,0.12),0_1px_4px_rgba(0,0,0,0.06)]',
      'active:scale-[0.99]',
    ],
  )

  const inner = (
    <>
      {/* Icon */}
      <div className={cn('flex items-center justify-center w-12 h-12 rounded-xl shrink-0', styles.icon)}>
        {icon}
      </div>

      {/* Text */}
      <div className="min-w-0 flex-1">
        <p className={cn('font-display text-3xl font-bold leading-none tabular-nums', styles.number)}>
          {value.toLocaleString()}
        </p>
        <p className="font-body text-sm text-slate-500 dark:text-white/45 mt-1.5 leading-tight">
          {label}
        </p>
      </div>

      {/* Arrow — only when clickable */}
      {href && (
        <svg
          className="w-4 h-4 text-slate-300 dark:text-white/20 shrink-0 group-hover:text-brand-teal transition-colors duration-200"
          viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5" strokeLinecap="round" strokeLinejoin="round"
        >
          <path d="M9 18l6-6-6-6"/>
        </svg>
      )}

      {/* Subtle top-left accent dot */}
      <div className="absolute top-0 left-0 w-1 h-8 rounded-br-sm rounded-tl-2xl bg-current opacity-20 text-current" />
    </>
  )

  if (href) {
    return <Link href={href} className={cardClass}>{inner}</Link>
  }
  return <div className={cardClass}>{inner}</div>
}
