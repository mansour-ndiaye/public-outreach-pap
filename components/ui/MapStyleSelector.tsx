'use client'

import { useState, useEffect, useCallback } from 'react'
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

// Representative preview colors for each style
const STYLE_BG: Record<MapStyleId, string> = {
  dark:       '#0f172a',
  streets:    '#f0ece2',
  satellite:  '#1c3520',
  light:      '#f5f5f5',
  navigation: '#cfe8fa',
}

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
  /** Additional positioning / override classes (default: bottom-4 left-1/2 -translate-x-1/2) */
  className?: string
}

export function MapStyleSelector({ activeUrl, onSelect, locale, className }: MapStyleSelectorProps) {
  const isFr = locale !== 'en'

  return (
    <div className={cn(
      'absolute z-20 bottom-4 left-1/2 -translate-x-1/2',
      className,
    )}>
      {/* Horizontal scrollable thumbnail row */}
      <div className={cn(
        'flex gap-2 px-3 py-2 rounded-2xl',
        'bg-black/40 backdrop-blur-sm',
        'overflow-x-auto max-w-[calc(100vw-32px)]',
        // Hide default scrollbar on all browsers
        '[&::-webkit-scrollbar]:hidden [-ms-overflow-style:none] [scrollbar-width:none]',
      )}>
        {MAP_STYLES.map(style => {
          const isActive = style.url === activeUrl
          const label = isFr ? style.labelFr : style.labelEn
          return (
            <button
              key={style.id}
              onClick={() => onSelect(style.id)}
              title={label}
              className="flex flex-col items-center gap-1 flex-shrink-0 group select-none"
            >
              {/* Color tile */}
              <div
                className={cn(
                  'w-[52px] h-[40px] rounded-xl border-2 transition-all duration-150',
                  isActive
                    ? 'border-brand-teal shadow-[0_0_0_2px_rgba(0,181,163,0.35)] scale-[1.07]'
                    : 'border-white/25 group-hover:border-white/60 group-active:scale-[0.97]',
                )}
                style={{ backgroundColor: STYLE_BG[style.id] }}
              />
              {/* Label */}
              <span className={cn(
                'font-body text-[10px] font-semibold whitespace-nowrap drop-shadow',
                isActive ? 'text-brand-teal' : 'text-white/80',
              )}>
                {label}
              </span>
            </button>
          )
        })}
      </div>
    </div>
  )
}
