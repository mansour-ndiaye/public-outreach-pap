'use client'

import { useState, useEffect, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createTerritory } from '@/lib/supabase/territory-actions'
import type { TeamRow, TerritoryRow, TerritoryStatus } from '@/types'

interface Props {
  coords: number[][][]
  teams: TeamRow[]
  onSave: (territory: TerritoryRow) => void
  onCancel: () => void
}

const inputCls = cn(
  'w-full px-3 h-11 rounded-xl border',
  'bg-white dark:bg-white/[0.05]',
  'font-body text-sm text-slate-900 dark:text-white',
  'border-slate-200 dark:border-white/[0.10]',
  'focus:outline-none focus:ring-2 focus:ring-brand-teal/50 focus:border-brand-teal',
  'placeholder:text-slate-300 dark:placeholder:text-white/20',
  'transition-shadow',
)

export function SaveTerritoryModal({ coords, teams, onSave, onCancel }: Props) {
  const t = useTranslations('admin.territories')
  const [isPending, startTransition] = useTransition()
  const [isTouch, setIsTouch] = useState(false)
  const [name, setName] = useState('')
  const [sector, setSector] = useState('')
  const [status, setStatus] = useState<TerritoryStatus>('active')
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  const handleSubmit = () => {
    if (!name.trim()) return
    setError(null)
    startTransition(async () => {
      const result = await createTerritory({
        name: name.trim(),
        sector: sector.trim() || null,
        status,
        coordinates: coords,
      })
      if (result.error) { setError(result.error); return }
      onSave({
        id: result.id!,
        name: name.trim(),
        sector: sector.trim() || null,
        status,
        coordinates: coords,
        created_at: new Date().toISOString(),
      })
    })
  }

  const body = (
    <div className="flex flex-col gap-4">
      {/* Name */}
      <div>
        <label className="block font-body text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40 mb-1.5">
          {t('save_name')} *
        </label>
        <input
          type="text"
          value={name}
          onChange={e => setName(e.target.value)}
          placeholder={t('save_name_placeholder')}
          className={inputCls}
          autoFocus
        />
      </div>

      {/* Sector */}
      <div>
        <label className="block font-body text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40 mb-1.5">
          {t('save_sector')}
        </label>
        <input
          type="text"
          value={sector}
          onChange={e => setSector(e.target.value)}
          placeholder={t('save_sector_placeholder')}
          className={inputCls}
        />
      </div>

      {/* Status */}
      <div>
        <label className="block font-body text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40 mb-1.5">
          {t('save_status')}
        </label>
        <select
          value={status}
          onChange={e => setStatus(e.target.value as TerritoryStatus)}
          className={cn(inputCls, 'cursor-pointer')}
        >
          <option value="active">{t('status_active')}</option>
          <option value="pending">{t('status_pending')}</option>
          <option value="inactive">{t('status_inactive')}</option>
        </select>
      </div>

      {/* Team (optional, only shown if teams exist) */}
      {teams.length > 0 && (
        <div>
          <label className="block font-body text-xs font-semibold uppercase tracking-wide text-slate-400 dark:text-white/40 mb-1.5">
            {t('save_team')}
          </label>
          <select className={cn(inputCls, 'cursor-pointer')}>
            <option value="">{t('save_team_none')}</option>
            {teams.map(team => (
              <option key={team.id} value={team.id}>{team.name}</option>
            ))}
          </select>
        </div>
      )}

      {/* Error */}
      {error && (
        <div className="rounded-xl bg-brand-red/10 border border-brand-red/20 px-3 py-2.5">
          <p className="font-body text-xs text-brand-red">{error}</p>
        </div>
      )}

      {/* Actions */}
      <div className="flex gap-3 pt-1">
        <button
          onClick={onCancel}
          disabled={isPending}
          className={cn(
            'flex-1 h-11 rounded-xl font-body text-sm font-semibold',
            'bg-transparent',
            'border border-slate-200 text-slate-700',
            'dark:border-white/[0.12] dark:text-white/70',
            'hover:bg-slate-100 dark:hover:bg-white/[0.06]',
            'transition-colors disabled:opacity-50',
          )}
        >
          {t('save_cancel')}
        </button>
        <button
          onClick={handleSubmit}
          disabled={isPending || !name.trim()}
          className={cn(
            'flex-1 h-11 rounded-xl font-body text-sm font-semibold',
            'bg-brand-navy text-white',
            'hover:bg-brand-navy-dark active:scale-[0.98]',
            'transition-all disabled:opacity-50',
            'flex items-center justify-center gap-2',
          )}
        >
          {isPending
            ? <><Spinner />{t('save_saving')}</>
            : t('save_submit')}
        </button>
      </div>
    </div>
  )

  if (isTouch) {
    return (
      <>
        <div className="fixed inset-0 z-40 bg-black/50" onClick={onCancel} />
        <div className={cn(
          'fixed inset-x-0 bottom-0 z-50',
          'rounded-t-2xl',
          'bg-white dark:bg-[#141738]',
          'border-t border-slate-100 dark:border-white/[0.08]',
          'px-5 pt-3 pb-10',
          'animate-sheet-up',
        )}>
          <div className="w-10 h-1 rounded-full bg-slate-200 dark:bg-white/20 mx-auto mb-5" />
          <h2 className="font-display text-base font-bold text-brand-navy dark:text-white mb-5">
            {t('save_title')}
          </h2>
          {body}
        </div>
      </>
    )
  }

  return (
    <>
      <div className="fixed inset-0 z-40 bg-black/40 backdrop-blur-sm" onClick={onCancel} />
      <div className={cn(
        'fixed z-50 top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2',
        'w-full max-w-md',
        'rounded-2xl',
        'bg-white dark:bg-[#141738]',
        'border border-slate-100 dark:border-white/[0.08]',
        'p-6 shadow-xl',
        'animate-fade-in',
      )}>
        <h2 className="font-display text-base font-bold text-brand-navy dark:text-white mb-5">
          {t('save_title')}
        </h2>
        {body}
      </div>
    </>
  )
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
}
