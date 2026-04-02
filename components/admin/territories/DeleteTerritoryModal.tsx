'use client'

import { useState, useEffect, useTransition } from 'react'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { deleteTerritory } from '@/lib/supabase/territory-actions'
import type { TerritoryRow } from '@/types'

interface Props {
  territory: TerritoryRow
  onDeleted: (id: string) => void
  onCancel: () => void
}

export function DeleteTerritoryModal({ territory, onDeleted, onCancel }: Props) {
  const t = useTranslations('admin.territories')
  const [isPending, startTransition] = useTransition()
  const [isTouch, setIsTouch] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

  const handleDelete = () => {
    setError(null)
    startTransition(async () => {
      const result = await deleteTerritory(territory.id)
      if (result.error) { setError(result.error); return }
      onDeleted(territory.id)
    })
  }

  const body = (
    <div className="flex flex-col gap-4">
      <p className="font-body text-sm text-slate-600 dark:text-white/60 leading-relaxed">
        {t('delete_desc')}
      </p>
      <div className="rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-slate-100 dark:border-white/[0.06] px-4 py-3">
        <p className="font-body text-sm font-semibold text-slate-800 dark:text-white">
          {territory.name}
        </p>
        {territory.sector && (
          <p className="font-body text-xs text-slate-400 dark:text-white/40 mt-0.5">
            {territory.sector}
          </p>
        )}
      </div>

      {error && (
        <div className="rounded-xl bg-brand-red/10 border border-brand-red/20 px-3 py-2.5">
          <p className="font-body text-xs text-brand-red">{error}</p>
        </div>
      )}

      <div className="flex gap-3">
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
          {t('delete_cancel')}
        </button>
        <button
          onClick={handleDelete}
          disabled={isPending}
          className={cn(
            'flex-1 h-11 rounded-xl font-body text-sm font-semibold',
            'bg-brand-red text-white',
            'hover:bg-brand-red-dark active:scale-[0.98]',
            'transition-all disabled:opacity-50',
            'flex items-center justify-center gap-2',
          )}
        >
          {isPending
            ? <><Spinner />{t('delete_deleting')}</>
            : t('delete_confirm')}
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
          <div className="flex items-center gap-3 mb-5">
            <div className="w-9 h-9 rounded-xl bg-brand-red/10 flex items-center justify-center shrink-0">
              <svg className="w-5 h-5 text-brand-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
                <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
              </svg>
            </div>
            <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">
              {t('delete_title')}
            </h2>
          </div>
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
        'w-full max-w-sm',
        'rounded-2xl',
        'bg-white dark:bg-[#141738]',
        'border border-slate-100 dark:border-white/[0.08]',
        'p-6 shadow-xl',
        'animate-fade-in',
      )}>
        <div className="flex items-center gap-3 mb-5">
          <div className="w-9 h-9 rounded-xl bg-brand-red/10 flex items-center justify-center shrink-0">
            <svg className="w-5 h-5 text-brand-red" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
              <polyline points="3 6 5 6 21 6"/><path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/><path d="M10 11v6M14 11v6"/><path d="M9 6V4a1 1 0 0 1 1-1h4a1 1 0 0 1 1 1v2"/>
            </svg>
          </div>
          <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">
            {t('delete_title')}
          </h2>
        </div>
        {body}
      </div>
    </>
  )
}

function Spinner() {
  return <span className="w-4 h-4 border-2 border-white/30 border-t-white rounded-full animate-spin" />
}
