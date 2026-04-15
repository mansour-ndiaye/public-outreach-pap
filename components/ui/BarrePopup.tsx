'use client'

import { cn } from '@/lib/utils'

export type BarrePopupInfo = {
  supervisor_name:  string
  team_name:        string | null
  date:             string
  pph:              number
  canvas_hours:     number | null
  pac_count:        number
  pac_total_amount: number
  pfu:              number
  recalls_count:    number
  note:             string | null
  streets_count:    number
}

function formatDateFr(dateStr: string) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-CA', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

interface Props {
  info:    BarrePopupInfo
  onClose: () => void
  locale?: string
}

export function BarrePopup({ info, onClose, locale }: Props) {
  const isFr = locale !== 'en'
  return (
    <div
      className={cn(
        'mb-3 w-52 rounded-2xl overflow-hidden shadow-xl pointer-events-auto',
        'bg-white dark:bg-[#12163a]',
        'border border-slate-200/80 dark:border-white/[0.08]',
      )}
      onClick={e => e.stopPropagation()}
    >
      {/* Red accent bar */}
      <div className="h-1 bg-brand-red" />

      <div className="px-3 py-2.5 space-y-1.5">
        {/* Header: name · team */}
        <div>
          <p className="font-display text-sm font-bold text-brand-navy dark:text-white leading-tight">
            {info.supervisor_name}
          </p>
          {info.team_name && (
            <p className="font-body text-[11px] text-slate-400 dark:text-white/40 leading-tight">
              {info.team_name}
            </p>
          )}
        </div>

        {/* Date */}
        <p className="font-body text-[11px] text-slate-500 dark:text-white/50">
          {formatDateFr(info.date)}
        </p>

        {/* Divider */}
        <div className="border-t border-slate-100 dark:border-white/[0.06]" />

        {/* Stats */}
        <div className="grid grid-cols-2 gap-x-2 gap-y-0.5 font-body text-[11px] text-slate-600 dark:text-white/60">
          <span className="font-semibold text-brand-teal">PPH {info.pph.toFixed(2)}</span>
          {info.canvas_hours != null && (
            <span>{isFr ? 'Heures' : 'Hours'}: {info.canvas_hours}h</span>
          )}
          <span>PACs: {info.pac_count}</span>
          <span>${info.pac_total_amount.toFixed(0)}</span>
          {info.pfu > 0 && <span>PFU: {info.pfu}</span>}
          {info.recalls_count > 0 && <span>{isFr ? 'Rappels' : 'Recalls'}: {info.recalls_count}</span>}
        </div>

        {/* Note */}
        {info.note && (
          <p className="font-body text-[11px] text-slate-500 dark:text-white/40 italic leading-snug line-clamp-2">
            "{info.note.slice(0, 60)}{info.note.length > 60 ? '…' : ''}"
          </p>
        )}
      </div>

      {/* Close button */}
      <button
        onClick={onClose}
        className="absolute top-2 right-2 w-5 h-5 flex items-center justify-center rounded-full text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors"
      >
        <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
        </svg>
      </button>
    </div>
  )
}
