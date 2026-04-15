'use client'

import { useState, useMemo } from 'react'
import Link from 'next/link'
import nextDynamic from 'next/dynamic'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { AvatarDisplay } from '@/components/ui/AvatarButton'
import { PPHLeaderboard } from '@/components/ui/PPHLeaderboard'
import type { TerritoryRow } from '@/types'
import type { DailyZoneWithTeam, TeamZoneStatus } from '@/lib/supabase/zone-actions'
import type { EODWithTeam } from '@/lib/supabase/eod-actions'

// Lazy-load map components (no SSR)
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
const EodMiniMap    = nextDynamic(() => import('@/components/ui/EodMiniMap'),    { ssr: false })
const EodHistoryMap = nextDynamic(() => import('@/components/ui/EodHistoryMap'), { ssr: false })

// 8-color team palette
const TEAM_COLORS = [
  '#E8174B', '#00B5A3', '#FF8C00', '#8B5CF6',
  '#F59E0B', '#10B981', '#3B82F6', '#EC4899',
]

type TeamOption = { id: string; name: string }
type Tab = 'map' | 'teams' | 'performance' | 'ranking'

interface ManagerDashboardProps {
  territories:       TerritoryRow[]
  teams:             TeamOption[]
  zones:             DailyZoneWithTeam[]
  zoneStatuses:      TeamZoneStatus[]
  recentEODs:        EODWithTeam[]
  allCoveredStreets?: GeoJSON.FeatureCollection
  todayDate:         string
  locale?:           string
  isAdmin?:          boolean
}

function formatDate(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-CA', {
    month: 'short', day: 'numeric',
  })
}

function formatDateLong(dateStr: string) {
  return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-CA', {
    weekday: 'short', month: 'short', day: 'numeric',
  })
}

function formatCurrency(n: number) {
  return new Intl.NumberFormat('fr-CA', { style: 'currency', currency: 'CAD', minimumFractionDigits: 0 }).format(n)
}

function initials(name: string) {
  return name.split(' ').slice(0, 2).map(p => p[0]?.toUpperCase() ?? '').join('')
}

// ── Truncated note (table cell) ───────────────────────────────────────────────
function TruncatedNote({ note }: { note: string | null }) {
  if (!note) return <span className="text-slate-400 dark:text-white/30">—</span>
  return <span title={note}>{note.length > 80 ? note.slice(0, 80) + '…' : note}</span>
}

export default function ManagerDashboard({
  territories, teams, zones, zoneStatuses, recentEODs, allCoveredStreets, todayDate, locale, isAdmin,
}: ManagerDashboardProps) {
  const t = useTranslations('manager')
  const [tab, setTab] = useState<Tab>('map')

  // Performance tab: supervisor filter
  const [filterSupervisor, setFilterSupervisor] = useState('')
  const [csvPeriod, setCsvPeriod] = useState<'week' | 'month' | 'all'>('week')

  // Supervisor detail slide-over
  const [detailSupervisorId, setDetailSupervisorId] = useState<string | null>(null)
  const [expandedEOD, setExpandedEOD] = useState<string | null>(null)

  // Teams tab: expanded rows
  const [expandedTeams, setExpandedTeams] = useState<Set<string>>(new Set())
  const toggleTeam = (teamId: string) => {
    setExpandedTeams(prev => {
      const next = new Set(prev)
      if (next.has(teamId)) next.delete(teamId)
      else next.add(teamId)
      return next
    })
  }

  // Build team color map (team_id → color)
  const teamColorMap = useMemo(() => {
    const map: Record<string, string> = {}
    const sorted = [...teams].sort((a, b) => a.name.localeCompare(b.name))
    sorted.forEach((team, i) => { map[team.id] = TEAM_COLORS[i % TEAM_COLORS.length] })
    return map
  }, [teams])

  // Unique supervisors across all EODs (for filter dropdown)
  const supervisorOptions = useMemo(() => {
    const map = new Map<string, string>()
    for (const e of recentEODs) {
      if (e.supervisor_id && e.supervisor_name) map.set(e.supervisor_id, e.supervisor_name)
    }
    return Array.from(map.entries()).map(([id, name]) => ({ id, name }))
  }, [recentEODs])

  // Filtered EODs
  const filteredEODs = useMemo(() => {
    if (!filterSupervisor) return recentEODs
    return recentEODs.filter(e => e.supervisor_id === filterSupervisor)
  }, [recentEODs, filterSupervisor])

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
    const activeSupervisorsToday = new Set(
      recentEODs.filter(e => e.entry_date === todayDate && e.supervisor_id).map(e => e.supervisor_id!)
    ).size
    return { totalPac, totalHours, avgPph, activeSupervisorsToday }
  }, [recentEODs, todayDate])

  // CSV export
  const exportCSV = () => {
    const now = new Date()
    let cutoff: string | null = null
    if (csvPeriod === 'week') {
      const d = new Date(now); d.setDate(d.getDate() - 7)
      cutoff = d.toISOString().split('T')[0]
    } else if (csvPeriod === 'month') {
      cutoff = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    }
    const rows = cutoff ? recentEODs.filter(e => (e.entry_date ?? '') >= cutoff!) : recentEODs

    const escape = (v: string | number | null | undefined) => {
      if (v == null) return ''
      const s = String(v)
      return s.includes(',') || s.includes('"') || s.includes('\n')
        ? `"${s.replace(/"/g, '""')}"`
        : s
    }

    const headers = ['date', 'team', 'supervisor_name', 'pph', 'canvas_hours', 'pac_count', 'pac_total', 'pac_average', 'pfu', 'recalls_count', 'note', 'streets_covered_count']
    const lines = [
      headers.join(','),
      ...rows.map(e => [
        escape(e.entry_date),
        escape(e.team_name),
        escape(e.supervisor_name),
        escape(e.pph?.toFixed(2)),
        escape(e.canvas_hours),
        escape(e.pac_count),
        escape(e.pac_total_amount),
        escape(e.pac_average?.toFixed(2)),
        escape(e.pfu),
        escape(e.recalls_count),
        escape(e.note),
        escape((e.covered_streets as GeoJSON.FeatureCollection | null)?.features?.length ?? 0),
      ].join(',')),
    ]
    const blob = new Blob([lines.join('\n')], { type: 'text/csv;charset=utf-8;' })
    const url  = URL.createObjectURL(blob)
    const a    = document.createElement('a')
    a.href     = url
    a.download = `performance_${csvPeriod}_${now.toISOString().split('T')[0]}.csv`
    a.click()
    URL.revokeObjectURL(url)
  }

  // Supervisor detail data
  const detailSupervisor = useMemo(() => {
    if (!detailSupervisorId) return null
    const eods = recentEODs.filter(e => e.supervisor_id === detailSupervisorId)
    if (!eods.length) return null
    const name      = eods[0].supervisor_name ?? detailSupervisorId
    const avatarUrl = eods[0].supervisor_avatar_url ?? null
    const teamName  = eods[0].team_name ?? '—'
    const teamId    = eods[0].team_id ?? ''

    const now = new Date()
    const monthStart = new Date(now.getFullYear(), now.getMonth(), 1).toISOString().split('T')[0]
    const monthEODs = eods.filter(e => (e.entry_date ?? '') >= monthStart)
    const totalPacMonth = monthEODs.reduce((s, e) => s + (e.pac_count ?? 0), 0)
    const totalHours = eods.reduce((s, e) => s + (e.canvas_hours ?? 0), 0)
    const pphs = eods.map(e => e.pph).filter(Boolean)
    const avgPph = pphs.length ? pphs.reduce((a, b) => a + b, 0) / pphs.length : 0
    const bestPph = pphs.length ? Math.max(...pphs) : 0
    const bestPphDate = eods.find(e => e.pph === bestPph)?.entry_date ?? null

    return { name, avatarUrl, teamName, teamId, eods, totalPacMonth, totalHours, avgPph, bestPph, bestPphDate }
  }, [detailSupervisorId, recentEODs])

  const tabs: { key: Tab; label: string }[] = [
    { key: 'map',         label: t('tabs.map') },
    { key: 'teams',       label: t('tabs.teams') },
    { key: 'performance', label: t('tabs.performance') },
    { key: 'ranking',     label: t('tabs.ranking') },
  ]

  return (
    <div className="flex flex-col h-full relative">

      {/* Admin back button */}
      {isAdmin && (
        <div className="shrink-0 px-4 py-2 bg-white/70 dark:bg-white/[0.03] border-b border-slate-200/60 dark:border-white/[0.05]">
          <Link
            href={`/${locale}/admin/dashboard`}
            className="inline-flex items-center gap-1.5 text-xs font-semibold font-body text-slate-500 dark:text-white/50 hover:text-brand-navy dark:hover:text-white transition-colors"
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M19 12H5M12 5l-7 7 7 7" />
            </svg>
            {locale !== 'en' ? 'Retour au tableau de bord' : 'Back to dashboard'}
          </Link>
        </div>
      )}

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
            allCoveredStreets={allCoveredStreets}
            todayDate={todayDate}
            teamColorMap={teamColorMap}
            locale={locale}
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
              <div className="space-y-3">
                {zoneStatuses.map(team => {
                  const isExpanded = expandedTeams.has(team.team_id)
                  const anyAssigned = team.supervisors.some(s => s.zone_assigned)
                  return (
                    <div key={team.team_id} className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[0.07]">
                      <button
                        onClick={() => toggleTeam(team.team_id)}
                        className="w-full flex items-center gap-3 px-4 py-3.5 bg-slate-50 dark:bg-white/[0.03] hover:bg-slate-100 dark:hover:bg-white/[0.05] transition-colors text-left"
                      >
                        <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: teamColorMap[team.team_id] ?? '#94a3b8' }} />
                        <span className="font-semibold font-body text-brand-navy dark:text-white flex-1">{team.team_name}</span>
                        {team.territory_name && (
                          <span className="font-body text-xs text-slate-400 dark:text-white/40 hidden sm:block">{team.territory_name}</span>
                        )}
                        <span className={cn(
                          'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold',
                          anyAssigned
                            ? 'bg-brand-teal/10 text-brand-teal border border-brand-teal/25'
                            : 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/[0.05] dark:text-white/40 dark:border-white/10',
                        )}>
                          <span className={cn('w-1.5 h-1.5 rounded-full', anyAssigned ? 'bg-brand-teal' : 'bg-slate-400')} />
                          {anyAssigned
                            ? `${team.supervisors.filter(s => s.zone_assigned).length}/${team.supervisors.length} assigné${team.supervisors.filter(s => s.zone_assigned).length > 1 ? 's' : ''}`
                            : (locale !== 'en' ? 'Non assignée' : 'Not assigned')}
                        </span>
                        <svg className={cn('w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0', isExpanded && 'rotate-180')} fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>
                      {isExpanded && (
                        <div className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                          {team.supervisors.length === 0 ? (
                            <div className="px-5 py-3 font-body text-sm text-slate-400 dark:text-white/30 italic">
                              {locale !== 'en' ? 'Aucun superviseur dans cette équipe' : 'No supervisors in this team'}
                            </div>
                          ) : (
                            team.supervisors.map(sup => (
                              <div key={sup.supervisor_id} className="flex items-center gap-3 px-5 py-3 bg-white dark:bg-transparent hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors">
                                <AvatarDisplay
                                  name={sup.supervisor_name}
                                  avatarUrl={sup.supervisor_avatar_url}
                                  size="sm"
                                  className="text-xs font-bold text-brand-navy dark:text-white"
                                />
                                <span className="flex-1 font-body text-sm text-slate-700 dark:text-white/80 min-w-0 truncate">{sup.supervisor_name}</span>
                                <span className={cn(
                                  'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-xs font-semibold whitespace-nowrap',
                                  sup.zone_assigned
                                    ? 'bg-brand-teal/10 text-brand-teal border border-brand-teal/25'
                                    : 'bg-slate-100 text-slate-500 border border-slate-200 dark:bg-white/[0.05] dark:text-white/40 dark:border-white/10',
                                )}>
                                  {sup.zone_assigned ? (locale !== 'en' ? 'Assignée ✓' : 'Assigned ✓') : (locale !== 'en' ? 'Non assignée' : 'Not assigned')}
                                </span>
                                <span className="font-body text-xs text-slate-400 dark:text-white/30 hidden sm:block whitespace-nowrap">
                                  {sup.last_eod_date ? formatDate(sup.last_eod_date) : '—'}
                                </span>
                                {sup.last_pph != null ? (
                                  <span className="font-body text-xs font-semibold text-brand-teal hidden sm:block whitespace-nowrap">{sup.last_pph.toFixed(2)} PPH</span>
                                ) : (
                                  <span className="hidden sm:block text-slate-300 dark:text-white/20 text-xs">—</span>
                                )}
                              </div>
                            ))
                          )}
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            )}
          </div>
        )}

        {/* ── PERFORMANCE TAB ── */}
        {tab === 'performance' && (
          <div className="h-full overflow-y-auto p-6 max-w-5xl mx-auto space-y-8">
            <div className="flex items-center justify-between gap-4 flex-wrap">
              <h2 className="font-display text-xl font-bold text-brand-navy dark:text-white">
                {t('performance.title')}
              </h2>
              {/* CSV Export */}
              <div className="flex items-center gap-2 shrink-0">
                <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/10">
                  {(['week', 'month', 'all'] as const).map(p => (
                    <button
                      key={p}
                      onClick={() => setCsvPeriod(p)}
                      className={cn(
                        'px-3 py-1.5 font-body text-xs font-semibold transition-colors',
                        csvPeriod === p
                          ? 'bg-brand-navy text-white'
                          : 'text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.05]',
                      )}
                    >
                      {p === 'week'  ? (locale !== 'en' ? '7j' : '7d')
                      : p === 'month' ? (locale !== 'en' ? 'Mois' : 'Month')
                      :                 (locale !== 'en' ? 'Tout' : 'All')}
                    </button>
                  ))}
                </div>
                <button
                  onClick={exportCSV}
                  className={cn(
                    'flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-body text-xs font-semibold',
                    'bg-brand-teal text-white hover:opacity-90 transition-opacity',
                  )}
                >
                  <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 16v-8M9 13l3 3 3-3M5 20h14"/>
                  </svg>
                  CSV
                </button>
              </div>
            </div>

            {/* Stats cards */}
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-4">
              <StatCard label={t('performance.week_pac')} value={String(stats.totalPac)} accent="navy" />
              <StatCard label={t('performance.avg_pph')} value={stats.avgPph.toFixed(2)} accent="teal" />
              <StatCard label={t('performance.canvas_hours')} value={stats.totalHours.toFixed(1) + 'h'} accent="red" />
              <StatCard
                label={locale !== 'en' ? 'Superviseurs actifs aujourd\'hui' : 'Active supervisors today'}
                value={String(stats.activeSupervisorsToday)}
                accent="slate"
              />
            </div>

            {/* Recent EODs table */}
            <div>
              <div className="flex items-center justify-between mb-4 gap-3 flex-wrap">
                <h3 className="font-display text-base font-semibold text-brand-navy dark:text-white">
                  {t('performance.recent_eods')}
                </h3>
                {supervisorOptions.length > 0 && (
                  <select
                    value={filterSupervisor}
                    onChange={e => setFilterSupervisor(e.target.value)}
                    className={cn(
                      'rounded-xl px-3 py-2 font-body text-xs',
                      'bg-slate-50 border border-slate-200 text-slate-700',
                      'dark:bg-white/[0.06] dark:border-white/10 dark:text-white',
                      'focus-visible:outline-none focus-visible:border-brand-teal',
                    )}
                  >
                    <option value="">{locale !== 'en' ? 'Tous les superviseurs' : 'All supervisors'}</option>
                    {supervisorOptions.map(s => (
                      <option key={s.id} value={s.id}>{s.name}</option>
                    ))}
                  </select>
                )}
              </div>

              {filteredEODs.length === 0 ? (
                <p className="font-body text-sm text-slate-500 dark:text-white/40">{t('performance.empty')}</p>
              ) : (
                <div className="overflow-hidden rounded-2xl border border-slate-200/80 dark:border-white/[0.07]">
                  <div className="overflow-x-auto">
                    <table className="w-full text-sm font-body">
                      <thead>
                        <tr className="bg-slate-50 dark:bg-white/[0.03]">
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{t('performance.col_date')}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{t('performance.col_team')}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{locale !== 'en' ? 'Superviseur' : 'Supervisor'}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{t('performance.col_pph')}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{t('performance.col_hours')}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{t('performance.col_pac')}</th>
                          <th className="px-4 py-3 text-left text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">{t('performance.col_note')}</th>
                        </tr>
                      </thead>
                      <tbody className="divide-y divide-slate-100 dark:divide-white/[0.04]">
                        {filteredEODs.map(eod => (
                          <tr key={eod.id} className="bg-white dark:bg-transparent hover:bg-slate-50/80 dark:hover:bg-white/[0.02] transition-colors">
                            <td className="px-4 py-3 text-slate-600 dark:text-white/60 text-xs whitespace-nowrap">
                              {eod.entry_date ? formatDate(eod.entry_date) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {eod.team_name ? (
                                <div className="flex items-center gap-2">
                                  <div className="w-2.5 h-2.5 rounded-full shrink-0" style={{ backgroundColor: teamColorMap[eod.team_id ?? ''] ?? '#94a3b8' }} />
                                  <span className="font-semibold text-brand-navy dark:text-white">{eod.team_name}</span>
                                </div>
                              ) : '—'}
                            </td>
                            <td className="px-4 py-3">
                              {eod.supervisor_name ? (
                                <button
                                  onClick={() => { setDetailSupervisorId(eod.supervisor_id ?? null); setExpandedEOD(null) }}
                                  className="flex items-center gap-2 group"
                                >
                                  <AvatarDisplay
                                    name={eod.supervisor_name}
                                    avatarUrl={eod.supervisor_avatar_url}
                                    size="xs"
                                    bgClass="bg-brand-navy/10 dark:bg-white/10 group-hover:bg-brand-teal/20"
                                    className="transition-colors text-[9px] font-bold text-brand-navy dark:text-white"
                                  />
                                  <span className="text-slate-700 dark:text-white/70 text-xs group-hover:text-brand-teal transition-colors">{eod.supervisor_name}</span>
                                </button>
                              ) : <span className="text-slate-400 dark:text-white/30">—</span>}
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
                            <td className="px-4 py-3 text-slate-500 dark:text-white/40 max-w-[220px]">
                              <TruncatedNote note={eod.note} />
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

        {/* ── RANKING TAB ── */}
        {tab === 'ranking' && (
          <div className="h-full overflow-y-auto p-6 max-w-2xl mx-auto">
            <PPHLeaderboard locale={locale} />
          </div>
        )}

      </div>

      {/* ── SUPERVISOR DETAIL SLIDE-OVER ─────────────────────────────────────── */}
      {detailSupervisor && (
        <>
          {/* Backdrop */}
          <div
            className="absolute inset-0 z-40 bg-black/40 backdrop-blur-sm"
            onClick={() => setDetailSupervisorId(null)}
          />
          {/* Panel */}
          <div className={cn(
            'absolute inset-y-0 right-0 z-50 w-full sm:w-[420px]',
            'bg-white dark:bg-[#12163a] flex flex-col',
            'border-l border-slate-200/80 dark:border-white/[0.08] shadow-2xl',
            'animate-slide-left',
          )}>
            {/* Header */}
            <div className="flex items-center gap-4 px-5 py-4 border-b border-slate-200/60 dark:border-white/[0.07] shrink-0">
              <AvatarDisplay
                name={detailSupervisor.name}
                avatarUrl={detailSupervisor.avatarUrl}
                size="lg"
                bgClass="bg-brand-navy"
                className="text-white text-lg"
              />
              <div className="flex-1 min-w-0">
                <p className="font-display text-base font-bold text-brand-navy dark:text-white truncate">{detailSupervisor.name}</p>
                <p className="font-body text-xs text-slate-500 dark:text-white/50">{detailSupervisor.teamName}</p>
              </div>
              <button
                onClick={() => setDetailSupervisorId(null)}
                className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors shrink-0"
              >
                <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
                </svg>
              </button>
            </div>

            {/* Stats summary */}
            <div className="px-5 py-4 grid grid-cols-2 gap-3 shrink-0 border-b border-slate-200/60 dark:border-white/[0.07]">
              <MiniStat
                label={locale !== 'en' ? 'PACs ce mois' : 'PACs this month'}
                value={String(detailSupervisor.totalPacMonth)}
                accent="navy"
              />
              <MiniStat label={locale !== 'en' ? 'PPH moyen' : 'Avg PPH'} value={detailSupervisor.avgPph.toFixed(2)} accent="teal" />
              <MiniStat
                label={locale !== 'en' ? 'Heures terrain' : 'Canvas hours'}
                value={detailSupervisor.totalHours.toFixed(1) + 'h'}
                accent="slate"
              />
              <MiniStat
                label={locale !== 'en' ? `Meilleur PPH${detailSupervisor.bestPphDate ? ' (' + formatDate(detailSupervisor.bestPphDate) + ')' : ''}` : `Best PPH${detailSupervisor.bestPphDate ? ' (' + formatDate(detailSupervisor.bestPphDate) + ')' : ''}`}
                value={detailSupervisor.bestPph.toFixed(2)}
                accent="red"
              />
            </div>

            {/* ── Full terrain barré history map ── */}
            <div className="px-5 pt-4 pb-2 shrink-0 border-b border-slate-200/60 dark:border-white/[0.07]">
              <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide mb-2">
                {locale !== 'en' ? 'Terrain barré — historique complet' : 'Covered streets — full history'}
              </p>
              <EodHistoryMap eods={detailSupervisor.eods} height={200} locale={locale} />
            </div>

            {/* EOD history */}
            <div className="flex-1 overflow-y-auto px-5 py-4 space-y-2">
              <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide mb-3">
                {locale !== 'en' ? 'Historique EOD' : 'EOD History'} ({detailSupervisor.eods.length})
              </p>
              {detailSupervisor.eods.length === 0 ? (
                <p className="font-body text-sm text-slate-400 dark:text-white/30">{t('performance.empty')}</p>
              ) : (
                detailSupervisor.eods.map(eod => {
                  const isExpanded = expandedEOD === eod.id
                  const covered = eod.covered_streets as GeoJSON.FeatureCollection | null
                  const streetCount = covered?.features?.length ?? 0
                  return (
                    <div key={eod.id} className="rounded-xl border border-slate-200/80 dark:border-white/[0.07] overflow-hidden bg-white dark:bg-white/[0.02]">
                      <button
                        onClick={() => setExpandedEOD(isExpanded ? null : eod.id)}
                        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="flex-1 min-w-0">
                          <div className="flex items-center gap-3">
                            <span className="font-body text-sm font-semibold text-brand-navy dark:text-white whitespace-nowrap">
                              {eod.entry_date ? formatDateLong(eod.entry_date) : '—'}
                            </span>
                            <span className="font-body text-sm font-bold text-brand-teal">
                              {eod.pph?.toFixed(2)} PPH
                            </span>
                          </div>
                          <div className="flex items-center gap-3 mt-0.5">
                            <span className="font-body text-xs text-slate-400 dark:text-white/30">
                              {eod.canvas_hours != null ? `${eod.canvas_hours}h` : ''}
                            </span>
                            {eod.pac_total_amount ? (
                              <span className="font-body text-xs text-slate-500 dark:text-white/40">
                                {formatCurrency(eod.pac_total_amount)}
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <svg
                          className={cn('w-4 h-4 text-slate-400 transition-transform duration-200 shrink-0', isExpanded && 'rotate-180')}
                          fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                        >
                          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                        </svg>
                      </button>

                      {isExpanded && (
                        <div className="px-4 pb-4 pt-2 border-t border-slate-100 dark:border-white/[0.04] space-y-3">
                          {/* Terrain barré mini-map */}
                          <EodMiniMap
                            coveredStreets={covered}
                            locale={locale}
                            height={120}
                            supervisorName={eod.supervisor_name ?? undefined}
                            teamName={eod.team_name ?? undefined}
                            date={eod.entry_date ?? undefined}
                          />

                          {streetCount > 0 && (
                            <p className="font-body text-xs text-slate-400 dark:text-white/30">
                              {streetCount} {locale !== 'en' ? 'rue(s) couvertes' : 'street(s) covered'}
                            </p>
                          )}
                          <div className="grid grid-cols-2 gap-2">
                            {[
                              { label: 'PPH', value: eod.pph?.toFixed(2) ?? '—' },
                              { label: locale !== 'en' ? 'Heures' : 'Hours', value: eod.canvas_hours != null ? `${eod.canvas_hours}h` : '—' },
                              { label: 'PAC $', value: eod.pac_total_amount ? formatCurrency(eod.pac_total_amount) : '—' },
                              { label: 'PACs', value: String(eod.pac_count || '—') },
                            ].map(({ label, value }) => (
                              <div key={label} className="rounded-lg bg-slate-50 dark:bg-white/[0.04] p-2.5">
                                <p className="font-body text-[10px] text-slate-500 dark:text-white/40 uppercase tracking-wide">{label}</p>
                                <p className="font-display text-sm font-bold text-brand-navy dark:text-white">{value}</p>
                              </div>
                            ))}
                          </div>
                          {eod.note && (
                            <p className="font-body text-sm text-slate-600 dark:text-white/60 italic leading-relaxed">"{eod.note}"</p>
                          )}
                        </div>
                      )}
                    </div>
                  )
                })
              )}
            </div>
          </div>
        </>
      )}

    </div>
  )
}

// ── Stat card ──────────────────────────────────────────────────────────────────
function StatCard({ label, value, accent }: {
  label: string
  value: string
  accent: 'navy' | 'teal' | 'red' | 'slate'
}) {
  const accentMap = {
    navy:  'bg-brand-navy/10 text-brand-navy dark:text-white border-brand-navy/20',
    teal:  'bg-brand-teal/10 text-brand-teal border-brand-teal/20',
    red:   'bg-brand-red/10 text-brand-red border-brand-red/20',
    slate: 'bg-slate-100 text-slate-700 border-slate-200 dark:bg-white/[0.05] dark:text-white dark:border-white/10',
  }
  return (
    <div className={cn('rounded-2xl border p-5', accentMap[accent])}>
      <p className="font-body text-xs font-semibold uppercase tracking-wide opacity-60 mb-1 leading-tight">{label}</p>
      <p className="font-display text-2xl font-bold">{value}</p>
    </div>
  )
}

// ── Mini stat card (for supervisor detail panel) ───────────────────────────────
function MiniStat({ label, value, accent }: {
  label: string
  value: string
  accent: 'navy' | 'teal' | 'red' | 'slate'
}) {
  const accentMap = {
    navy:  'text-brand-navy dark:text-white',
    teal:  'text-brand-teal',
    red:   'text-brand-red',
    slate: 'text-slate-600 dark:text-white/70',
  }
  return (
    <div className="rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3">
      <p className="font-body text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wide leading-tight mb-0.5">{label}</p>
      <p className={cn('font-display text-lg font-bold', accentMap[accent])}>{value}</p>
    </div>
  )
}
