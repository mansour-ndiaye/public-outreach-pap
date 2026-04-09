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
import { AvatarDisplay } from '@/components/ui/AvatarButton'
import { createClient } from '@/lib/supabase/client'
import { submitEOD, fetchPPHLeaderboard } from '@/lib/supabase/eod-actions'
import type { TerritoryRow } from '@/types'
import type { DailyZoneWithTeam } from '@/lib/supabase/zone-actions'
import type { EODEntry, RecallEntry, LeaderboardEntry } from '@/lib/supabase/eod-actions'

const TEAM_COLOR_FALLBACK = '#E8174B'

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
  teamId:           string
  teamName:         string
  supervisorId:     string
  supervisorName:   string
  territory:        TerritoryRow | null
  todayZones:       DailyZoneWithTeam[]     // zones assigned to THIS supervisor today
  teamZones:        DailyZoneWithTeam[]     // all zones for the team today (incl. others)
  todayEOD:         EODEntry | null
  eodHistory:       EODEntry[]
  pastStreets:      GeoJSON.FeatureCollection  // own past terrain barré
  teamPastStreets:  GeoJSON.FeatureCollection  // other supervisors' terrain barré
  todayDate:        string
  teamColor?:       string
  locale?:          string
}

export default function SupervisorDashboard({
  teamId, teamName, supervisorId, supervisorName,
  territory, todayZones, teamZones,
  todayEOD: initialEOD, eodHistory, pastStreets, teamPastStreets,
  todayDate, teamColor, locale,
}: SupervisorDashboardProps) {
  const { resolvedTheme } = useTheme()
  const t   = useTranslations('supervisor')
  const mapRef = useRef<MapRef>(null)
  const [isPending, startTransition] = useTransition()

  // ── Touch device detection ─────────────────────────────────────────────────
  const [isTouch, setIsTouch] = useState(false)
  useEffect(() => {
    setIsTouch(window.matchMedia('(pointer: coarse)').matches)
  }, [])

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
  const [canvasHours,  setCanvasHours]  = useState('')
  const [pacAmount,    setPacAmount]    = useState('')
  const [pacCount,     setPacCount]     = useState('')
  const [recalls,      setRecalls]      = useState<RecallEntry[]>([])
  const [pfu,          setPfu]          = useState('')
  const [fieldNote,    setFieldNote]    = useState('')
  const [formError,    setFormError]    = useState('')
  const [submitSuccess, setSubmitSuccess] = useState(false)

  // ── Team toggle panel ──────────────────────────────────────────────────────
  const [showTeamPanel,    setShowTeamPanel]    = useState(false)
  const [hiddenSupervisors, setHiddenSupervisors] = useState<Set<string>>(new Set())

  // ── Tab navigation ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ranking'>('dashboard')

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

  // Today zones GeoJSON — all zones assigned to this supervisor (teal, combined)
  const todayZoneGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const allFeatures: GeoJSON.Feature[] = []
    for (const z of todayZones) {
      const fc = z.streets as GeoJSON.FeatureCollection
      if (fc?.features) allFeatures.push(...fc.features)
    }
    return { type: 'FeatureCollection', features: allFeatures }
  }, [todayZones])

  // Other supervisors in the team (for toggle panel, derived from teamZones)
  const otherSupervisors = useMemo(() => {
    const seen: Record<string, string> = {}
    for (const z of teamZones) {
      if (!z.supervisor_id || z.supervisor_id === supervisorId) continue
      if (!(z.supervisor_id in seen)) {
        seen[z.supervisor_id] = z.supervisor_name ?? z.supervisor_id
      }
    }
    return Object.entries(seen).map(([id, name]) => ({ id, name }))
  }, [teamZones, supervisorId])

  // Other supervisors' terrain du jour (filtered by hiddenSupervisors), RED #ef4444
  const otherZonesGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const allFeatures: GeoJSON.Feature[] = []
    for (const z of teamZones) {
      if (z.supervisor_id === supervisorId) continue
      if (hiddenSupervisors.has(z.supervisor_id ?? '')) continue
      const fc = z.streets as GeoJSON.FeatureCollection
      if (fc?.features) {
        for (const f of fc.features) {
          allFeatures.push({
            ...f,
            properties: { ...f.properties, zone_id: z.id, supervisor_name: z.supervisor_name },
          })
        }
      }
    }
    return { type: 'FeatureCollection', features: allFeatures }
  }, [teamZones, supervisorId, hiddenSupervisors])

  // Other supervisors' terrain barré (past covered streets, filtered by hiddenSupervisors)
  const filteredTeamPastStreets = useMemo((): GeoJSON.FeatureCollection => {
    if (!teamPastStreets?.features) return { type: 'FeatureCollection', features: [] }
    return {
      type: 'FeatureCollection',
      features: teamPastStreets.features.filter(f => {
        const supId = f.properties?.supervisor_id as string | undefined
        return !supId || !hiddenSupervisors.has(supId)
      }),
    }
  }, [teamPastStreets, hiddenSupervisors])

  // Labels for other supervisors' terrain du jour
  const otherZoneLabels = useMemo(() => {
    const labels: { label: string; center: [number, number] }[] = []
    const seen = new Set<string>()
    for (const z of teamZones) {
      if (z.supervisor_id === supervisorId) continue
      if (hiddenSupervisors.has(z.supervisor_id ?? '')) continue
      if (seen.has(z.id)) continue
      seen.add(z.id)
      const fc = z.streets as GeoJSON.FeatureCollection
      const firstLine = fc?.features?.find(f => f.geometry.type === 'LineString')
      if (!firstLine) continue
      const coords = (firstLine.geometry as GeoJSON.LineString).coordinates
      if (coords.length < 2) continue
      const mid = Math.floor(coords.length / 2)
      labels.push({
        label: z.supervisor_name ?? teamName,
        center: [coords[mid][0], coords[mid][1]],
      })
    }
    return labels
  }, [teamZones, supervisorId, teamName, hiddenSupervisors])

  // Centroid for "Votre terrain" label on own terrain du jour
  const myTurfLabelCenter = useMemo((): [number, number] | null => {
    for (const z of todayZones) {
      const fc = z.streets as GeoJSON.FeatureCollection
      const firstLine = fc?.features?.find(f => f.geometry.type === 'LineString')
      if (!firstLine) continue
      const coords = (firstLine.geometry as GeoJSON.LineString).coordinates
      if (coords.length < 2) continue
      const mid = Math.floor(coords.length / 2)
      return [coords[mid][0], coords[mid][1]]
    }
    return null
  }, [todayZones])

  // Covered streets GeoJSON (session)
  const coveredGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const features = [...coveredStreets]
    if (currentLine.length >= 2) {
      features.push({ type: 'Feature', geometry: { type: 'LineString', coordinates: currentLine }, properties: {} })
    }
    if (aiPreview) features.push(...aiPreview)
    return { type: 'FeatureCollection', features }
  }, [coveredStreets, currentLine, aiPreview])

  // Progress — based on ALL zones assigned to this supervisor today
  const progress = useMemo(() => {
    const assignedFeatures = todayZoneGeoJSON.features ?? []
    const all = [...coveredStreets, ...((submittedEOD?.covered_streets as GeoJSON.FeatureCollection | null)?.features ?? [])]
    return computeProgress(all, assignedFeatures)
  }, [coveredStreets, submittedEOD, todayZoneGeoJSON])

  // PPH = PAC total $ / canvas hours (auto-calculated)
  const pph = useMemo(() => {
    const amt = parseFloat(pacAmount)
    const hrs = parseFloat(canvasHours)
    if (isNaN(amt) || isNaN(hrs) || hrs <= 0) return NaN
    return amt / hrs
  }, [pacAmount, canvasHours])

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

    if (!canvasHours || !pacAmount) {
      setFormError(t('eod.error_required'))
      return
    }
    if (todayZones.length > 0 && coveredStreets.length === 0 && currentLine.length < 2) {
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
        supervisor_id:    supervisorId,
        entry_date:       todayDate,
        pph:              isNaN(pph) ? 0 : pph,
        canvas_hours:     parseFloat(canvasHours),
        pac_total_amount: parseFloat(pacAmount),
        pac_count:        parseInt(pacCount) || 0,
        pac_average:      parseFloat(pacAverage) || 0,
        recalls:          recalls,
        pfu:              parseInt(pfu) || 0,
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
          supervisor_id: supervisorId,
          entry_date: todayDate,
          pph: isNaN(pph) ? 0 : pph,
          canvas_hours: parseFloat(canvasHours),
          pac_total_amount: parseFloat(pacAmount),
          pac_count: parseInt(pacCount) || 0,
          pac_average: parseFloat(pacAverage) || 0,
          recalls_count: recalls.length,
          recalls: recalls,
          pfu: parseInt(pfu) || 0,
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
    <div className="max-w-3xl mx-auto px-4 py-6 space-y-6">

      {/* ── Tab navigation ──────────────────────────────────────────────────── */}
      <div className="flex rounded-xl overflow-hidden border border-slate-200 dark:border-white/10 self-start w-fit">
        {([
          { key: 'dashboard', label: t('tabs.dashboard') },
          { key: 'ranking',   label: t('tabs.ranking') },
        ] as { key: 'dashboard' | 'ranking'; label: string }[]).map(tab => (
          <button
            key={tab.key}
            onClick={() => setActiveTab(tab.key)}
            className={cn(
              'px-4 py-2 font-body text-sm font-semibold transition-colors',
              activeTab === tab.key
                ? 'bg-brand-navy text-white'
                : 'text-slate-600 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.05]',
            )}
          >
            {tab.label}
          </button>
        ))}
      </div>

      {/* ── RANKING TAB ─────────────────────────────────────────────────────── */}
      {activeTab === 'ranking' && (
        <PPHLeaderboard supervisorId={supervisorId} locale={locale} />
      )}

      {/* ── DASHBOARD TAB ───────────────────────────────────────────────────── */}
      {activeTab === 'dashboard' && <>

      {/* ── SECTION 1: MAP ─────────────────────────────────────────────────── */}
      <section>
        <div className="flex items-center justify-between mb-3">
          <h2 className="font-display text-lg font-bold text-brand-navy dark:text-white">
            {t('map.title')} — <span className="text-brand-teal">{teamName}</span>
          </h2>
          {todayZones.length > 0 && (
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
        {todayZones.length === 0 && (
          <div className="rounded-2xl border border-amber-200 bg-amber-50 dark:border-amber-800/40 dark:bg-amber-900/10 p-5 mb-4 font-body text-sm text-amber-700 dark:text-amber-400">
            {t('map.no_zone')}
          </div>
        )}

        {/* Zone notes — show notes from all assigned zones */}
        {todayZones.filter(z => z.note).map((z, i) => (
          <div key={z.id} className="rounded-xl border border-brand-navy/20 bg-brand-navy/5 dark:bg-brand-navy/20 px-4 py-3 mb-3 font-body text-sm text-brand-navy dark:text-white/80">
            {todayZones.filter(z2 => z2.note).length > 1 && (
              <span className="font-semibold text-[10px] uppercase tracking-wide text-slate-400 dark:text-white/30 mr-2">Zone {i + 1}</span>
            )}
            <span className="font-semibold">{t('map.today_note')} </span>{z.note}
          </div>
        ))}

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

            {/* Terrain barré — all covered streets in bold black #000000 */}
            <Source id="past-streets" type="geojson" data={pastStreets}>
              <Layer id="past-streets-line" type="line" paint={{ 'line-color': '#000000', 'line-width': 4, 'line-opacity': 0.85 }} />
            </Source>

            {/* Other supervisors' terrain barré — also bold black */}
            <Source id="team-past-streets" type="geojson" data={filteredTeamPastStreets}>
              <Layer id="team-past-streets-line" type="line" paint={{ 'line-color': '#000000', 'line-width': 4, 'line-opacity': 0.85 }} />
            </Source>

            {/* Other supervisors' terrain du jour (red, 60%) */}
            <Source id="other-zones" type="geojson" data={otherZonesGeoJSON}>
              <Layer id="other-zones-line" type="line" paint={{
                'line-color': '#ef4444',
                'line-width': 3, 'line-opacity': 0.6,
              }} />
            </Source>

            {/* Own terrain du jour — assigned to this supervisor (green) */}
            <Source id="today-zone" type="geojson" data={todayZoneGeoJSON}>
              <Layer id="today-zone-line" type="line" paint={{ 'line-color': '#22c55e', 'line-width': 4, 'line-opacity': 1 }} />
            </Source>

            {/* Drawing in progress (orange) */}
            <Source id="covered" type="geojson" data={coveredGeoJSON}>
              <Layer id="covered-line" type="line" paint={{ 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.95 }} />
            </Source>

            {/* "Votre terrain" label on own terrain du jour */}
            {myTurfLabelCenter && (
              <Marker longitude={myTurfLabelCenter[0]} latitude={myTurfLabelCenter[1]} anchor="center">
                <div className="px-2 py-0.5 rounded-full text-[9px] font-bold font-body text-white shadow-sm pointer-events-none whitespace-nowrap" style={{ backgroundColor: '#22c55e' }}>
                  {t('map.your_turf')}
                </div>
              </Marker>
            )}

            {/* Labels for other supervisors' terrain du jour */}
            {otherZoneLabels.map((lbl, i) => (
              <Marker key={i} longitude={lbl.center[0]} latitude={lbl.center[1]} anchor="center">
                <div
                  className="px-2 py-0.5 rounded-full text-[9px] font-bold font-body text-white shadow-sm pointer-events-none whitespace-nowrap opacity-80"
                  style={{ backgroundColor: '#ef4444' }}
                >
                  {lbl.label}
                </div>
              </Marker>
            ))}
          </Map>

          {/* Map style selector (inside map container) */}
          <MapStyleSelector
            activeUrl={mapStyleUrl}
            onSelect={setMapStyle}
          />
        </div>

        {/* Legend + Team Toggle */}
        <div className="flex items-start justify-between gap-2 mt-3 px-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {[
              { color: '#2E3192', label: t('map.legend_territory') },
              { color: '#22c55e', label: t('map.legend_assigned_own') },
              { color: '#ef4444', label: t('map.legend_assigned_others') },
              { color: '#000000', label: t('map.legend_barre') },
            ].map(({ color, label }) => (
              <div key={label} className="flex items-center gap-1.5">
                <div className="w-5 h-[3px] rounded-full" style={{ backgroundColor: color }} />
                <span className="font-body text-xs text-slate-500 dark:text-white/40">{label}</span>
              </div>
            ))}
          </div>

          {/* Team visibility toggle */}
          {otherSupervisors.length > 0 && (
            <div className="relative shrink-0">
              <button
                onClick={() => setShowTeamPanel(v => !v)}
                className={cn(
                  'flex items-center gap-1.5 px-3 py-1.5 rounded-xl font-body text-xs font-semibold shrink-0',
                  'border transition-colors duration-150',
                  showTeamPanel
                    ? 'bg-brand-navy text-white border-brand-navy'
                    : 'border-slate-200 text-slate-600 dark:border-white/10 dark:text-white/60 hover:bg-slate-50 dark:hover:bg-white/[0.05]',
                )}
              >
                <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <circle cx="9" cy="7" r="4"/><path strokeLinecap="round" strokeLinejoin="round" d="M3 21v-2a4 4 0 0 1 4-4h4a4 4 0 0 1 4 4v2"/>
                  <path strokeLinecap="round" strokeLinejoin="round" d="M16 3.13a4 4 0 0 1 0 7.75M21 21v-2a4 4 0 0 0-3-3.87"/>
                </svg>
                {showTeamPanel ? t('map.team_toggle_hide') : t('map.team_toggle_show')}
              </button>
              {showTeamPanel && (
                <div className={cn(
                  'absolute right-0 top-full mt-1.5 z-10 min-w-[180px]',
                  'rounded-2xl border border-slate-200 dark:border-white/[0.08]',
                  'bg-white dark:bg-[#12163a] shadow-lg',
                  'py-2 px-1',
                )}>
                  {otherSupervisors.map(sup => (
                    <label key={sup.id} className={cn(
                      'flex items-center gap-2.5 px-3 py-2 rounded-xl cursor-pointer',
                      'hover:bg-slate-50 dark:hover:bg-white/[0.04] transition-colors',
                    )}>
                      <input
                        type="checkbox"
                        checked={!hiddenSupervisors.has(sup.id)}
                        onChange={() => {
                          setHiddenSupervisors(prev => {
                            const next = new Set(prev)
                            if (next.has(sup.id)) next.delete(sup.id)
                            else next.add(sup.id)
                            return next
                          })
                        }}
                        className="rounded accent-brand-teal"
                      />
                      <span className="font-body text-sm text-brand-navy dark:text-white/80 truncate">{sup.name}</span>
                    </label>
                  ))}
                </div>
              )}
            </div>
          )}
        </div>

        {/* Drawing controls — only when terrain du jour is assigned */}
        {!submittedEOD && todayZones.length === 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/[0.07] px-4 py-3 font-body text-sm text-slate-500 dark:text-white/40">
            {t('map.no_turf_assigned')}
          </div>
        )}
        {!submittedEOD && todayZones.length > 0 && (
          <div className="mt-4 space-y-3">
            <p className="font-body text-xs text-slate-500 dark:text-white/40 font-semibold uppercase tracking-wide">
              {isTouch
                ? (t('map.draw_hint').replace('Cliquez', 'Appuyez').replace('Click', 'Tap'))
                : t('map.draw_hint')}
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
                { label: t('eod.recalls'), value: String(submittedEOD.recalls?.length ?? submittedEOD.recalls_count ?? 0) },
                { label: t('eod.pfu'), value: String(submittedEOD.pfu ?? 0) },
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

              <Field label={locale !== 'en' ? 'PPH = Montant PAC $ / Heures de terrain' : 'PPH = PAC Amount $ / Canvas Hours'}>
                <input
                  type="text"
                  value={!isNaN(pph) ? pph.toFixed(2) : ''}
                  readOnly
                  placeholder={locale !== 'en' ? 'Calculé automatiquement' : 'Auto-calculated'}
                  className={cn(inputCls, 'bg-slate-100/80 dark:bg-white/[0.04] cursor-default',
                    !isNaN(pph) ? 'text-brand-teal font-semibold' : 'text-slate-400 dark:text-white/30'
                  )}
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

            </div>

            {/* Recalls list */}
            <RecallsField
              recalls={recalls}
              onChange={setRecalls}
              locale={locale}
            />

            {/* PFU — Phone Follow-Up */}
            <Field label={t('eod.pfu')}>
              <input
                type="number" min="0" step="1" value={pfu}
                onChange={e => setPfu(e.target.value)}
                placeholder="0" className={inputCls}
              />
            </Field>

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
          {supervisorName
            ? (locale === 'en' ? `${supervisorName}'s History` : `Historique de ${supervisorName}`)
            : t('history.title')}
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
                          { label: t('history.col_pfu'), value: String(entry.pfu ?? 0) },
                        ].map(({ label, value }) => (
                          <div key={label} className="rounded-xl bg-slate-50 dark:bg-white/[0.04] p-3">
                            <p className="font-body text-[10px] text-slate-500 dark:text-white/40 uppercase tracking-wide">{label}</p>
                            <p className="font-display text-base font-bold text-brand-navy dark:text-white">{value}</p>
                          </div>
                        ))}
                      </div>
                      {entry.note && (
                        <p className="font-body text-sm text-slate-600 dark:text-white/60 italic">
                          "{entry.note.length > 80 ? entry.note.slice(0, 80) + '…' : entry.note}"
                        </p>
                      )}
                      <RecallsDisplay recalls={entry.recalls} locale={locale} />
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

      </>}

      {/* ── MOBILE drawing bar: fixed bottom bar when drawing on touch device ── */}
      {isTouch && drawMode === 'drawing' && !submittedEOD && (
        <div className={cn(
          'fixed inset-x-0 bottom-0 z-50',
          'flex items-center gap-3 px-4 safe-bottom',
          'h-16 bg-white dark:bg-[#12163a]',
          'border-t border-slate-200/80 dark:border-white/[0.08] shadow-2xl',
        )}>
          <button
            onClick={undoStreet}
            className={cn(
              'flex items-center gap-1.5 px-3 h-10 rounded-xl shrink-0',
              'bg-slate-100 dark:bg-white/[0.07] border border-slate-200 dark:border-white/10',
              'font-body text-xs font-semibold text-slate-700 dark:text-white/80',
              'active:scale-[0.97] transition-transform',
            )}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6M3 10l6-6" />
            </svg>
            {t('map.undo_street')}
          </button>
          <button
            onClick={finishStreet}
            disabled={currentLine.length < 2}
            className={cn(
              'flex items-center gap-1.5 px-3 h-10 rounded-xl shrink-0',
              'bg-brand-navy text-white font-body text-xs font-semibold',
              'active:scale-[0.97] disabled:opacity-50 transition-transform',
            )}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {t('map.finish_street')}
          </button>
          <div className="flex-1" />
          <button
            onClick={() => { setDrawMode('idle'); setCurrentLine([]) }}
            className={cn(
              'flex items-center gap-1.5 px-3 h-10 rounded-xl shrink-0',
              'bg-brand-teal text-white font-body text-xs font-semibold',
              'active:scale-[0.97] transition-transform',
            )}
          >
            {t('eod.submit')}
          </button>
        </div>
      )}

    </div>
  )
}

// ── PPH Leaderboard ────────────────────────────────────────────────────────────
function PPHLeaderboard({ supervisorId, locale }: { supervisorId: string; locale?: string }) {
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
            const isMe = row.supervisor_id === supervisorId
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

// ── Recalls field (add/remove structured entries) ──────────────────────────────
function RecallsField({
  recalls, onChange, locale,
}: {
  recalls:  RecallEntry[]
  onChange: (v: RecallEntry[]) => void
  locale?:  string
}) {
  const [street,     setStreet]     = useState('')
  const [postalCode, setPostalCode] = useState('')
  const [numbers,    setNumbers]    = useState('')

  const addEntry = () => {
    if (!street.trim()) return
    onChange([...recalls, {
      street:      street.trim(),
      postal_code: postalCode.trim(),
      numbers:     numbers.split(',').map(n => n.trim()).filter(Boolean),
    }])
    setStreet('')
    setPostalCode('')
    setNumbers('')
  }

  const removeEntry = (i: number) => onChange(recalls.filter((_, idx) => idx !== i))

  const inputCls = cn(
    'w-full rounded-xl px-3 py-2.5 font-body text-sm',
    'bg-slate-50 border border-slate-200 text-slate-900 placeholder:text-slate-400',
    'dark:bg-white/[0.06] dark:border-white/10 dark:text-white dark:placeholder:text-white/30',
    'focus-visible:outline-none focus-visible:border-brand-teal focus-visible:ring-2 focus-visible:ring-brand-teal/20',
    'transition-[border-color,box-shadow] duration-200',
  )

  return (
    <div className="space-y-3">
      <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide">
        {locale !== 'en' ? 'Rappels' : 'Recalls'} ({recalls.length})
      </label>

      {/* Existing entries */}
      {recalls.length > 0 && (
        <div className="space-y-2">
          {recalls.map((r, i) => (
            <div key={i} className="flex items-start gap-2 px-3 py-2.5 rounded-xl bg-slate-50 dark:bg-white/[0.04] border border-slate-200/80 dark:border-white/[0.07]">
              <div className="flex-1 min-w-0">
                <p className="font-body text-sm font-semibold text-brand-navy dark:text-white truncate">{r.street}{r.postal_code ? ` (${r.postal_code})` : ''}</p>
                {r.numbers.length > 0 && (
                  <p className="font-body text-xs text-slate-500 dark:text-white/50 mt-0.5">{r.numbers.join(', ')}</p>
                )}
              </div>
              <button
                type="button"
                onClick={() => removeEntry(i)}
                className="p-1 rounded-lg text-slate-400 hover:text-brand-red hover:bg-brand-red/8 transition-colors shrink-0"
              >
                <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
                </svg>
              </button>
            </div>
          ))}
        </div>
      )}

      {/* Add new entry */}
      <div className="rounded-xl border border-slate-200/80 dark:border-white/[0.07] p-3 space-y-2">
        <div className="grid grid-cols-2 gap-2">
          <input
            type="text" value={street} onChange={e => setStreet(e.target.value)}
            placeholder={locale !== 'en' ? 'Rue / Avenue' : 'Street / Avenue'}
            className={inputCls}
          />
          <input
            type="text" value={postalCode} onChange={e => setPostalCode(e.target.value)}
            placeholder="H2W 2M9"
            className={inputCls}
          />
        </div>
        <input
          type="text" value={numbers} onChange={e => setNumbers(e.target.value)}
          placeholder={locale !== 'en' ? 'Numéros civiques (12, 14, 16)' : 'House numbers (12, 14, 16)'}
          className={inputCls}
        />
        <button
          type="button"
          onClick={addEntry}
          disabled={!street.trim()}
          className={cn(
            'flex items-center gap-2 px-4 py-2 rounded-xl font-body text-xs font-semibold',
            'bg-brand-navy/8 text-brand-navy dark:bg-white/[0.06] dark:text-white/80',
            'hover:bg-brand-navy/15 dark:hover:bg-white/[0.10] transition-colors',
            'disabled:opacity-40 disabled:cursor-not-allowed',
          )}
        >
          <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <line strokeLinecap="round" x1="12" y1="5" x2="12" y2="19"/>
            <line strokeLinecap="round" x1="5" y1="12" x2="19" y2="12"/>
          </svg>
          {locale !== 'en' ? 'Ajouter un rappel' : 'Add recall'}
        </button>
      </div>
    </div>
  )
}

// ── Recalls display (in history expanded rows) ─────────────────────────────────
function RecallsDisplay({ recalls, locale }: { recalls: RecallEntry[] | null | undefined; locale?: string }) {
  const [expanded, setExpanded] = useState(false)
  if (!recalls || recalls.length === 0) return null
  const shown = expanded ? recalls : recalls.slice(0, 3)
  const hasMore = recalls.length > 3
  return (
    <div className="space-y-1.5">
      <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">
        {locale !== 'en' ? `Rappels (${recalls.length})` : `Recalls (${recalls.length})`}
      </p>
      {shown.map((r, i) => (
        <div key={i} className="font-body text-sm text-slate-600 dark:text-white/60">
          <span className="font-semibold text-brand-navy dark:text-white/80">{r.street}</span>
          {r.postal_code ? <span className="text-slate-400 dark:text-white/30"> ({r.postal_code})</span> : null}
          {r.numbers.length > 0 ? <span>: {r.numbers.join(', ')}</span> : null}
        </div>
      ))}
      {hasMore && (
        <button
          type="button"
          onClick={() => setExpanded(v => !v)}
          className="font-body text-xs text-brand-teal hover:underline"
        >
          {expanded
            ? (locale !== 'en' ? 'Voir moins' : 'See less')
            : (locale !== 'en' ? `Voir ${recalls.length - 3} de plus` : `See ${recalls.length - 3} more`)}
        </button>
      )}
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
