'use client'

import {
  useRef, useState, useCallback, useEffect, useMemo, useTransition,
} from 'react'
import Map, {
  Source, Layer, Marker, NavigationControl, type MapRef, type MapMouseEvent,
} from 'react-map-gl/mapbox'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { MapStyleSelector, useMapStyle } from '@/components/ui/MapStyleSelector'
import { submitEOD } from '@/lib/supabase/eod-actions'
import type { TerritoryRow } from '@/types'
import type { DailyZoneRow } from '@/lib/supabase/zone-actions'
import type { EODEntry } from '@/lib/supabase/eod-actions'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
const MONTREAL: [number, number] = [-73.5673, 45.5017]

// Haversine line length in km
function lineLength(coords: number[][]): number {
  let total = 0
  for (let i = 0; i < coords.length - 1; i++) {
    const [lng1, lat1] = coords[i], [lng2, lat2] = coords[i + 1]
    const R = 6371, dLat = (lat2 - lat1) * Math.PI / 180, dLng = (lng2 - lng1) * Math.PI / 180
    const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2
    total += R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
  }
  return total
}

function computeProgress(
  coveredFeatures: GeoJSON.Feature[],
  assignedFeatures: GeoJSON.Feature[],
): number {
  const assignedLen = assignedFeatures.reduce((s, f) => {
    if (f.geometry.type !== 'LineString') return s
    return s + lineLength((f.geometry as GeoJSON.LineString).coordinates)
  }, 0)
  if (assignedLen === 0) return 0
  const coveredLen = coveredFeatures.reduce((s, f) => {
    if (f.geometry.type !== 'LineString') return s
    return s + lineLength((f.geometry as GeoJSON.LineString).coordinates)
  }, 0)
  return Math.min(100, Math.round((coveredLen / assignedLen) * 100))
}

function polygonCentroid(coords: number[][][]): [number, number] {
  const ring = coords[0] ?? []
  if (ring.length === 0) return MONTREAL
  return [
    ring.reduce((s, c) => s + c[0], 0) / ring.length,
    ring.reduce((s, c) => s + c[1], 0) / ring.length,
  ]
}

function formatDate(d: string) {
  return new Date(d + 'T00:00:00').toLocaleDateString('fr-CA', { weekday: 'short', month: 'short', day: 'numeric' })
}

type SpeechRecognitionType = {
  lang: string
  continuous: boolean
  interimResults: boolean
  start: () => void
  stop: () => void
  onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}

interface SupervisorDashboardProps {
  teamId:        string
  teamName:      string
  territory:     TerritoryRow | null
  todayZone:     DailyZoneRow | null
  todayEOD:      EODEntry | null
  eodHistory:    EODEntry[]
  pastStreets:   GeoJSON.FeatureCollection
  todayDate:     string
}

export default function SupervisorDashboard({
  teamId, teamName, territory, todayZone, todayEOD: initialEOD,
  eodHistory, pastStreets, todayDate,
}: SupervisorDashboardProps) {
  const { resolvedTheme } = useTheme()
  const t   = useTranslations('supervisor')
  const mapRef = useRef<MapRef>(null)
  const [isPending, startTransition] = useTransition()

  // ── Map state ──────────────────────────────────────────────────────────────
  const [drawMode,     setDrawMode]     = useState<'idle' | 'drawing'>('idle')
  const [currentLine,  setCurrentLine]  = useState<[number, number][]>([])
  const [coveredStreets, setCoveredStreets] = useState<GeoJSON.Feature[]>([])
  const [cursor,       setCursor]       = useState('grab')

  // ── AI assistant state ─────────────────────────────────────────────────────
  const [aiInput,      setAiInput]      = useState('')
  const [aiPending,    setAiPending]    = useState(false)
  const [aiPreview,    setAiPreview]    = useState<GeoJSON.Feature[] | null>(null)
  const [aiError,      setAiError]      = useState('')

  // ── Voice state ────────────────────────────────────────────────────────────
  const [isRecording,  setIsRecording]  = useState(false)
  const recognitionRef = useRef<SpeechRecognitionType | null>(null)

  // ── EOD form state ─────────────────────────────────────────────────────────
  const [submittedEOD, setSubmittedEOD] = useState<EODEntry | null>(initialEOD)
  const [pph,          setPph]          = useState('')
  const [canvasHours,  setCanvasHours]  = useState('')
  const [pacAmount,    setPacAmount]    = useState('')
  const [pacCount,     setPacCount]     = useState('')
  const [recalls,      setRecalls]      = useState('')
  const [fieldNote,    setFieldNote]    = useState('')
  const [formError,    setFormError]    = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // ── History expand ─────────────────────────────────────────────────────────
  const [expandedEOD, setExpandedEOD]  = useState<string | null>(null)

  const [mapStyleUrl, setMapStyle] = useMapStyle(resolvedTheme)

  // Map center — use territory centroid or Montreal
  const mapCenter = useMemo((): [number, number] => {
    if (territory?.coordinates?.length) return polygonCentroid(territory.coordinates)
    return MONTREAL
  }, [territory])

  // Territory GeoJSON
  const territoryGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!territory?.coordinates?.length) return { type: 'FeatureCollection', features: [] }
    return {
      type: 'FeatureCollection',
      features: [{
        type: 'Feature',
        geometry: { type: 'Polygon', coordinates: territory.coordinates },
        properties: { name: territory.name },
      }],
    }
  }, [territory])

  // Today zone GeoJSON
  const todayZoneGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    if (!todayZone?.streets) return { type: 'FeatureCollection', features: [] }
    return todayZone.streets as GeoJSON.FeatureCollection
  }, [todayZone])

  // Covered streets GeoJSON (session)
  const coveredGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const features = [...coveredStreets]
    if (currentLine.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: currentLine }, properties: {} })
    }
    if (aiPreview) features.push(...aiPreview)
    return { type: 'FeatureCollection', features }
  }, [coveredStreets, currentLine, aiPreview])

  // Progress
  const progress = useMemo(() => {
    const assignedFeatures = (todayZoneGeoJSON.features ?? [])
    const all = [...coveredStreets, ...(submittedEOD?.covered_streets as GeoJSON.FeatureCollection | null)?.features ?? []]
    return computeProgress(all, assignedFeatures)
  }, [coveredStreets, submittedEOD, todayZoneGeoJSON])

  // Auto-calculated PAC average
  const pacAverage = useMemo(() => {
    const amt = parseFloat(pacAmount)
    const cnt = parseInt(pacCount)
    if (!isNaN(amt) && !isNaN(cnt) && cnt > 0) return (amt / cnt).toFixed(2)
    return ''
  }, [pacAmount, pacCount])

  // ── Map handlers ───────────────────────────────────────────────────────────
  const handleMapClick = useCallback((e: MapMouseEvent) => {
    if (drawMode !== 'drawing') return
    const { lng, lat } = e.lngLat
    setCurrentLine(prev => [...prev, [lng, lat]])
  }, [drawMode])

  useEffect(() => {
    setCursor(drawMode === 'drawing' ? 'crosshair' : 'grab')
  }, [drawMode])

  const finishStreet = () => {
    if (currentLine.length < 2) return
    setCoveredStreets(prev => [...prev, {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: currentLine },
      properties: {},
    }])
    setCurrentLine([])
  }

  const undoStreet = () => {
    if (currentLine.length > 0) setCurrentLine([])
    else setCoveredStreets(prev => prev.slice(0, -1))
  }

  // ── AI assistant ───────────────────────────────────────────────────────────
  const handleAIDraw = async () => {
    if (!aiInput.trim()) return
    setAiPending(true)
    setAiError('')
    setAiPreview(null)

    const center = mapCenter
    const segments = aiInput.split(',').map(s => s.trim()).filter(Boolean)
    const features: GeoJSON.Feature[] = []

    for (const segment of segments) {
      try {
        const query = encodeURIComponent(segment + ', Montréal, Québec')
        const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${query}.json?access_token=${MAPBOX_TOKEN}&proximity=${center[0]},${center[1]}&country=ca&language=fr&types=address,street`
        const res = await fetch(url)
        const data = await res.json()
        const feature = data.features?.[0]
        if (feature?.geometry) {
          if (feature.geometry.type === 'LineString') {
            features.push({ type: 'Feature', geometry: feature.geometry, properties: { ai: true } })
          } else if (feature.geometry.type === 'Point') {
            // Point — create a short line at that location (approximate)
            const [lng, lat] = feature.geometry.coordinates
            features.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [[lng - 0.001, lat], [lng + 0.001, lat]] },
              properties: { ai: true, name: segment },
            })
          }
        }
      } catch {
        // skip failed segment
      }
    }

    setAiPending(false)
    if (features.length === 0) {
      setAiError(t('map.ai_no_results'))
    } else {
      setAiPreview(features)
      // Fit map to preview
      if (mapRef.current && features.length > 0) {
        const allCoords = features.flatMap(f => {
          if (f.geometry.type === 'LineString') return (f.geometry as GeoJSON.LineString).coordinates
          return []
        })
        if (allCoords.length >= 2) {
          const lngs = allCoords.map(c => c[0])
          const lats = allCoords.map(c => c[1])
          mapRef.current.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 80, duration: 800 }
          )
        }
      }
    }
  }

  const confirmAIStreets = () => {
    if (!aiPreview) return
    setCoveredStreets(prev => [...prev, ...aiPreview])
    setAiPreview(null)
    setAiInput('')
  }

  const retryAI = () => {
    setAiPreview(null)
    setAiError('')
  }

  // ── Voice input ────────────────────────────────────────────────────────────
  const toggleVoice = () => {
    if (typeof window === 'undefined') return
    const SpeechRecognition = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionType; webkitSpeechRecognition?: new () => SpeechRecognitionType }).SpeechRecognition
      || (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionType }).webkitSpeechRecognition
    if (!SpeechRecognition) return

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const recognition = new SpeechRecognition()
    recognition.lang = 'fr-CA'
    recognition.continuous = false
    recognition.interimResults = false
    recognition.onresult = (e) => {
      const transcript = e.results[0][0].transcript
      setAiInput(prev => prev ? prev + ', ' + transcript : transcript)
    }
    recognition.onerror = () => setIsRecording(false)
    recognition.onend   = () => setIsRecording(false)
    recognitionRef.current = recognition
    recognition.start()
    setIsRecording(true)
  }

  // ── EOD submit ─────────────────────────────────────────────────────────────
  const handleSubmitEOD = () => {
    setFormError('')

    if (!pph || !canvasHours || !pacAmount) {
      setFormError(t('eod.error_required'))
      return
    }
    if (coveredStreets.length === 0 && currentLine.length < 2) {
      setFormError(t('eod.error_streets'))
      return
    }

    // Include in-progress line
    const allStreets = [...coveredStreets]
    if (currentLine.length >= 2) {
      allStreets.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: currentLine }, properties: {} })
    }
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allStreets }

    startTransition(async () => {
      const result = await submitEOD({
        team_id:          teamId,
        entry_date:       todayDate,
        pph:              parseFloat(pph),
        canvas_hours:     parseFloat(canvasHours),
        pac_total_amount: parseFloat(pacAmount),
        pac_count:        parseInt(pacCount) || 0,
        pac_average:      parseFloat(pacAverage) || 0,
        recalls_count:    parseInt(recalls) || 0,
        note:             fieldNote,
        covered_streets:  fc,
      })

      if (result.error) {
        setFormError(result.error)
      } else {
        setSubmitSuccess(true)
        setSubmittedEOD({
          id: result.id!,
          assignment_id: null,
          team_id: teamId,
          entry_date: todayDate,
          pph: parseFloat(pph),
          canvas_hours: parseFloat(canvasHours),
          pac_total_amount: parseFloat(pacAmount),
          pac_count: parseInt(pacCount) || 0,
          pac_average: parseFloat(pacAverage) || 0,
          recalls_count: parseInt(recalls) || 0,
          note: fieldNote || null,
          covered_streets: fc as unknown as GeoJSON.FeatureCollection,
          created_at: new Date().toISOString(),
        })
        setCoveredStreets([])
        setCurrentLine([])
      }
    })
  }

  return (
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-8">

      {/* ── SECTION 1: MAP ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white">
            {t('map.title')} — <span className="text-brand-teal">{teamName}</span>
          </h2>
          {todayZone && (
            <div className="text-right">
              <div className="font-body text-xs text-slate-500 dark:text-white/40 mb-1">{t('map.progress')}</div>
              <div className="flex items-center gap-2">
                <div className="w-24 h-2 rounded-full bg-slate-200 dark:bg-white/10 overflow-hidden">
                  <div
                    className="h-full rounded-full bg-brand-teal transition-all duration-500"
                    style={{ width: `${progress}%` }}
                  />
                </div>
                <span className="font-body text-xs font-semibold text-brand-teal">{progress}%</span>
              </div>
            </div>
          )}
        </div>

        {/* No zone message */}
        {!todayZone && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10 p-5 mb-4 font-body text-sm text-amber-700 dark:text-amber-400">
            {t('map.no_zone')}
          </div>
        )}

        {/* Zone note */}
        {todayZone?.note && (
          <div className="rounded-xl border border-brand-navy/20 bg-brand-navy/5 dark:bg-brand-navy/20 px-4 py-3 mb-3 font-body text-sm text-brand-navy dark:text-white/80">
            <span className="font-semibold">{t('map.today_note')} </span>{todayZone.note}
          </div>
        )}

        {/* Map container */}
        <div className="relative rounded-2xl overflow-hidden border border-slate-200/80 dark:border-white/[0.07] shadow-card" style={{ height: 380 }}>
          <Map
            ref={mapRef}
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{ longitude: mapCenter[0], latitude: mapCenter[1], zoom: 13 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={mapStyleUrl}
            cursor={cursor}
            onClick={handleMapClick}
          >
            <NavigationControl position="top-right" />

            {/* Territory polygon */}
            <Source id="territory" type="geojson" data={territoryGeoJSON}>
              <Layer id="territory-fill" type="fill" paint={{ 'fill-color': '#2E3192', 'fill-opacity': 0.08 }} />
              <Layer id="territory-line" type="line" paint={{ 'line-color': '#2E3192', 'line-width': 1.5, 'line-opacity': 0.5 }} />
            </Source>

            {/* Past covered streets (gray) */}
            <Source id="past-streets" type="geojson" data={pastStreets}>
              <Layer id="past-streets-line" type="line" paint={{ 'line-color': '#94a3b8', 'line-width': 2, 'line-opacity': 0.4 }} />
            </Source>

            {/* Today assigned zone (teal) */}
            <Source id="today-zone" type="geojson" data={todayZoneGeoJSON}>
              <Layer id="today-zone-line" type="line" paint={{ 'line-color': '#00B5A3', 'line-width': 4, 'line-opacity': 0.85 }} />
            </Source>

            {/* Covered today (red) */}
            <Source id="covered" type="geojson" data={coveredGeoJSON}>
              <Layer id="covered-line" type="line" paint={{ 'line-color': '#E8174B', 'line-width': 3.5, 'line-opacity': 0.9 }} />
            </Source>
          </Map>

          {/* Map style selector (inside map container) */}
          <MapStyleSelector
            activeUrl={mapStyleUrl}
            onSelect={setMapStyle}
            className="bottom-3 right-3"
          />
        </div>

        {/* Legend */}
        <div className="flex flex-wrap items-center gap-4 mt-3 px-1">
          {[
            { color: '#2E3192', opacity: '40', label: t('map.legend_territory') },
            { color: '#00B5A3', opacity: '100', label: t('map.legend_zone') },
            { color: '#E8174B', opacity: '100', label: t('map.legend_today') },
            { color: '#94a3b8', opacity: '60', label: t('map.legend_past') },
          ].map(({ color, label }) => (
            <div key={label} className="flex items-center gap-1.5">
              <div className="w-5 h-[3px] rounded-full" style={{ backgroundColor: color }} />
              <span className="font-body text-xs text-slate-500 dark:text-white/40">{label}</span>
            </div>
          ))}
        </div>

        {/* Drawing controls */}
        {!submittedEOD && (
          <div className="mt-4 space-y-3">
            <p className="font-body text-xs text-slate-500 dark:text-white/40 font-semibold uppercase tracking-wide">
              {t('map.draw_hint')}
            </p>
            <div className="flex flex-wrap gap-2">
              {drawMode === 'idle' ? (
                <button
                  onClick={() => setDrawMode('drawing')}
                  className={cn(btnPrimary, 'flex-1 sm:flex-none min-h-[48px]')}
                >
                  <IconPencil />
                  {t('map.draw_hint')}
                </button>
              ) : (
                <>
                  <button
                    onClick={finishStreet}
                    disabled={currentLine.length < 2}
                    className={cn(btnPrimary, 'flex-1 min-h-[48px]')}
                  >
                    <IconCheck />
                    {t('map.finish_street')}
                  </button>
                  <button onClick={undoStreet} className={cn(btnGhost, 'flex-1 min-h-[48px]')}>
                    {t('map.undo_street')}
                  </button>
                  <button onClick={() => { setDrawMode('idle'); setCurrentLine([]) }} className={cn(btnGhost, 'min-h-[48px] px-3')}>
                    ✕
                  </button>
                </>
              )}
            </div>

            {/* AI Assistant */}
            <div className={cn(
              'rounded-2xl border p-4 space-y-3',
              'bg-slate-50 border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.07]',
            )}>
              <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">
                {t('map.ai_title')}
              </p>
              <div className="flex gap-2">
                <input
                  type="text"
                  value={aiInput}
                  onChange={e => setAiInput(e.target.value)}
                  onKeyDown={e => e.key === 'Enter' && handleAIDraw()}
                  placeholder={t('map.ai_placeholder')}
                  className={cn(inputCls, 'flex-1')}
                />
                {/* Mic button */}
                <button
                  onClick={toggleVoice}
                  aria-label={t('map.mic_label')}
                  className={cn(
                    'w-10 h-10 rounded-xl flex items-center justify-center shrink-0',
                    isRecording
                      ? 'bg-brand-red text-white animate-pulse'
                      : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60',
                    'transition-colors duration-150',
                  )}
                >
                  <IconMic />
                </button>
              </div>

              {aiError && (
                <p className="font-body text-xs text-brand-red">{aiError}</p>
              )}

              {aiPreview ? (
                <div className="flex gap-2">
                  <button onClick={confirmAIStreets} className={cn(btnSave, 'flex-1')}>
                    {t('map.ai_confirm')} ({aiPreview.length})
                  </button>
                  <button onClick={retryAI} className={cn(btnGhost, 'flex-1')}>
                    {t('map.ai_retry')}
                  </button>
                </div>
              ) : (
                <button
                  onClick={handleAIDraw}
                  disabled={aiPending || !aiInput.trim()}
                  className={cn(btnGhost, 'w-full')}
                >
                  {aiPending ? t('map.ai_drawing') : t('map.ai_draw')}
                </button>
              )}
            </div>

            {coveredStreets.length > 0 && (
              <p className="font-body text-xs text-slate-500 dark:text-white/40">
                {coveredStreets.length} {t('history.streets_drawn')}
              </p>
            )}
          </div>
        )}
      </section>

      {/* ── SECTION 2: EOD FORM ────────────────────────────────────────────── */}
      <section>
        <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white mb-4">
          {t('eod.title')}
        </h2>

        {submittedEOD ? (
          /* Already submitted */
          <div className={cn(
            'rounded-2xl border border-brand-teal/30 bg-brand-teal/10 p-6 space-y-4',
          )}>
            <div className="flex items-center gap-3">
              <div className="w-10 h-10 rounded-full bg-brand-teal flex items-center justify-center text-white">
                <IconCheck />
              </div>
              <div>
                <p className="font-display font-bold text-brand-teal">{t('eod.submitted_title')}</p>
                <p className="font-body text-sm text-slate-600 dark:text-white/60">{t('eod.submitted_desc')}</p>
              </div>
            </div>
            <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
              {[
                { label: 'PPH', value: submittedEOD.pph.toFixed(2) },
                { label: t('eod.canvas_hours'), value: `${submittedEOD.canvas_hours ?? 0}h` },
                { label: 'PAC $', value: `$${submittedEOD.pac_total_amount}` },
                { label: t('eod.recalls'), value: String(submittedEOD.recalls_count) },
              ].map(({ label, value }) => (
                <div key={label} className="rounded-xl bg-white/50 dark:bg-white/[0.05] p-3">
                  <p className="font-body text-[10px] text-slate-500 dark:text-white/40 uppercase tracking-wide">{label}</p>
                  <p className="font-display text-lg font-bold text-brand-navy dark:text-white">{value}</p>
                </div>
              ))}
            </div>
            {submittedEOD.note && (
              <p className="font-body text-sm text-slate-600 dark:text-white/60 italic">"{submittedEOD.note}"</p>
            )}
          </div>
        ) : (
          /* EOD Form */
          <form onSubmit={e => { e.preventDefault(); handleSubmitEOD() }} className="space-y-5">
            {formError && (
              <div className="rounded-xl px-4 py-3 bg-brand-red/10 border border-brand-red/30 text-brand-red font-body text-sm">
                {formError}
              </div>
            )}

            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <Field label={t('eod.pph')} required>
                <input
                  type="number" min="0" step="0.01" value={pph}
                  onChange={e => setPph(e.target.value)}
                  placeholder="0.00" className={inputCls}
                />
              </Field>

              <Field label={t('eod.canvas_hours')} required>
                <input
                  type="number" min="0" step="0.5" value={canvasHours}
                  onChange={e => setCanvasHours(e.target.value)}
                  placeholder="0.0" className={inputCls}
                />
              </Field>

              <Field label={t('eod.pac_amount')} required>
                <input
                  type="number" min="0" step="0.01" value={pacAmount}
                  onChange={e => setPacAmount(e.target.value)}
                  placeholder="0.00" className={inputCls}
                />
              </Field>

              <Field label={t('eod.pac_count')}>
                <input
                  type="number" min="0" step="1" value={pacCount}
                  onChange={e => setPacCount(e.target.value)}
                  placeholder="0" className={inputCls}
                />
              </Field>

              <Field label={t('eod.pac_average')}>
                <input
                  type="text" value={pacAverage ? `$${pacAverage}` : ''}
                  readOnly placeholder="Calculé automatiquement"
                  className={cn(inputCls, 'bg-slate-100/80 dark:bg-white/[0.04] text-slate-500 dark:text-white/40 cursor-default')}
                />
              </Field>

              <Field label={t('eod.recalls')}>
                <input
                  type="number" min="0" step="1" value={recalls}
                  onChange={e => setRecalls(e.target.value)}
                  placeholder="0" className={inputCls}
                />
              </Field>
            </div>

            <Field label={t('eod.note')}>
              <textarea
                rows={3} value={fieldNote}
                onChange={e => setFieldNote(e.target.value.slice(0, 500))}
                placeholder={t('eod.note_placeholder')}
                className={cn(inputCls, 'resize-none')}
              />
              <p className="font-body text-[10px] text-slate-400 dark:text-white/30 text-right mt-1">
                {fieldNote.length}/500
              </p>
            </Field>

            <button
              type="submit"
              disabled={isPending}
              className={cn(btnSave, 'w-full min-h-[52px] text-base')}
            >
              {isPending ? t('eod.submitting') : t('eod.submit')}
            </button>
          </form>
        )}
      </section>

      {/* ── SECTION 3: EOD HISTORY ─────────────────────────────────────────── */}
      <section className="pb-12">
        <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white mb-4">
          {t('history.title')}
        </h2>

        {eodHistory.length === 0 ? (
          <p className="font-body text-sm text-slate-500 dark:text-white/40">{t('history.empty')}</p>
        ) : (
          <div className="space-y-2">
            {eodHistory.map(entry => {
              const isExpanded = expandedEOD === entry.id
              const fc = entry.covered_streets as unknown as GeoJSON.FeatureCollection | null
              const streetCount = fc?.features?.length ?? 0
              return (
                <div
                  key={entry.id}
                  className={cn(
                    'rounded-2xl border overflow-hidden transition-all duration-200',
                    'border-slate-200/80 dark:border-white/[0.07]',
                    'bg-white dark:bg-white/[0.02]',
                  )}
                >
                  {/* Row */}
                  <button
                    onClick={() => setExpandedEOD(isExpanded ? null : entry.id)}
                    className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                  >
                    <div className="flex items-center gap-4">
                      <span className="font-body text-sm font-semibold text-brand-navy dark:text-white whitespace-nowrap">
                        {entry.entry_date ? formatDate(entry.entry_date) : '—'}
                      </span>
                      <span className="font-body text-sm text-brand-teal font-bold">
                        PPH {entry.pph?.toFixed(2)}
                      </span>
                      <span className="hidden sm:block font-body text-sm text-slate-500 dark:text-white/40">
                        {entry.canvas_hours != null ? `${entry.canvas_hours}h` : ''}
                      </span>
                      <span className="hidden sm:block font-body text-sm text-slate-600 dark:text-white/60">
                        {entry.pac_total_amount ? `$${entry.pac_total_amount}` : ''}
                      </span>
                    </div>
                    <svg
                      className={cn('w-4 h-4 text-slate-400 transition-transform duration-200', isExpanded && 'rotate-180')}
                      fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"
                    >
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 9l-7 7-7-7" />
                    </svg>
                  </button>

                  {/* Expanded content */}
                  {isExpanded && (
                    <div className="px-5 pb-5 pt-2 border-t border-slate-100 dark:border-white/[0.04] space-y-3">
                      <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                        {[
                          { label: 'PPH', value: entry.pph?.toFixed(2) ?? '—' },
                          { label: t('history.col_hours'), value: entry.canvas_hours != null ? `${entry.canvas_hours}h` : '—' },
                          { label: t('history.col_pac'), value: entry.pac_total_amount ? `$${entry.pac_total_amount}` : '—' },
                          { label: 'PACs', value: String(entry.pac_count || '—') },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3">
                            <p className="font-body text-[10px] text-slate-500 dark:text-white/40 uppercase tracking-wide">{label}</p>
                            <p className="font-display text-base font-bold text-brand-navy dark:text-white">{value}</p>
                          </div>
                        ))}
                      </div>
                      {entry.note && (
                        <p className="font-body text-sm text-slate-600 dark:text-white/60 italic">"{entry.note}"</p>
                      )}
                      {streetCount > 0 && (
                        <p className="font-body text-xs text-slate-400 dark:text-white/30">
                          {streetCount} {t('history.streets_drawn')}
                        </p>
                      )}
                    </div>
                  )}
                </div>
              )
            })}
          </div>
        )}
      </section>

    </div>
  )
}

// ── Form field wrapper ─────────────────────────────────────────────────────────
function Field({ label, required, children }: { label: string; required?: boolean; children: React.ReactNode }) {
  return (
    <div>
      <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
        {label} {required && <span className="text-brand-red">*</span>}
      </label>
      {children}
    </div>
  )
}

// ── Icons ──────────────────────────────────────────────────────────────────────
function IconCheck() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
    </svg>
  )
}
function IconPencil() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
    </svg>
  )
}
function IconMic() {
  return (
    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
    </svg>
  )
}

// ── Shared styles ──────────────────────────────────────────────────────────────
const inputCls = cn(
  'w-full rounded-xl px-4 py-3 font-body text-sm',
  'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
  'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
  'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
  'transition-[border-color,box-shadow] duration-200',
)
const btnPrimary = cn(
  'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-brand-navy text-white font-body text-sm font-semibold',
  'hover:bg-brand-navy-light active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-[background-color,transform,opacity] duration-150',
)
const btnSave = cn(
  'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-brand-teal text-white font-body text-sm font-semibold',
  'hover:bg-brand-teal-dark active:scale-[0.98] disabled:opacity-50 disabled:cursor-not-allowed',
  'transition-[background-color,transform,opacity] duration-150',
)
const btnGhost = cn(
  'flex items-center justify-center gap-2 px-5 py-2.5 rounded-xl',
  'bg-transparent font-body text-sm font-semibold',
  'border border-slate-200 text-slate-700',
  'dark:border-white/[0.12] dark:text-white/70',
  'hover:bg-slate-100 dark:hover:bg-white/[0.06]',
  'active:scale-[0.98] transition-[background-color,transform] duration-150',
)
