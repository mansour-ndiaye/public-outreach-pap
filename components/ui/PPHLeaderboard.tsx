'use client'

import { useState, useCallback, useEffect } from 'react'
import { createClient } from '@/lib/supabase/client'
import { fetchPPHLeaderboard } from '@/lib/supabase/eod-actions'
import type { LeaderboardEntry } from '@/lib/supabase/eod-actions'
import { AvatarDisplay } from '@/components/ui/AvatarButton'
import { cn } from '@/lib/utils'

interface PPHLeaderboardProps {
  /** Highlight this supervisor as "you" — optional (admin/manager view won't pass it) */
  supervisorId?: string
  locale?: string
}

export function PPHLeaderboard({ supervisorId, locale }: PPHLeaderboardProps) {
  const [period, setPeriod] = useState<'week' | 'all'>('week')
  const [rows,   setRows]   = useState<LeaderboardEntry[]>([])
  const [loading, setLoading] = useState(true)

  const load = useCallback(async () => {
    setLoading(true)
    const data = await fetchPPHLeaderboard(period)
    setRows(data)
    setLoading(false)
  }, [period])

  useEffect(() => { load() }, [load])

  // Realtime: refresh on any daily_entries change
  useEffect(() => {
    const supabase = createClient()
    const channel = supabase
      .channel('leaderboard-entries')
      .on('postgres_changes', { event: '*', schema: 'public', table: 'daily_entries' }, () => { load() })
      .subscribe()
    return () => { supabase.removeChannel(channel) }
  }, [load])

  const rankColors = ['text-yellow-500', 'text-slate-400', 'text-amber-600']
  const rankIcons  = ['#1', '#2', '#3']

  return (
    <section className="space-y-4">
      <div className="flex items-center justify-between gap-3 flex-wrap">
        <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white">
          {locale !== 'en' ? 'Classement PPH' : 'PPH Rankings'}
        </h2>
        <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 shrink-0">
          {(['week', 'all'] as const).map(p => (
            <button
              key={p}
              onClick={() => setPeriod(p)}
              className={cn(
                'px-3 py-1.5 font-body text-xs font-semibold transition-colors',
                period === p
                  ? 'bg-brand-navy text-white'
                  : 'text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.05]',
              )}
            >
              {p === 'week'
                ? (locale !== 'en' ? '7 jours' : '7 days')
                : (locale !== 'en' ? 'Tout temps' : 'All time')}
            </button>
          ))}
        </div>
      </div>

      {loading ? (
        <div className="flex justify-center py-8">
          <div className="w-6 h-6 rounded-full border-2 border-brand-teal border-t-transparent animate-spin" />
        </div>
      ) : rows.length === 0 ? (
        <p className="font-body text-sm text-slate-400 dark:text-white/30">
          {locale !== 'en' ? 'Aucune donnée pour cette période.' : 'No data for this period.'}
        </p>
      ) : (
        <div className="space-y-2">
          {rows.map((row, i) => {
            const isMe = supervisorId != null && row.supervisor_id === supervisorId
            return (
              <div
                key={row.supervisor_id}
                className={cn(
                  'flex items-center gap-3 px-4 py-3 rounded-2xl border transition-all duration-150',
                  isMe
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'bg-white dark:bg-white/[0.02] border-slate-200/80 dark:border-white/[0.07]',
                )}
              >
                {/* Rank */}
                <span className={cn(
                  'font-display text-sm font-bold w-6 text-center shrink-0',
                  isMe ? 'text-white/80' : (rankColors[i] ?? 'text-slate-400 dark:text-white/30'),
                )}>
                  {rankIcons[i] ?? `#${i + 1}`}
                </span>

                {/* Avatar */}
                <AvatarDisplay
                  name={row.supervisor_name}
                  avatarUrl={row.avatar_url}
                  size="xs"
                  bgClass={isMe ? 'bg-white/20' : 'bg-brand-navy/10 dark:bg-white/10'}
                  className={isMe ? 'text-[9px] font-bold text-white' : 'text-[9px] font-bold text-brand-navy dark:text-white'}
                />

                {/* Name + team */}
                <div className="flex-1 min-w-0">
                  <div className="flex items-center gap-2">
                    <p className={cn(
                      'font-body text-sm font-semibold truncate',
                      isMe ? 'text-white' : 'text-brand-navy dark:text-white',
                    )}>
                      {row.supervisor_name}
                    </p>
                    {isMe && (
                      <span className="shrink-0 inline-flex items-center px-1.5 py-0.5 rounded-full bg-white/20 font-body text-[9px] font-bold text-white uppercase tracking-wide">
                        {locale !== 'en' ? 'Vous' : 'You'}
                      </span>
                    )}
                  </div>
                  {row.team_name && (
                    <p className={cn(
                      'font-body text-xs truncate',
                      isMe ? 'text-white/60' : 'text-slate-400 dark:text-white/30',
                    )}>
                      {row.team_name}
                    </p>
                  )}
                </div>

                {/* Stats */}
                <div className="text-right shrink-0">
                  <p className={cn(
                    'font-display text-sm font-bold',
                    isMe ? 'text-white' : 'text-brand-teal',
                  )}>
                    {row.avg_pph.toFixed(2)}
                  </p>
                  <p className={cn(
                    'font-body text-[10px]',
                    isMe ? 'text-white/50' : 'text-slate-400 dark:text-white/30',
                  )}>
                    {row.canvas_hours.toFixed(1)}h
                  </p>
                </div>
              </div>
            )
          })}
        </div>
      )}
    </section>
  )
}
