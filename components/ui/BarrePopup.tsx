'use client'

import { cn } from '@/lib/utils'
import type { RecallEntry } from '@/lib/supabase/eod-actions'

export type VisitEntry = {
  date:            string
  supervisor_name: string
  team_name:       string | null
  pph:             number
  entry_id:        string
}

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
  recalls?:         RecallEntry[]
  postal_code?:     string
  note:             string | null
  streets_count:    number
  out_of_bounds?:   boolean
  // Multi-visit history (when same street was covered multiple times)
  visits?:          VisitEntry[]
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

function formatDateShort(dateStr: string) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-CA', {
      day: 'numeric', month: 'short',
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
  const hasMultiVisits = info.visits && info.visits.length > 1

  return (
    <div
      className={cn(
        'mb-3 w-60 rounded-2xl overflow-hidden shadow-xl pointer-events-auto',
        'bg-white dark:bg-[#12163a]',
        'border border-slate-200/80 dark:border-white/[0.08]',
      )}
      onClick={e => e.stopPropagation()}
    >
      {/* Red accent bar */}
      <div className="h-1 bg-brand-red" />

      {hasMultiVisits ? (
        /* ── Multi-visit history card ── */
        <div className="px-3 py-2.5 space-y-2">
          {/* Header */}
          <p className="font-display text-xs font-bold text-brand-navy dark:text-white leading-tight">
            {info.visits!.length}{' '}
            {isFr ? 'passages sur cette rue' : 'visits on this street'}
          </p>

          {/* Visit rows */}
          <div className="space-y-0">
            {info.visits!.map((v, i) => (
              <div
                key={v.entry_id + i}
                className={cn(
                  'py-1.5 font-body text-[11px]',
                  i > 0 && 'border-t border-slate-100 dark:border-white/[0.06]',
                  i === 0 && 'pl-2 border-l-2 border-brand-navy dark:border-brand-teal',
                )}
              >
                <div className="flex items-center justify-between gap-2">
                  <span className={cn('font-semibold', i === 0 ? 'text-brand-navy dark:text-white' : 'text-slate-600 dark:text-white/70')}>
                    {formatDateShort(v.date)}
                  </span>
                  <span className={cn('font-semibold', i === 0 ? 'text-brand-teal' : 'text-slate-400 dark:text-white/40')}>
                    PPH {v.pph.toFixed(2)}
                  </span>
                </div>
                <p className="text-slate-500 dark:text-white/50 truncate">
                  {v.supervisor_name}{v.team_name ? ` · ${v.team_name}` : ''}
                </p>
              </div>
            ))}
          </div>
        </div>
      ) : (
        /* ── Single-visit card ── */
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
            {info.out_of_bounds && (
              <span className="inline-flex items-center gap-0.5 mt-0.5 px-1.5 py-0.5 rounded-full bg-orange-100 dark:bg-orange-900/30 text-orange-600 dark:text-orange-400 font-body text-[10px] font-bold">
                ⚠️ Hors terrain
              </span>
            )}
          </div>

          {/* Date */}
          <p className="font-body text-[11px] text-slate-500 dark:text-white/50">
            {formatDateFr(info.date)}
          </p>

          {/* Postal code if available */}
          {info.postal_code && (
            <p className="font-body text-[11px] text-slate-400 dark:text-white/40">
              📮 {info.postal_code}
            </p>
          )}

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

          {/* Recalls list */}
          {info.recalls && info.recalls.length > 0 && (
            <>
              <div className="border-t border-slate-100 dark:border-white/[0.06]" />
              <div className="space-y-1">
                <p className="font-body text-[10px] font-semibold text-slate-400 dark:text-white/30 uppercase tracking-wide">
                  {isFr ? 'Rappels' : 'Recalls'}
                </p>
                {info.recalls.slice(0, 3).map((r, i) => (
                  <div key={i} className="font-body text-[11px] text-slate-600 dark:text-white/60 leading-tight">
                    <span className="font-semibold text-brand-navy dark:text-white/80">{r.street}</span>
                    {r.postal_code ? <span className="text-slate-400"> ({r.postal_code})</span> : null}
                    {r.numbers.length > 0 ? <span>: {r.numbers.join(', ')}</span> : null}
                  </div>
                ))}
                {info.recalls.length > 3 && (
                  <p className="font-body text-[10px] text-slate-400 dark:text-white/30">
                    +{info.recalls.length - 3} {isFr ? 'de plus' : 'more'}
                  </p>
                )}
              </div>
            </>
          )}

          {/* Note */}
          {info.note && (
            <p className="font-body text-[11px] text-slate-500 dark:text-white/40 italic leading-snug line-clamp-2">
              "{info.note.slice(0, 60)}{info.note.length > 60 ? '…' : ''}"
            </p>
          )}
        </div>
      )}

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
