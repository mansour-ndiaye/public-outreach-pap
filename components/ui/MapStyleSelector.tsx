'use client'

import { useState, useEffect, useRef, useCallback } from 'react'
import { cn } from '@/lib/utils'

const STORAGE_KEY = 'pap_map_style'

export type MapStyleId =
  | 'dark'
  | 'streets'
  | 'satellite'
  | 'light'
  | 'navigation'

export const MAP_STYLES: { id: MapStyleId; labelFr: string; labelEn: string; url: string }[] = [
  { id: 'dark',       labelFr: 'Sombres',    labelEn: 'Dark',       url: 'mapbox://styles/mapbox/dark-v11' },
  { id: 'streets',    labelFr: 'Rues',       labelEn: 'Streets',    url: 'mapbox://styles/mapbox/streets-v12' },
  { id: 'satellite',  labelFr: 'Satellite',  labelEn: 'Satellite',  url: 'mapbox://styles/mapbox/satellite-streets-v12' },
  { id: 'light',      labelFr: 'Clair',      labelEn: 'Light',      url: 'mapbox://styles/mapbox/light-v11' },
  { id: 'navigation', labelFr: 'Navigation', labelEn: 'Navigation', url: 'mapbox://styles/mapbox/navigation-day-v1' },
]

// ── Hook: get/set the persisted map style ──────────────────────────────────────
export function useMapStyle(resolvedTheme: string | undefined): [string, (id: MapStyleId) => void] {
  const defaultStyle = resolvedTheme === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/streets-v12'

  const [mapStyleUrl, setMapStyleUrl] = useState<string>(defaultStyle)
  const [loaded, setLoaded] = useState(false)

  // Load from localStorage once on mount
  useEffect(() => {
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (saved) {
        const found = MAP_STYLES.find(s => s.id === saved)
        if (found) { setMapStyleUrl(found.url); setLoaded(true); return }
      }
    } catch { /* ignore */ }
    setLoaded(true)
  }, [])

  // When theme changes AND user has no saved pref, follow theme
  useEffect(() => {
    if (!loaded) return
    try {
      const saved = localStorage.getItem(STORAGE_KEY)
      if (!saved) setMapStyleUrl(defaultStyle)
    } catch { /* ignore */ }
  }, [resolvedTheme, loaded, defaultStyle])

  const setStyle = useCallback((id: MapStyleId) => {
    const found = MAP_STYLES.find(s => s.id === id)
    if (!found) return
    setMapStyleUrl(found.url)
    try { localStorage.setItem(STORAGE_KEY, id) } catch { /* ignore */ }
  }, [])

  return [mapStyleUrl, setStyle]
}

// ── Component ──────────────────────────────────────────────────────────────────
interface MapStyleSelectorProps {
  /** Current active style URL */
  activeUrl: string
  /** Called when user picks a new style */
  onSelect: (id: MapStyleId) => void
  /** Optional locale for label language */
  locale?: string
  /** Positioning class (e.g. 'top-4 right-16') */
  className?: string
}

export function MapStyleSelector({ activeUrl, onSelect, locale, className }: MapStyleSelectorProps) {
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)
  const isFr = locale !== 'en'

  // Close on outside click
  useEffect(() => {
    if (!open) return
    const handler = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', handler)
    return () => document.removeEventListener('mousedown', handler)
  }, [open])

  const active = MAP_STYLES.find(s => s.url === activeUrl) ?? MAP_STYLES[0]

  return (
    <div ref={ref} className={cn('absolute z-20', className)}>
      {/* Trigger button */}
      <button
        onClick={() => setOpen(o => !o)}
        title={isFr ? 'Style de carte' : 'Map style'}
        className={cn(
          'flex items-center gap-1.5 h-9 px-3 rounded-xl',
          'bg-white/90 dark:bg-[#12163a]/95 backdrop-blur-sm',
          'border border-slate-200/80 dark:border-white/[0.12] shadow-md',
          'font-body text-xs font-semibold text-slate-700 dark:text-white/80',
          'hover:bg-white dark:hover:bg-white/10',
          'transition-colors duration-150 select-none',
        )}
      >
        <svg className="w-3.5 h-3.5 shrink-0 text-slate-500 dark:text-white/50" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
          <polygon points="3 6 9 3 15 6 21 3 21 18 15 21 9 18 3 21"/>
          <line x1="9" y1="3" x2="9" y2="18"/>
          <line x1="15" y1="6" x2="15" y2="21"/>
        </svg>
        <span className="hidden sm:inline">{isFr ? active.labelFr : active.labelEn}</span>
        <svg className={cn('w-3 h-3 shrink-0 text-slate-400 dark:text-white/40 transition-transform duration-150', open && 'rotate-180')} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
          <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7"/>
        </svg>
      </button>

      {/* Dropdown */}
      {open && (
        <div className={cn(
          'absolute top-full mt-1 right-0 min-w-[140px]',
          'bg-white dark:bg-[#12163a]',
          'border border-slate-200/80 dark:border-white/[0.10]',
          'rounded-xl shadow-2xl overflow-hidden',
          'py-1',
          'animate-fade-in',
        )}>
          {MAP_STYLES.map(style => {
            const isActive = style.url === activeUrl
            return (
              <button
                key={style.id}
                onClick={() => { onSelect(style.id); setOpen(false) }}
                className={cn(
                  'w-full flex items-center gap-2.5 px-3 py-2 text-left',
                  'font-body text-xs font-medium',
                  'transition-colors duration-100',
                  isActive
                    ? 'bg-brand-navy/8 dark:bg-white/[0.08] text-brand-navy dark:text-brand-teal'
                    : 'text-slate-600 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.04]',
                )}
              >
                {/* Active dot */}
                <span className={cn(
                  'w-1.5 h-1.5 rounded-full shrink-0',
                  isActive ? 'bg-brand-teal' : 'bg-transparent',
                )} />
                {isFr ? style.labelFr : style.labelEn}
              </button>
            )
          })}
        </div>
      )}
    </div>
  )
}
