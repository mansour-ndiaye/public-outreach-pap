'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { EvalEntry } from '@/lib/supabase/eval-actions'

interface Props {
  myEvals: EvalEntry[]
}

export default function EvalsTab({ myEvals }: Props) {
  const t = useTranslations('evals')
  const [filterDay, setFilterDay] = useState<string>('all')

  const filtered = useMemo(() =>
    filterDay === 'all' ? myEvals : myEvals.filter(e => e.eval_day === filterDay),
    [myEvals, filterDay]
  )

  // Stats
  const totalEvals   = myEvals.length
  const avgPph       = totalEvals > 0
    ? myEvals.reduce((s, e) => s + (e.eval_pph ?? 0), 0) / totalEvals
    : 0
  const dayCount     = myEvals.reduce<Record<string, number>>((acc, e) => {
    acc[e.eval_day] = (acc[e.eval_day] ?? 0) + 1
    return acc
  }, {})
  const commonDay    = Object.entries(dayCount).sort((a, b) => b[1] - a[1])[0]?.[0] ?? '—'

  const DAYS = ['D1', 'D2', 'D3', 'D4', 'D5']

  function fmtDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
  }

  return (
    <div className="p-4 space-y-4 max-w-2xl mx-auto">
      {/* Stats row */}
      <div className="grid grid-cols-3 gap-3">
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-brand-navy dark:text-white">{totalEvals}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t('stats_total')}</div>
        </div>
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-brand-navy dark:text-white">
            {avgPph > 0 ? `$${avgPph.toFixed(0)}` : '—'}
          </div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t('stats_avg_pph')}</div>
        </div>
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3 text-center">
          <div className="text-2xl font-bold text-brand-navy dark:text-white">{commonDay}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t('stats_common_day')}</div>
        </div>
      </div>

      {/* Day filter */}
      <div className="flex gap-2 flex-wrap">
        <button
          onClick={() => setFilterDay('all')}
          className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
            filterDay === 'all'
              ? 'bg-brand-navy text-white'
              : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
          }`}
        >
          {t('filter_all')}
        </button>
        {DAYS.map(day => (
          <button
            key={day}
            onClick={() => setFilterDay(day)}
            className={`px-3 py-1.5 rounded-full text-sm font-medium transition-colors ${
              filterDay === day
                ? 'bg-brand-navy text-white'
                : 'bg-white dark:bg-neutral-800 border border-neutral-200 dark:border-neutral-700 text-neutral-600 dark:text-neutral-300 hover:bg-neutral-50 dark:hover:bg-neutral-700'
            }`}
          >
            {t(`days.${day}`)}
          </button>
        ))}
      </div>

      {/* Eval cards */}
      {filtered.length === 0 ? (
        <div className="text-center text-neutral-400 dark:text-neutral-500 py-10 text-sm">
          {t('no_evals')}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ev => (
            <div
              key={ev.id}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 space-y-2"
            >
              {/* Header row */}
              <div className="flex items-center justify-between gap-2">
                <div className="flex items-center gap-2 min-w-0">
                  <span className="inline-block bg-brand-navy text-white text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
                    {t(`days.${ev.eval_day}`)}
                  </span>
                  <span className="font-semibold text-neutral-800 dark:text-neutral-100 truncate">
                    {ev.eval_name}
                  </span>
                </div>
                <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">
                  {fmtDate(ev.eval_date)}
                </span>
              </div>

              {/* Metrics row */}
              <div className="flex gap-4 text-sm">
                <div>
                  <span className="text-neutral-400 dark:text-neutral-500 text-xs">PPH </span>
                  <span className="font-semibold text-brand-navy dark:text-white">
                    {ev.eval_pph > 0 ? ev.eval_pph.toFixed(2) : '—'}
                  </span>
                </div>
                {ev.eval_canvas_hours != null && (
                  <div>
                    <span className="text-neutral-400 dark:text-neutral-500 text-xs">{t('eval_canvas_hours').split(' ')[0]} </span>
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">{ev.eval_canvas_hours}h</span>
                  </div>
                )}
                {ev.eval_pac_total != null && (
                  <div>
                    <span className="text-neutral-400 dark:text-neutral-500 text-xs">PAC </span>
                    <span className="font-medium text-neutral-700 dark:text-neutral-300">${ev.eval_pac_total}</span>
                  </div>
                )}
              </div>

              {/* Coached by */}
              <div className="text-xs text-neutral-500 dark:text-neutral-400">
                {t('coach_name')}:{' '}
                <span className="text-neutral-700 dark:text-neutral-300">
                  {ev.coached_by_supervisor ? t('coached_self_label') : (ev.coach_name ?? '—')}
                </span>
              </div>

              {/* Notes */}
              {ev.notes && (
                <div className="text-sm text-neutral-600 dark:text-neutral-400 italic border-l-2 border-neutral-200 dark:border-neutral-700 pl-3">
                  {ev.notes}
                </div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  )
}
