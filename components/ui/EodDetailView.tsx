'use client'

import { useRouter } from 'next/navigation'
import EodMiniMap from '@/components/ui/EodMiniMap'
import type { EODWithTeam } from '@/lib/supabase/eod-actions'
import type { EvalEntry } from '@/lib/supabase/eval-actions'

function formatDateFr(dateStr: string, locale: string) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString(locale !== 'en' ? 'fr-CA' : 'en-CA', {
      weekday: 'long', day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

function hasOOB(eod: EODWithTeam): 'none' | 'soft' | 'hard' {
  const features = eod.covered_streets?.features ?? []
  let level: 'none' | 'soft' | 'hard' = 'none'
  for (const f of features) {
    const oob = f.properties?.out_of_bounds
    if (oob === 'hard' || oob === true) return 'hard'
    if (oob === 'soft') level = 'soft'
  }
  return level
}

interface EodDetailViewProps {
  eod:    EODWithTeam
  eval_?: EvalEntry | null
  locale: string
}

export default function EodDetailView({ eod, eval_, locale }: EodDetailViewProps) {
  const isFr     = locale !== 'en'
  const router   = useRouter()
  const oobLevel = hasOOB(eod)

  const dateLabel = eod.entry_date ? formatDateFr(eod.entry_date, locale) : '—'

  return (
    <div className="max-w-2xl mx-auto px-4 py-6 space-y-5">

      {/* Back */}
      <button
        onClick={() => router.back()}
        className="flex items-center gap-2 font-body text-sm text-slate-500 dark:text-white/50 hover:text-brand-teal transition-colors"
      >
        <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
          <path strokeLinecap="round" strokeLinejoin="round" d="M15 19l-7-7 7-7" />
        </svg>
        {isFr ? 'Retour' : 'Back'}
      </button>

      {/* Header card */}
      <div className="rounded-2xl overflow-hidden bg-white dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.07]">
        <div className="h-1.5 bg-brand-navy" />
        <div className="px-5 py-4">
          <p className="font-body text-xs text-slate-400 dark:text-white/40 capitalize mb-1">{dateLabel}</p>
          <h1 className="font-display text-xl font-bold text-brand-navy dark:text-white">
            {eod.supervisor_name ?? '—'}
          </h1>
          {eod.team_name && (
            <p className="font-body text-sm text-slate-500 dark:text-white/50 mt-0.5">{eod.team_name}</p>
          )}
        </div>
      </div>

      {/* OOB warning */}
      {oobLevel !== 'none' && (
        <div className={`rounded-xl px-4 py-3 flex items-start gap-3 ${
          oobLevel === 'hard'
            ? 'bg-red-50 dark:bg-red-900/20 border border-red-200 dark:border-red-500/30'
            : 'bg-orange-50 dark:bg-orange-900/20 border border-orange-200 dark:border-orange-500/30'
        }`}>
          <span className="text-base shrink-0 mt-0.5">{oobLevel === 'hard' ? '🚨' : '⚠️'}</span>
          <p className={`font-body text-sm font-medium ${oobLevel === 'hard' ? 'text-red-700 dark:text-red-400' : 'text-orange-700 dark:text-orange-400'}`}>
            {oobLevel === 'hard'
              ? (isFr ? 'Rues hors terrain assigné' : 'Streets outside assigned turf')
              : (isFr ? 'Certaines rues sont légèrement hors terrain' : 'Some streets slightly outside turf')}
          </p>
        </div>
      )}

      {/* KPI grid */}
      <div className="grid grid-cols-2 sm:grid-cols-3 gap-3">
        {[
          { label: 'PPH',                                  value: eod.pph > 0 ? eod.pph.toFixed(2) : '—' },
          { label: isFr ? 'Heures terrain' : 'Canvas Hrs', value: eod.canvas_hours != null ? `${eod.canvas_hours}h` : '—' },
          { label: 'PAC $',                                value: eod.pac_total_amount > 0 ? `$${eod.pac_total_amount.toFixed(0)}` : '—' },
          { label: 'PAC #',                                value: eod.pac_count > 0 ? String(eod.pac_count) : '—' },
          { label: 'PFU',                                  value: eod.pfu > 0 ? String(eod.pfu) : '—' },
          { label: isFr ? 'Rappels' : 'Recalls',           value: eod.recalls_count > 0 ? String(eod.recalls_count) : '—' },
        ].map(({ label, value }) => (
          <div key={label} className="rounded-xl bg-white dark:bg-white/[0.03] border border-slate-200/80 dark:border-white/[0.07] px-4 py-3 text-center">
            <p className="font-body text-[11px] text-slate-400 dark:text-white/40 uppercase tracking-wide mb-1">{label}</p>
            <p className="font-display text-xl font-bold text-brand-navy dark:text-white">{value}</p>
          </div>
        ))}
      </div>

      {/* Eval badge */}
      {eval_ && (
        <div className="rounded-xl bg-brand-teal/10 border border-brand-teal/30 px-4 py-3 flex items-center gap-3">
          <svg className="w-5 h-5 text-brand-teal shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M9 12l2 2 4-4M7.835 4.697a3.42 3.42 0 001.946-.806 3.42 3.42 0 014.438 0 3.42 3.42 0 001.946.806 3.42 3.42 0 013.138 3.138 3.42 3.42 0 00.806 1.946 3.42 3.42 0 010 4.438 3.42 3.42 0 00-.806 1.946 3.42 3.42 0 01-3.138 3.138 3.42 3.42 0 00-1.946.806 3.42 3.42 0 01-4.438 0 3.42 3.42 0 00-1.946-.806 3.42 3.42 0 01-3.138-3.138 3.42 3.42 0 00-.806-1.946 3.42 3.42 0 010-4.438 3.42 3.42 0 00.806-1.946 3.42 3.42 0 013.138-3.138z" />
          </svg>
          <div className="min-w-0">
            <p className="font-body text-sm font-semibold text-brand-teal">
              {isFr ? `Évaluation soumise — ${eval_.eval_day}` : `Evaluation submitted — ${eval_.eval_day}`}
            </p>
            {eval_.coach_name && (
              <p className="font-body text-xs text-brand-teal/70 mt-0.5">
                {isFr ? `Coach: ${eval_.coach_name}` : `Coach: ${eval_.coach_name}`}
              </p>
            )}
          </div>
        </div>
      )}

      {/* Mini-map */}
      {eod.covered_streets?.features?.length ? (
        <div className="rounded-2xl overflow-hidden bg-white dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.07] p-4">
          <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-3">
            {isFr ? 'Terrain barré' : 'Covered streets'}
          </p>
          <EodMiniMap
            coveredStreets={eod.covered_streets}
            height={180}
            locale={locale}
            supervisorName={eod.supervisor_name ?? undefined}
            teamName={eod.team_name ?? undefined}
            date={eod.entry_date ?? undefined}
          />
        </div>
      ) : null}

      {/* Recalls */}
      {eod.recalls && eod.recalls.length > 0 && (
        <div className="rounded-2xl bg-white dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.07] overflow-hidden">
          <div className="px-5 py-3 border-b border-slate-100 dark:border-white/[0.05]">
            <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide">
              {isFr ? `Rappels (${eod.recalls.length})` : `Recalls (${eod.recalls.length})`}
            </p>
          </div>
          <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
            {eod.recalls.map((r, i) => (
              <div key={i} className="px-5 py-3 flex items-start justify-between gap-4">
                <div className="min-w-0">
                  <p className="font-body text-sm font-semibold text-brand-navy dark:text-white truncate">{r.street}</p>
                  {r.postal_code && (
                    <p className="font-body text-xs text-slate-400 dark:text-white/40">{r.postal_code}</p>
                  )}
                </div>
                {r.numbers.length > 0 && (
                  <p className="font-body text-xs text-slate-500 dark:text-white/50 shrink-0 text-right">
                    {r.numbers.join(', ')}
                  </p>
                )}
              </div>
            ))}
          </div>
        </div>
      )}

      {/* Note */}
      {eod.note && (
        <div className="rounded-2xl bg-white dark:bg-white/[0.02] border border-slate-200/80 dark:border-white/[0.07] px-5 py-4">
          <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-2">
            {isFr ? 'Note' : 'Note'}
          </p>
          <p className="font-body text-sm text-slate-700 dark:text-white/70 whitespace-pre-wrap">{eod.note}</p>
        </div>
      )}

    </div>
  )
}
