'use client'

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import Map, {
  Source, Layer, Marker, NavigationControl, type MapRef, type MapMouseEvent,
} from 'react-map-gl/mapbox'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createDailyZone } from '@/lib/supabase/zone-actions'
import type { TerritoryRow } from '@/types'
import type { DailyZoneWithTeam } from '@/lib/supabase/zone-actions'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
const MONTREAL: [number, number] = [-73.5673, 45.5017]

// 8-color team palette
const TEAM_COLORS = [
  '#E8174B', '#00B5A3', '#FF8C00', '#8B5CF6',
  '#F59E0B', '#10B981', '#3B82F6', '#EC4899',
]

type TeamOption = { id: string; name: string }

interface ManagerMapProps {
  territories:  TerritoryRow[]
  teams:        TeamOption[]
  zones:        DailyZoneWithTeam[]
  todayDate:    string
  teamColorMap: Record<string, string> // team_id → color hex
}

function getColor(map: Record<string, string>, teamId: string) {
  return map[teamId] ?? '#94a3b8'
}

// Polygon centroid
function polygonCentroid(coords: number[][][]): [number, number] {
  const ring = coords[0] ?? []
  if (ring.length === 0) return MONTREAL
  const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
  return [lng, lat]
}

// Build territory GeoJSON (polygons)
function buildTerritoriesGeoJSON(territories: TerritoryRow[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: territories
      .filter(t => t.coordinates && t.coordinates.length > 0)
      .map(t => ({
        type: 'Feature' as const,
        id: t.id,
        geometry: { type: 'Polygon' as const, coordinates: t.coordinates! },
        properties: { id: t.id, name: t.name },
      })),
  }
}

// Build zones GeoJSON (lines)
function buildZonesGeoJSON(
  zones: DailyZoneWithTeam[],
  colorMap: Record<string, string>,
  filter?: (z: DailyZoneWithTeam) => boolean,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []
  const subset = filter ? zones.filter(filter) : zones
  for (const zone of subset) {
    const fc = zone.streets as GeoJSON.FeatureCollection
    if (!fc?.features) continue
    for (const f of fc.features) {
      features.push({
        ...f,
        properties: {
          ...f.properties,
          team_id:   zone.team_id,
          team_name: zone.team_name,
          date:      zone.date,
          color:     getColor(colorMap, zone.team_id),
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

// Drawing GeoJSON (in-progress + completed)
function buildDrawingGeoJSON(
  currentLine: [number, number][],
  completed:   GeoJSON.Feature[],
  color:       string,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [...completed]
  if (currentLine.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: currentLine },
      properties: { color, status: 'drawing' },
    })
  }
  return { type: 'FeatureCollection', features }
}

export default function ManagerMap({
  territories, teams, zones, todayDate, teamColorMap,
}: ManagerMapProps) {
  const { resolvedTheme } = useTheme()
  const t = useTranslations('manager.map')
  const mapRef = useRef<MapRef>(null)

  // UI state
  const [panelOpen,    setPanelOpen]    = useState(false)
  const [drawMode,     setDrawMode]     = useState<'idle' | 'drawing'>('idle')
  const [saving,       setSaving]       = useState(false)
  const [saveError,    setSaveError]    = useState('')
  const [saveSuccess,  setSaveSuccess]  = useState(false)
  const [cursor,       setCursor]       = useState<string>('grab')

  // Assignment form
  const [formTeamId, setFormTeamId] = useState('')
  const [formDate,   setFormDate]   = useState(todayDate)
  const [formNote,   setFormNote]   = useState('')

  // Drawing state
  const [currentLine,  setCurrentLine]  = useState<[number, number][]>([])
  const [drawnStreets, setDrawnStreets] = useState<GeoJSON.Feature[]>([])

  // Derived GeoJSON
  const mapStyle = resolvedTheme === 'dark'
    ? 'mapbox://styles/mapbox/dark-v11'
    : 'mapbox://styles/mapbox/light-v11'

  const territoriesGeoJSON = useMemo(() => buildTerritoriesGeoJSON(territories), [territories])

  const pastZonesGeoJSON = useMemo(
    () => buildZonesGeoJSON(zones, teamColorMap, z => z.date !== todayDate),
    [zones, teamColorMap, todayDate],
  )

  const todayZonesGeoJSON = useMemo(
    () => buildZonesGeoJSON(zones, teamColorMap, z => z.date === todayDate),
    [zones, teamColorMap, todayDate],
  )

  const drawingGeoJSON = useMemo(
    () => buildDrawingGeoJSON(currentLine, drawnStreets, getColor(teamColorMap, formTeamId)),
    [currentLine, drawnStreets, formTeamId, teamColorMap],
  )

  // Map click handler
  const handleMapClick = useCallback((e: MapMouseEvent) => {
    if (drawMode !== 'drawing') return
    const { lng, lat } = e.lngLat
    setCurrentLine(prev => [...prev, [lng, lat]])
  }, [drawMode])

  // Update cursor
  useEffect(() => {
    setCursor(drawMode === 'drawing' ? 'crosshair' : 'grab')
  }, [drawMode])

  const openPanel = () => {
    setPanelOpen(true)
    setSaveError('')
    setSaveSuccess(false)
    setDrawMode('idle')
    setCurrentLine([])
    setDrawnStreets([])
  }

  const closePanel = () => {
    setPanelOpen(false)
    setDrawMode('idle')
    setCurrentLine([])
    setDrawnStreets([])
    setFormTeamId('')
    setFormNote('')
    setFormDate(todayDate)
    setSaveError('')
  }

  const startDrawing = () => {
    if (!formTeamId) { setSaveError(t('no_team')); return }
    setSaveError('')
    setCurrentLine([])
    setDrawnStreets([])
    setDrawMode('drawing')
  }

  const finishStreet = () => {
    if (currentLine.length < 2) return
    const feature: GeoJSON.Feature = {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: currentLine },
      properties: { color: getColor(teamColorMap, formTeamId) },
    }
    setDrawnStreets(prev => [...prev, feature])
    setCurrentLine([])
  }

  const undoStreet = () => {
    if (currentLine.length > 0) {
      setCurrentLine([])
    } else {
      setDrawnStreets(prev => prev.slice(0, -1))
    }
  }

  const saveZone = async () => {
    if (drawnStreets.length === 0 && currentLine.length < 2) {
      setSaveError(t('no_streets'))
      return
    }
    // Include in-progress line if at least 2 points
    const allStreets = [...drawnStreets]
    if (currentLine.length >= 2) {
      allStreets.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: currentLine },
        properties: { color: getColor(teamColorMap, formTeamId) },
      })
    }

    setSaving(true)
    setSaveError('')
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allStreets }
    const result = await createDailyZone({
      team_id: formTeamId, date: formDate, streets: fc, note: formNote,
    })
    setSaving(false)

    if (result.error) {
      setSaveError(result.error)
    } else {
      setSaveSuccess(true)
      setTimeout(closePanel, 1500)
    }
  }

  // Team labels on territories
  const territoryLabels = useMemo(() => {
    // Find which teams are assigned to which territories
    return territories
      .filter(t => t.coordinates && t.coordinates.length > 0)
      .map(t => ({
        id: t.id,
        name: t.name,
        center: polygonCentroid(t.coordinates!),
      }))
  }, [territories])

  // Today's zone labels (team names on lines)
  const todayZoneLabels = useMemo(() => {
    const labels: { teamName: string; center: [number, number]; color: string }[] = []
    for (const zone of zones.filter(z => z.date === todayDate)) {
      const fc = zone.streets as GeoJSON.FeatureCollection
      if (!fc?.features?.length) continue
      // Use midpoint of first line segment
      const firstLine = fc.features.find(f => f.geometry.type === 'LineString')
      if (!firstLine) continue
      const coords = (firstLine.geometry as GeoJSON.LineString).coordinates
      if (coords.length < 2) continue
      const mid = Math.floor(coords.length / 2)
      labels.push({
        teamName: zone.team_name,
        center:   [coords[mid][0], coords[mid][1]] as [number, number],
        color:    getColor(teamColorMap, zone.team_id),
      })
    }
    return labels
  }, [zones, todayDate, teamColorMap])

  return (
    <div className="relative w-full h-full">

      {/* Map */}
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: MONTREAL[0], latitude: MONTREAL[1], zoom: 12 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyle}
        cursor={cursor}
        onClick={handleMapClick}
      >
        <NavigationControl position="top-right" />

        {/* Territory polygons */}
        <Source id="territories" type="geojson" data={territoriesGeoJSON}>
          <Layer id="territories-fill" type="fill" paint={{
            'fill-color': '#2E3192', 'fill-opacity': 0.12,
          }} />
          <Layer id="territories-line" type="line" paint={{
            'line-color': '#2E3192', 'line-width': 2, 'line-opacity': 0.6,
          }} />
        </Source>

        {/* Territory name labels */}
        {territoryLabels.map(lbl => (
          <Marker key={lbl.id} longitude={lbl.center[0]} latitude={lbl.center[1]} anchor="center">
            <div className="px-2 py-0.5 rounded-full text-[10px] font-bold font-body bg-brand-navy/80 text-white shadow-sm pointer-events-none whitespace-nowrap">
              {lbl.name}
            </div>
          </Marker>
        ))}

        {/* Past zone lines (gray) */}
        <Source id="past-zones" type="geojson" data={pastZonesGeoJSON}>
          <Layer id="past-zones-line" type="line" paint={{
            'line-color': '#94a3b8', 'line-width': 1.5, 'line-opacity': 0.45,
          }} />
        </Source>

        {/* Today's zone lines (team color) */}
        <Source id="today-zones" type="geojson" data={todayZonesGeoJSON}>
          <Layer id="today-zones-line" type="line" paint={{
            'line-color': ['get', 'color'],
            'line-width': 3.5,
            'line-opacity': 0.9,
          }} />
        </Source>

        {/* Today's zone team labels */}
        {todayZoneLabels.map((lbl, i) => (
          <Marker key={i} longitude={lbl.center[0]} latitude={lbl.center[1]} anchor="center">
            <div
              className="px-2 py-0.5 rounded-full text-[10px] font-bold font-body text-white shadow-sm pointer-events-none whitespace-nowrap"
              style={{ backgroundColor: lbl.color }}
            >
              {lbl.teamName}
            </div>
          </Marker>
        ))}

        {/* Currently drawing */}
        {drawMode === 'drawing' && (
          <Source id="drawing" type="geojson" data={drawingGeoJSON}>
            <Layer id="drawing-line" type="line" paint={{
              'line-color': ['coalesce', ['get', 'color'], '#2E3192'],
              'line-width': 3, 'line-opacity': 0.85,
              'line-dasharray': ['literal', [2, 1]],
            }} />
          </Source>
        )}
      </Map>

      {/* Assign Zone button */}
      {!panelOpen && (
        <button
          onClick={openPanel}
          className={cn(
            'absolute top-4 right-4 z-20',
            'flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-navy-md',
            'bg-brand-navy text-white font-body text-sm font-semibold',
            'hover:bg-brand-navy-light active:scale-[0.97]',
            'transition-[background-color,transform] duration-150',
          )}
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
          </svg>
          {t('assign_btn')}
        </button>
      )}

      {/* Legend */}
      <div className={cn(
        'absolute bottom-8 left-4 z-10 p-3 rounded-xl shadow-card',
        'bg-white/90 dark:bg-[#12163a]/90 backdrop-blur-sm',
        'border border-slate-200/80 dark:border-white/[0.08]',
        'text-xs font-body space-y-1.5',
      )}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-2 rounded-full bg-brand-navy/40 border border-brand-navy/60" />
          <span className="text-slate-600 dark:text-white/60">{t('legend_territories')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-[3px] rounded-full" style={{ backgroundColor: TEAM_COLORS[0] }} />
          <span className="text-slate-600 dark:text-white/60">{t('legend_today')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-[2px] rounded-full bg-slate-400/50" />
          <span className="text-slate-600 dark:text-white/60">{t('legend_past')}</span>
        </div>
      </div>

      {/* Assignment Panel (slides from right) */}
      <div className={cn(
        'absolute inset-y-0 right-0 z-30 w-full sm:w-96',
        'bg-white dark:bg-[#12163a]',
        'border-l border-slate-200/80 dark:border-white/[0.08]',
        'shadow-2xl flex flex-col',
        'transition-transform duration-300 ease-out',
        panelOpen ? 'translate-x-0' : 'translate-x-full',
      )}>
        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60 dark:border-white/[0.07]">
          <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">
            {t('panel_title')}
          </h2>
          <button onClick={closePanel} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors">
            <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Panel content */}
        <div className="flex-1 overflow-y-auto px-5 py-5 space-y-4">

          {/* Success */}
          {saveSuccess && (
            <div className="rounded-xl px-4 py-3 bg-brand-teal/10 border border-brand-teal/30 text-brand-teal font-body text-sm font-semibold flex items-center gap-2">
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
              </svg>
              {t('zone_saved')}
            </div>
          )}

          {/* Error */}
          {saveError && (
            <div className="rounded-xl px-4 py-3 bg-brand-red/10 border border-brand-red/30 text-brand-red font-body text-sm">
              {saveError}
            </div>
          )}

          {/* Form fields */}
          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {t('team')} <span className="text-brand-red">*</span>
            </label>
            <select
              value={formTeamId}
              onChange={e => setFormTeamId(e.target.value)}
              disabled={drawMode === 'drawing'}
              className={inputCls}
            >
              <option value="">{t('team_placeholder')}</option>
              {teams.map(team => (
                <option key={team.id} value={team.id}>{team.name}</option>
              ))}
            </select>
            {/* Color swatch for selected team */}
            {formTeamId && (
              <div className="flex items-center gap-2 mt-2">
                <div
                  className="w-4 h-4 rounded-full border-2 border-white shadow-sm"
                  style={{ backgroundColor: getColor(teamColorMap, formTeamId) }}
                />
                <span className="font-body text-xs text-slate-500 dark:text-white/50">
                  {teams.find(t => t.id === formTeamId)?.name}
                </span>
              </div>
            )}
          </div>

          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {t('date')} <span className="text-brand-red">*</span>
            </label>
            <input
              type="date"
              value={formDate}
              onChange={e => setFormDate(e.target.value)}
              disabled={drawMode === 'drawing'}
              className={inputCls}
            />
          </div>

          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {t('note')}
            </label>
            <textarea
              rows={3}
              value={formNote}
              onChange={e => setFormNote(e.target.value)}
              placeholder={t('note_placeholder')}
              className={cn(inputCls, 'resize-none')}
            />
          </div>

          {/* Drawing hint */}
          {drawMode === 'drawing' && (
            <div className="rounded-xl px-4 py-3 bg-brand-teal/10 border border-brand-teal/25 font-body text-sm text-brand-teal flex items-start gap-2">
              <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
              </svg>
              <span>{t('drawing_hint')}</span>
            </div>
          )}

          {/* Streets drawn count */}
          {(drawnStreets.length > 0 || currentLine.length > 0) && (
            <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/[0.06]">
              <svg className="w-4 h-4 text-brand-navy dark:text-brand-teal" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
              </svg>
              <span className="font-body text-sm text-slate-600 dark:text-white/60">
                {drawnStreets.length} rue(s) + {currentLine.length > 0 ? '1 en cours' : ''}
              </span>
            </div>
          )}
        </div>

        {/* Panel footer */}
        <div className="px-5 py-4 border-t border-slate-200/60 dark:border-white/[0.07] space-y-2">
          {drawMode === 'idle' ? (
            <>
              <button onClick={startDrawing} className={btnPrimary}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                </svg>
                {t('start_drawing')}
              </button>
              <button onClick={closePanel} className={btnGhost}>{t('cancel')}</button>
            </>
          ) : (
            <>
              <button onClick={finishStreet} disabled={currentLine.length < 2} className={btnPrimary}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {t('finish_street')}
              </button>
              <div className="grid grid-cols-2 gap-2">
                <button onClick={undoStreet} className={btnGhost}>{t('undo_street')}</button>
                <button
                  onClick={saveZone}
                  disabled={saving || (drawnStreets.length === 0 && currentLine.length < 2)}
                  className={cn(btnSave, 'col-span-1')}
                >
                  {saving ? '...' : t('finish')}
                </button>
              </div>
            </>
          )}
        </div>
      </div>

    </div>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────
const inputCls = cn(
  'w-full rounded-xl px-4 py-3 font-body text-sm',
  'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
  'transition-[border-color,box-shadow] duration-200 disabled:opacity-60',
)
const btnPrimary = cn(
  'w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-brand-navy text-white font-body text-sm font-semibold',
  'hover:bg-brand-navy-light active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-[background-color,transform,opacity] duration-150',
)
const btnSave = cn(
  'w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-brand-teal text-white font-body text-sm font-semibold',
  'hover:bg-brand-teal-dark active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-[background-color,transform,opacity] duration-150',
)
const btnGhost = cn(
  'w-full flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-transparent font-body text-sm font-semibold',
  'border border-slate-200 text-slate-700',
  'dark:border-white/[0.12] dark:text-white/70',
  'hover:bg-slate-100 dark:hover:bg-white/[0.06]',
  'active:scale-[0.98] transition-[background-color,transform] duration-150',
)
