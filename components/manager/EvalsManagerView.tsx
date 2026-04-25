'use client'

import { useState, useMemo } from 'react'
import { useTranslations } from 'next-intl'
import type { EvalEntry } from '@/lib/supabase/eval-actions'

interface Props {
  allEvals: EvalEntry[]
  locale?: string
}

export default function EvalsManagerView({ allEvals, locale }: Props) {
  const t = useTranslations('evals')
  const isFr = locale !== 'en'

  const [filterSupervisor, setFilterSupervisor] = useState('')
  const [filterTeam,       setFilterTeam]       = useState('')
  const [filterDay,        setFilterDay]        = useState('')
  const [filterFrom,       setFilterFrom]       = useState('')
  const [filterTo,         setFilterTo]         = useState('')

  const DAYS = ['D1', 'D2', 'D3', 'D4', 'D5']

  // Unique supervisors + teams for filter dropdowns
  const supervisors = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of allEvals) if (e.supervisor_id && e.supervisor_name) m.set(e.supervisor_id, e.supervisor_name)
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
  }, [allEvals])

  const teams = useMemo(() => {
    const m = new Map<string, string>()
    for (const e of allEvals) if (e.team_id && e.team_name) m.set(e.team_id, e.team_name)
    return Array.from(m.entries()).map(([id, name]) => ({ id, name }))
  }, [allEvals])

  const filtered = useMemo(() => {
    let rows = allEvals
    if (filterSupervisor) rows = rows.filter(e => e.supervisor_id === filterSupervisor)
    if (filterTeam)       rows = rows.filter(e => e.team_id === filterTeam)
    if (filterDay)        rows = rows.filter(e => e.eval_day === filterDay)
    if (filterFrom)       rows = rows.filter(e => e.eval_date >= filterFrom)
    if (filterTo)         rows = rows.filter(e => e.eval_date <= filterTo)
    return rows
  }, [allEvals, filterSupervisor, filterTeam, filterDay, filterFrom, filterTo])

  // Stats over filtered set
  const now    = new Date()
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
  const thisMonth  = allEvals.filter(e => e.eval_date >= monthStart)

  const totalEvals    = filtered.length
  const avgPph        = totalEvals > 0 ? filtered.reduce((s, e) => s + (e.eval_pph ?? 0), 0) / totalEvals : 0

  const dayCount = filtered.reduce<Record<string, number>>((acc, e) => {
    acc[e.eval_day] = (acc[e.eval_day] ?? 0) + 1; return acc
  }, {})
  const thisMonthCount = thisMonth.length

  // Top coaches (excluding coached_by_supervisor=true which means supervisor coached themselves)
  const coachCount = allEvals.reduce<Record<string, number>>((acc, e) => {
    const key = e.coached_by_supervisor ? (e.supervisor_name ?? 'Self') : (e.coach_name ?? '?')
    acc[key] = (acc[key] ?? 0) + 1; return acc
  }, {})
  const topCoaches = Object.entries(coachCount).sort((a, b) => b[1] - a[1]).slice(0, 3)

  function fmtDate(d: string) {
    return new Date(d + 'T12:00:00').toLocaleDateString(isFr ? 'fr-CA' : 'en-CA', {
      month: 'short', day: 'numeric', year: 'numeric',
    })
  }

  function exportCSV() {
    const escape = (v: string | number | null | undefined) => {
      if (v == null) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n') ? `"${s.replace(/"/g, '""')}"` : s
    }
    const headers = ['date', 'supervisor', 'team', 'eval_name', 'eval_day', 'pph', 'canvas_hours', 'pac_total', 'coached_by', 'notes']
    const lines = [
      headers.join(','),
      ...filtered.map(e => [
        escape(e.eval_date),
        escape(e.supervisor_name),
        escape(e.team_name),
        escape(e.eval_name),
        escape(e.eval_day),
        escape(e.eval_pph?.toFixed(2)),
        escape(e.eval_canvas_hours),
        escape(e.eval_pac_total),
        escape(e.coached_by_supervisor ? (e.supervisor_name ?? 'Self') : (e.coach_name ?? '')),
        escape(e.notes),
      ].join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `evaluations_${new Date().toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  return (
    <div className="p-4 sm:p-6 space-y-5 max-w-4xl mx-auto">

      {/* Stats row */}
      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
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
          <div className="text-2xl font-bold text-brand-navy dark:text-white">{thisMonthCount}</div>
          <div className="text-xs text-neutral-500 dark:text-neutral-400 mt-0.5">{t('stats_this_month')}</div>
        </div>
        <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-3">
          <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-1">{t('stats_top_coaches')}</div>
          {topCoaches.length === 0 ? (
            <span className="text-xs text-neutral-400">—</span>
          ) : (
            <div className="space-y-0.5">
              {topCoaches.map(([name, count]) => (
                <div key={name} className="flex justify-between text-xs">
                  <span className="text-neutral-700 dark:text-neutral-300 truncate max-w-[80px]">{name}</span>
                  <span className="font-semibold text-brand-navy dark:text-white">{count}</span>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Breakdown by day */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4">
        <div className="text-xs font-semibold text-neutral-500 dark:text-neutral-400 mb-3">{t('breakdown_by_day')}</div>
        <div className="flex gap-3">
          {DAYS.map(day => (
            <div key={day} className="flex-1 text-center">
              <div className="text-lg font-bold text-brand-navy dark:text-white">{dayCount[day] ?? 0}</div>
              <div className="text-xs text-neutral-400 dark:text-neutral-500">{t(`days.${day}`)}</div>
            </div>
          ))}
        </div>
      </div>

      {/* Filters */}
      <div className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 space-y-3">
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
          <select
            value={filterSupervisor}
            onChange={e => setFilterSupervisor(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200"
          >
            <option value="">{t('filter_supervisor')}: {t('filter_all')}</option>
            {supervisors.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={filterTeam}
            onChange={e => setFilterTeam(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200"
          >
            <option value="">{t('filter_team')}: {t('filter_all')}</option>
            {teams.map(s => <option key={s.id} value={s.id}>{s.name}</option>)}
          </select>
          <select
            value={filterDay}
            onChange={e => setFilterDay(e.target.value)}
            className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-3 py-2 text-sm text-neutral-700 dark:text-neutral-200"
          >
            <option value="">{t('filter_day')}: {t('filter_all')}</option>
            {DAYS.map(d => <option key={d} value={d}>{t(`days.${d}`)}</option>)}
          </select>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400 whitespace-nowrap">{t('filter_from')}</label>
            <input
              type="date"
              value={filterFrom}
              onChange={e => setFilterFrom(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-2 text-sm text-neutral-700 dark:text-neutral-200"
            />
          </div>
          <div className="flex items-center gap-2">
            <label className="text-xs text-neutral-400 whitespace-nowrap">{t('filter_to')}</label>
            <input
              type="date"
              value={filterTo}
              onChange={e => setFilterTo(e.target.value)}
              className="w-full rounded-lg border border-neutral-200 dark:border-neutral-700 bg-neutral-50 dark:bg-neutral-800 px-2 py-2 text-sm text-neutral-700 dark:text-neutral-200"
            />
          </div>
          <button
            onClick={exportCSV}
            className="flex items-center justify-center gap-2 px-4 py-2 rounded-lg bg-brand-navy text-white text-sm font-semibold hover:bg-brand-navy/90 transition-colors"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M4 16v2a2 2 0 002 2h12a2 2 0 002-2v-2M7 10l5 5 5-5M12 15V3"/>
            </svg>
            {t('export_csv')}
          </button>
        </div>
      </div>

      {/* Eval list */}
      {filtered.length === 0 ? (
        <div className="text-center text-neutral-400 dark:text-neutral-500 py-12 text-sm">
          {t('no_evals')}
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(ev => (
            <div
              key={ev.id}
              className="bg-white dark:bg-neutral-900 border border-neutral-200 dark:border-neutral-700 rounded-xl p-4 space-y-2"
            >
              {/* Header */}
              <div className="flex items-start justify-between gap-2 flex-wrap">
                <div className="flex items-center gap-2 min-w-0 flex-wrap">
                  <span className="inline-block bg-brand-navy text-white text-xs font-bold px-2 py-0.5 rounded-full shrink-0">
                    {t(`days.${ev.eval_day}`)}
                  </span>
                  <span className="font-semibold text-neutral-800 dark:text-neutral-100">
                    {ev.eval_name}
                  </span>
                  {ev.supervisor_name && (
                    <span className="text-xs text-neutral-400 dark:text-neutral-500">
                      — {ev.supervisor_name}
                      {ev.team_name && <> · {ev.team_name}</>}
                    </span>
                  )}
                </div>
                <span className="text-xs text-neutral-400 dark:text-neutral-500 shrink-0">
                  {fmtDate(ev.eval_date)}
                </span>
              </div>

              {/* Metrics */}
              <div className="flex gap-4 text-sm flex-wrap">
                <div>
                  <span className="text-neutral-400 dark:text-neutral-500 text-xs">PPH </span>
                  <span className="font-semibold text-brand-navy dark:text-white">
                    {ev.eval_pph > 0 ? `$${ev.eval_pph.toFixed(2)}` : '—'}
                  </span>
                </div>
                {ev.eval_canvas_hours != null && (
                  <div>
                    <span className="text-neutral-400 dark:text-neutral-500 text-xs">{isFr ? 'Heures' : 'Hours'} </span>
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
                  {ev.coached_by_supervisor ? (ev.supervisor_name ?? t('coached_self_label')) : (ev.coach_name ?? '—')}
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
