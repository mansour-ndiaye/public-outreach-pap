'use client'

import { useState, useMemo } from 'react'
import nextDynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import type { TerritoryRow } from '@/types'
import type { DailyZoneWithTeam, TeamZoneStatus } from '@/lib/supabase/zone-actions'
import type { EODWithTeam } from '@/lib/supabase/eod-actions'

// Lazy-load map (no SSR)
const ManagerMap = nextDynamic(() => import('./ManagerMap'), {
  ssr: false,
  loading: () => (
    <div className="w-full h-full flex items-center justify-center bg-slate-100 dark:bg-white/[0.03]">
      <div className="flex flex-col items-center gap-3">
        <div className="w-8 h-8 rounded-full border-2 border-brand-teal border-t-transparent animate-spin" />
        <span className="font-body text-sm text-slate-500 dark:text-white/40">Chargement de la carte...</span>
      </div>
    </div>
  ),
})

// 8-color team palette
const TEAM_COLORS = [
  '#E8174B', '#00B5A3', '#FF8C00', '#8B5CF6',
  '#F59E0B', '#10B981', '#3B82F6', '#EC4899',
]

type TeamOption = { id: string; name: string }
type Tab = 'map' | 'teams' | 'performance'

interface ManagerDashboardProps {
  territories:    TerritoryRow[]
  teams:          TeamOption[]
  zones:          DailyZoneWithTeam[]
  zoneStatuses:   TeamZoneStatus[]
  recentEODs:     EODWithTeam[]
  todayDate:      string
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-CA', {
    month: 'short', day: 'numeric',
  })
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(n)
}

export default function ManagerDashboard({
  territories, teams, zones, zoneStatuses, recentEODs, todayDate,
}: ManagerDashboardProps) {
  const t     = useTranslations('manager')
  const [tab, setTab] = useState<Tab>('map')

  // Build team color map (team_id → color)
  const teamColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name))
    sorted.forEach((team, i) => {
      map[team.id] = TEAM_COLORS[i % TEAM_COLORS.length]
    })
    return map
  }, [teams])

  // Performance stats
  const stats = useMemo(() => {
    const thisWeek = new Date()
    thisWeek.setDate(thisWeek.getDate() - 7)
    const weekStr = thisWeek.toISOString().split('T')[0]
    const weekEntries = recentEODs.filter(e => (e.entry_date ?? '') >= weekStr)

    const totalPac   = weekEntries.reduce((s, e) => s + (e.pac_count ?? 0), 0)
    const totalHours = weekEntries.reduce((s, e) => s + (e.canvas_hours ?? 0), 0)
    const pphs       = weekEntries.map(e => e.pph).filter(Boolean)
    const avgPph     = pphs.length ? pphs.reduce((a, b) => a + b, 0) / pphs.length : 0

    return { totalPac, totalHours, avgPph }
  }, [recentEODs])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'map',         label: t('tabs.map') },
    { key: 'teams',       label: t('tabs.teams') },
    { key: 'performance', label: t('tabs.performance') },
  ]

  return (
    <div className="flex flex-col h-full">

      {/* Tab bar */}
      <div className={cn(
        'flex items-center gap-1 px-4 py-2 shrink-0',
        'bg-white/80 dark:bg-white/[0.03] backdrop-blur-sm',
        'border-b border-slate-200/80 dark:border-white/[0.07]',
      )}>
        {tabs.map(({ key, label }) => (
          <button
            key={key}
            onClick={() => setTab(key)}
            className={cn(
              'px-4 py-2 rounded-lg font-body text-sm font-semibold transition-all duration-150',
              tab === key
                ? 'bg-brand-navy text-white shadow-navy-sm'
                : 'text-slate-500 dark:text-white/50 hover:text-slate-700 dark:hover:text-white/80 hover:bg-slate-100 dark:hover:bg-white/[0.05]',
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {/* Tab content */}
      <div className="flex-1 overflow-hidden">

        {/* ── MAP TAB ── */}
        {tab === 'map' && (
          <ManagerMap
            territories={territories}
            teams={teams}
            zones={zones}
            todayDate={todayDate}
            teamColorMap={teamColorMap}
          />
        )}

        {/* ── TEAMS TAB ── */}
        {tab === 'teams' && (
          <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto">
            <h2 className="font-display text-xl font-bold text-brand-navy dark:text-white mb-6">
              {t('teams.title')}
            </h2>

            {zoneStatuses.length === 0 ? (
              <p className="font-body text-sm text-slate-500 dark:text-white/40">{t('teams.empty')}</p>
            ) : (
              <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[0.07]">
                <div className="overflow-x-auto">
                  <table className="w-full text-sm font-body">
                    <thead>
                      <tr className="bg-slate-50 dark:bg-white/[0.03]">
                        {(['col_team','col_manager','col_territory','col_status','col_last_eod','col_pph'] as const).map(col => (
                          <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">
                            {t(`teams.${col}`)}
                          </th>
                        ))}
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                      {zoneStatuses.map(team => (
                        <tr key={team.team_id} className="bg-white dark:bg-transparent hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors">
                          {/* Team */}
                          <td className="px-4 py-3">
                            <div className="flex items-center gap-2">
                              <div
                                className="w-3 h-3 rounded-full shrink-0"
                                style={{ backgroundColor: teamColorMap[team.team_id] ?? '#94a3b8' }}
                              />
                              <span className="font-semibold text-brand-navy dark:text-white">
                                {team.team_name}
                              </span>
                            </div>
                          </td>
                          {/* Supervisor */}
                          <td className="px-4 py-3 text-slate-600 dark:text-white/60">
                            {team.manager_name ?? '—'}
                          </td>
                          {/* Territory */}
                          <td className="px-4 py-3 text-slate-600 dark:text-white/60">
                            {team.territory_name ?? (
                              <span className="text-slate-400 dark:text-white/30 italic">{t('teams.no_territory')}</span>
                            )}
                          </td>
                          {/* Zone status */}
                          <td className="px-4 py-3">
                            <span className={cn(
                              'inline-flex items-center gap-1.5 px-2.5 py-1 rounded-full text-xs font-semibold',
                              team.zone_assigned
                                ? 'bg-brand-teal/10 text-brand-teal border border-brand-teal/25'
                                : 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/[0.05] dark:text-white/40 dark:border-white/10',
                            )}>
                              <span className={cn('w-1.5 h-1.5 rounded-full', team.zone_assigned ? 'bg-brand-teal' : 'bg-slate-400')} />
                              {team.zone_assigned ? t('teams.status_assigned') : t('teams.status_pending')}
                            </span>
                          </td>
                          {/* Last EOD */}
                          <td className="px-4 py-3 text-slate-600 dark:text-white/60 text-xs">
                            {team.last_eod_date ? formatDate(team.last_eod_date) : t('teams.no_eod')}
                          </td>
                          {/* PPH */}
                          <td className="px-4 py-3">
                            {team.last_pph != null ? (
                              <span className="font-semibold text-brand-navy dark:text-brand-teal">
                                {team.last_pph.toFixed(2)}
                              </span>
                            ) : (
                              <span className="text-slate-400 dark:text-white/30">—</span>
                            )}
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE TAB ── */}
        {tab === 'performance' && (
          <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto space-y-8">
            <h2 className="font-display text-xl font-bold text-brand-navy dark:text-white">
              {t('performance.title')}
            </h2>

            {/* Stats cards */}
            <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
              <StatCard label={t('performance.week_pac')} value={String(stats.totalPac)} accent="navy" />
              <StatCard label={t('performance.avg_pph')} value={stats.avgPph.toFixed(2)} accent="teal" />
              <StatCard label={t('performance.canvas_hours')} value={stats.totalHours.toFixed(1) + 'h'} accent="red" />
            </div>

            {/* Recent EODs table */}
            <div>
              <h3 className="font-display text-base font-semibold text-brand-navy dark:text-white mb-4">
                {t('performance.recent_eods')}
              </h3>

              {recentEODs.length === 0 ? (
                <p className="font-body text-sm text-slate-500 dark:text-white/40">{t('performance.empty')}</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[0.07]">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm font-body">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-white/[0.03]">
                          {(['col_date','col_team','col_pph','col_hours','col_pac','col_note'] as const).map(col => (
                            <th key={col} className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">
                              {t(`performance.${col}`)}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                        {recentEODs.map(eod => (
                          <tr key={eod.id} className="bg-white dark:bg-transparent hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-slate-600 dark:text-white/60 text-xs whitespace-nowrap">
                              {eod.entry_date ? formatDate(eod.entry_date) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {eod.team_name ? (
                                <div className="flex items-center gap-2">
                                  <div
                                    className="w-2.5 h-2.5 rounded-full shrink-0"
                                    style={{ backgroundColor: teamColorMap[eod.team_id ?? ''] ?? '#94a3b8' }}
                                  />
                                  <span className="font-semibold text-brand-navy dark:text-white">{eod.team_name}</span>
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3 font-semibold text-brand-navy dark:text-brand-teal">
                              {eod.pph?.toFixed(2) ?? '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-white/60">
                              {eod.canvas_hours != null ? `${eod.canvas_hours}h` : '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-600 dark:text-white/60">
                              {eod.pac_total_amount ? formatCurrency(eod.pac_total_amount) : '—'}
                            </td>
                            <td className="px-4 py-3 text-slate-500 dark:text-white/40 max-w-[200px] truncate">
                              {eod.note || t('performance.no_note')}
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </div>
              )}
            </div>
          </div>
        )}

      </div>
    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: {
  label: string
  value: string
  accent: 'navy' | 'teal' | 'red'
}) {
  const accentMap = {
    navy: 'bg-brand-navy/10 text-brand-navy dark:text-white border-brand-navy/20',
    teal: 'bg-brand-teal/10 text-brand-teal border-brand-teal/20',
    red:  'bg-brand-red/10 text-brand-red border-brand-red/20',
  }
  return (
    <div className={cn(
      'rounded-2xl border p-5',
      accentMap[accent],
    )}>
      <p className="font-body text-xs font-semibold uppercase tracking-wide opacity-60 mb-1">{label}</p>
      <p className="font-display text-2xl font-bold">{value}</p>
    </div>
  )
}
