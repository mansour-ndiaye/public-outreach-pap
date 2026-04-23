'use client'

import { useRef, useState, useCallback, useEffect, useMemo } from 'react'
import { useRouter } from 'next/navigation'
import Map, {
  Source, Layer, Marker, NavigationControl, type MapRef, type MapMouseEvent,
} from 'react-map-gl/mapbox'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { createDailyZone, fetchSupervisorsForTeam, updateDailyZone, deleteDailyZone, swapDailyZoneSupervisor, fetchAllSupervisors } from '@/lib/supabase/zone-actions'
import { deleteStreetFeature } from '@/lib/supabase/eod-actions'
import type { RecallEntry } from '@/lib/supabase/eod-actions'
import { MapStyleSelector, useMapStyle } from '@/components/ui/MapStyleSelector'
import { BarrePopup } from '@/components/ui/BarrePopup'
import type { TerritoryRow } from '@/types'
import type { DailyZoneWithTeam, SupervisorOption } from '@/lib/supabase/zone-actions'
import type { VisitEntry } from '@/components/ui/BarrePopup'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
const MONTREAL: [number, number] = [-73.5673, 45.5017]

// 8-color team palette
const TEAM_COLORS = [
  '#E8174B', '#00B5A3', '#FF8C00', '#8B5CF6',
  '#F59E0B', '#10B981', '#3B82F6', '#EC4899',
]

type TeamOption = { id: string; name: string }
type SpeechRecognitionType = {
  lang: string; continuous: boolean; interimResults: boolean
  start(): void; stop(): void
  onresult: ((e: { results: { [k: number]: { [k: number]: { transcript: string } } } }) => void) | null
  onerror: (() => void) | null
  onend:   (() => void) | null
}

interface ManagerMapProps {
  territories:       TerritoryRow[]
  teams:             TeamOption[]
  zones:             DailyZoneWithTeam[]
  allCoveredStreets?: GeoJSON.FeatureCollection
  todayDate:         string
  teamColorMap:      Record<string, string>
  locale?:           string
}

function getColor(map: Record<string, string>, teamId: string) {
  return map[teamId] ?? '#94a3b8'
}

function polygonCentroid(coords: number[][][]): [number, number] {
  const ring = coords[0] ?? []
  if (ring.length === 0) return MONTREAL
  const lng = ring.reduce((s, c) => s + c[0], 0) / ring.length
  const lat = ring.reduce((s, c) => s + c[1], 0) / ring.length
  return [lng, lat]
}

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
          team_id: zone.team_id, team_name: zone.team_name,
          date: zone.date, color: getColor(colorMap, zone.team_id),
          zone_id: zone.id,
          supervisor_id: zone.supervisor_id ?? null,
          supervisor_name: zone.supervisor_name ?? null,
        },
      })
    }
  }
  return { type: 'FeatureCollection', features }
}

function buildDrawingGeoJSON(
  currentLine: [number, number][],
  completed:   GeoJSON.Feature[],
  aiPreview:   GeoJSON.Feature[] | null,
  color:       string,
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = [...completed]
  if (aiPreview) features.push(...aiPreview)
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
  territories, teams, zones, allCoveredStreets, todayDate, teamColorMap, locale,
}: ManagerMapProps) {
  const { resolvedTheme } = useTheme()
  const t = useTranslations('manager.map')
  const mapRef = useRef<MapRef>(null)
  const recognitionRef = useRef<SpeechRecognitionType | null>(null)

  // Map style (persistent)
  const [mapStyleUrl, setMapStyle] = useMapStyle(resolvedTheme)

  // Mobile map lock
  const [isTouch,      setIsTouch]      = useState(false)
  const [mapLocked,    setMapLocked]    = useState(true)
  const [showLockHint, setShowLockHint] = useState(false)
  const [mapLoaded,    setMapLoaded]    = useState(false)

  // UI state
  const router = useRouter()
  const [panelOpen,   setPanelOpen]   = useState(false)
  const [drawMode,    setDrawMode]    = useState<'idle' | 'drawing'>('idle')
  const [saving,      setSaving]      = useState(false)
  const [saveError,   setSaveError]   = useState('')
  const [saveSuccess, setSaveSuccess] = useState(false)
  const [cursor,      setCursor]      = useState<string>('grab')

  // Edit mode (delete terrain barré)
  const [editMode,       setEditMode]       = useState(false)
  const [deleteTarget,   setDeleteTarget]   = useState<{ entryId: string; featureIndex: number; supervisorName: string; date: string } | null>(null)
  const [deleting,       setDeleting]       = useState(false)
  const [deleteError,    setDeleteError]    = useState('')

  // Assignment confirmation popup
  const [assignConfirm, setAssignConfirm] = useState<{
    supervisorNames: string[]; teamName: string; date: string; streetCount: number
  } | null>(null)

  // Next-action overlay (shown after assignConfirm dismisses)
  const [showNextAction, setShowNextAction] = useState(false)

  // Zone popup (click on terrain du jour line)
  const [zonePopup, setZonePopup] = useState<{
    zoneId: string; supervisorName: string | null; supervisorId: string | null
    teamName: string; date: string; lng: number; lat: number
  } | null>(null)

  // Zone edit/delete state
  const [editingZoneId, setEditingZoneId] = useState<string | null>(null)
  const [zoneDeleteConfirm, setZoneDeleteConfirm] = useState<{
    zoneId: string; supervisorName: string | null; teamName: string
  } | null>(null)
  const [deletingZone, setDeletingZone] = useState(false)
  const [deleteZoneError, setDeleteZoneError] = useState('')

  // Period filter for terrain barré
  type PeriodFilter = 'quarter' | 'prev_quarter' | 'rolling_3mo' | 'all'
  const [periodFilter, setPeriodFilter] = useState<PeriodFilter>('quarter')

  // Swap supervisor modal
  const [swapModal, setSwapModal] = useState<{
    zoneId: string; currentSupervisorId: string | null; currentSupervisorName: string | null; zoneDate: string
  } | null>(null)
  const [allSupervisors, setAllSupervisors] = useState<SupervisorOption[]>([])
  const [swapNewSupId, setSwapNewSupId] = useState('')
  const [swapping, setSwapping] = useState(false)
  const [swapError, setSwapError] = useState('')
  const [swapSuccess, setSwapSuccess] = useState(false)

  // Recall pins
  type RecallMapPin = { lng: number; lat: number; street: string; postal_code: string; numbers: string[]; supervisor_name: string; date: string }
  const [showRecallPins, setShowRecallPins] = useState(true)

  const recallPins = useMemo((): RecallMapPin[] => {
    if (!allCoveredStreets?.features) return []
    const pins: RecallMapPin[] = []
    for (const feature of allCoveredStreets.features) {
      if (feature.geometry.type !== 'LineString') continue
      const p = feature.properties ?? {}
      const recallsJson = p.recalls as string | undefined
      if (!recallsJson) continue
      let recalls: RecallEntry[]
      try { recalls = JSON.parse(recallsJson) } catch { continue }
      if (!recalls.length) continue
      const coords = (feature.geometry as GeoJSON.LineString).coordinates
      const mid = Math.floor(coords.length / 2)
      const [lng, lat] = coords[mid]
      for (const r of recalls) {
        pins.push({
          lng, lat,
          street:          r.street,
          postal_code:     r.postal_code,
          numbers:         r.numbers,
          supervisor_name: (p.supervisor_name as string) ?? '',
          date:            (p.entry_date as string) ?? '',
        })
      }
    }
    return pins
  }, [allCoveredStreets])

  // Assignment form
  const [formTeamId,        setFormTeamId]        = useState('')
  const [formSupervisorIds, setFormSupervisorIds] = useState<string[]>([])
  const [formDate,          setFormDate]          = useState(todayDate)
  const [formNote,          setFormNote]          = useState('')
  const [supervisors,       setSupervisors]       = useState<SupervisorOption[]>([])
  const [loadingSups,       setLoadingSups]       = useState(false)

  // Manual drawing state
  const [currentLine,  setCurrentLine]  = useState<[number, number][]>([])
  const [drawnStreets, setDrawnStreets] = useState<GeoJSON.Feature[]>([])

  // AI assistant state
  const [aiInput,      setAiInput]      = useState('')
  const [aiPending,    setAiPending]    = useState(false)
  const [aiPreview,    setAiPreview]    = useState<GeoJSON.Feature[] | null>(null)
  const [aiError,      setAiError]      = useState('')
  const [isRecording,  setIsRecording]  = useState(false)

  // Terrain barré hover tooltip
  const [barreHover, setBarreHover] = useState<{
    supervisor_name: string; team_name: string | null; date: string
    pph: number; canvas_hours: number | null; pac_count: number; pac_total_amount: number
    pfu: number; recalls_count: number; recalls?: RecallEntry[]; note: string | null; streets_count: number
    postal_code?: string
    visits?: VisitEntry[]
    lng: number; lat: number
    entry_id?: string; feature_index?: number
  } | null>(null)

  // Detect touch device + show hint
  useEffect(() => {
    const touch = window.matchMedia('(pointer: coarse)').matches
    setIsTouch(touch)
    if (touch) {
      setMapLocked(true)
      setShowLockHint(true)
      const timer = setTimeout(() => setShowLockHint(false), 3000)
      return () => clearTimeout(timer)
    }
  }, [])

  // Apply lock/unlock to map
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded || !isTouch) return
    const shouldLock = mapLocked && drawMode === 'idle'
    if (shouldLock) {
      map.scrollZoom.disable()
      map.dragPan.disable()
      map.touchZoomRotate.disable()
    } else {
      map.scrollZoom.enable()
      map.dragPan.enable()
      map.touchZoomRotate.enable()
    }
  }, [mapLocked, isTouch, mapLoaded, drawMode])

  // Load supervisors when team selection changes
  useEffect(() => {
    if (!formTeamId) { setSupervisors([]); setFormSupervisorIds([]); return }
    setLoadingSups(true)
    setFormSupervisorIds([])
    fetchSupervisorsForTeam(formTeamId).then(sups => {
      setSupervisors(sups)
      setLoadingSups(false)
    })
  }, [formTeamId])

  const territoriesGeoJSON = useMemo(() => buildTerritoriesGeoJSON(territories), [territories])

  // Today's terrain du jour — all supervisors, green #22c55e
  const todayZonesGeoJSON = useMemo(
    () => buildZonesGeoJSON(zones, teamColorMap, z => z.date === todayDate),
    [zones, teamColorMap, todayDate],
  )

  // Period filter helper
  const periodStartDate = useMemo((): string | null => {
    const now = new Date()
    if (periodFilter === 'all') return null
    if (periodFilter === 'rolling_3mo') {
      const d = new Date(now)
      d.setMonth(d.getMonth() - 3)
      return d.toISOString().split('T')[0]
    }
    const month = now.getMonth() // 0-based
    const year  = now.getFullYear()
    if (periodFilter === 'quarter') {
      const qStart = Math.floor(month / 3) * 3
      return `${year}-${String(qStart + 1).padStart(2, '0')}-01`
    }
    // prev_quarter
    const qStart = Math.floor(month / 3) * 3 - 3
    if (qStart < 0) return `${year - 1}-10-01`
    return `${year}-${String(qStart + 1).padStart(2, '0')}-01`
  }, [periodFilter])

  const periodEndDate = useMemo((): string | null => {
    if (periodFilter !== 'prev_quarter') return null
    const now = new Date()
    const month = now.getMonth()
    const year  = now.getFullYear()
    const qStart = Math.floor(month / 3) * 3 - 3
    const qEnd   = qStart + 3
    if (qEnd <= 0) return `${year - 1}-12-31`
    return `${year}-${String(qEnd).padStart(2, '0')}-${new Date(year, qEnd, 0).getDate()}`
  }, [periodFilter])

  // Covered streets filtered by selected period
  const coveredStreetsGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const base = allCoveredStreets ?? { type: 'FeatureCollection', features: [] }
    if (periodFilter === 'all') return base
    const features = base.features.filter(f => {
      const d = f.properties?.entry_date as string | null
      if (!d) return true
      if (periodStartDate && d < periodStartDate) return false
      if (periodEndDate   && d > periodEndDate)   return false
      return true
    })
    return { type: 'FeatureCollection', features }
  }, [allCoveredStreets, periodFilter, periodStartDate, periodEndDate])

  const drawingGeoJSON = useMemo(
    () => buildDrawingGeoJSON(currentLine, drawnStreets, aiPreview, getColor(teamColorMap, formTeamId)),
    [currentLine, drawnStreets, aiPreview, formTeamId, teamColorMap],
  )

  const handleMapClick = useCallback((e: MapMouseEvent) => {
    if (drawMode === 'drawing') {
      const { lng, lat } = e.lngLat
      setCurrentLine(prev => [...prev, [lng, lat]])
      return
    }
    if (!editMode && drawMode === 'idle' && !panelOpen) {
      const zoneFeatures = mapRef.current?.queryRenderedFeatures(e.point, { layers: ['today-zones-line'] })
      if (zoneFeatures?.length) {
        const p = zoneFeatures[0].properties ?? {}
        const zoneId = p.zone_id as string | undefined
        if (zoneId) {
          setZonePopup({
            zoneId,
            supervisorName: (p.supervisor_name as string | null) ?? null,
            supervisorId:   (p.supervisor_id   as string | null) ?? null,
            teamName:       (p.team_name        as string) ?? '—',
            date:           (p.date             as string) ?? '—',
            lng: e.lngLat.lng,
            lat: e.lngLat.lat,
          })
          return
        }
      }
    }
    if (editMode && drawMode === 'idle') {
      const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ['covered-streets-line'] })
      if (features?.length) {
        const p = features[0].properties ?? {}
        const entryId      = p.entry_id as string | undefined
        const featureIndex = p.feature_index != null ? Number(p.feature_index) : undefined
        if (entryId != null && featureIndex != null) {
          setDeleteTarget({
            entryId,
            featureIndex,
            supervisorName: (p.supervisor_name as string) ?? '',
            date:           (p.entry_date as string) ?? (p.date as string) ?? '',
          })
          setBarreHover(null)
        }
      }
    }
  }, [drawMode, editMode, panelOpen])

  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    if (drawMode === 'drawing') { setBarreHover(null); return }
    const features = mapRef.current?.queryRenderedFeatures(e.point, { layers: ['covered-streets-line', 'covered-streets-oob-line'] })
    if (features?.length) {
      const p = features[0].properties ?? {}
      let recalls: RecallEntry[] | undefined
      try { recalls = JSON.parse(p.recalls as string) } catch { recalls = undefined }
      const postalCode = (p.postal_code as string | null) ?? undefined
      // Build multi-visit list from all features at this point sharing the same street_key
      const streetKey = (p.street_key as string | null) ?? null
      let visits: VisitEntry[] | undefined
      if (streetKey) {
        const allAtPoint = features.filter(f => (f.properties?.street_key as string | null) === streetKey)
        if (allAtPoint.length > 1) {
          // dedupe by entry_id
          const seen = new Set<string>()
          visits = allAtPoint
            .map(f => ({
              date:            (f.properties?.entry_date as string) ?? '',
              supervisor_name: (f.properties?.supervisor_name as string) ?? '—',
              team_name:       (f.properties?.team_name as string | null) ?? null,
              pph:             Number(f.properties?.pph ?? 0),
              entry_id:        (f.properties?.entry_id as string) ?? '',
            }))
            .filter(v => { if (seen.has(v.entry_id)) return false; seen.add(v.entry_id); return true })
            .sort((a, b) => b.date.localeCompare(a.date))
        }
      }
      setBarreHover({
        supervisor_name:  (p.supervisor_name as string | null) ?? '—',
        team_name:        (p.team_name as string | null) ?? null,
        date:             (p.entry_date as string | null) ?? (p.date as string | null) ?? '—',
        pph:              Number(p.pph ?? 0),
        canvas_hours:     p.canvas_hours != null ? Number(p.canvas_hours) : null,
        pac_count:        Number(p.pac_count ?? 0),
        pac_total_amount: Number(p.pac_total_amount ?? 0),
        pfu:              Number(p.pfu ?? 0),
        recalls_count:    Number(p.recalls_count ?? 0),
        recalls,
        postal_code:      postalCode,
        note:             (p.note as string | null) ?? null,
        streets_count:    Number(p.streets_count ?? 0),
        visits,
        lng:              e.lngLat.lng,
        lat:              e.lngLat.lat,
        entry_id:         (p.entry_id as string | null) ?? undefined,
        feature_index:    p.feature_index != null ? Number(p.feature_index) : undefined,
      })
    } else {
      setBarreHover(null)
    }
  }, [drawMode])

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
    setAiInput('')
    setAiPreview(null)
    setAiError('')
  }

  const closePanel = () => {
    setPanelOpen(false)
    setDrawMode('idle')
    setCurrentLine([])
    setDrawnStreets([])
    setFormTeamId('')
    setFormSupervisorIds([])
    setSupervisors([])
    setFormNote('')
    setFormDate(todayDate)
    setSaveError('')
    setAiInput('')
    setAiPreview(null)
    setAiError('')
    setAssignConfirm(null)
    setEditingZoneId(null)
    recognitionRef.current?.stop()
    setIsRecording(false)
  }

  // After saving, reset drawing state so another zone can be drawn
  const resetForAnotherZone = () => {
    setDrawMode('idle')
    setCurrentLine([])
    setDrawnStreets([])
    setAiInput('')
    setAiPreview(null)
    setAiError('')
    setSaveSuccess(false)
    setSaveError('')
    setAssignConfirm(null)
    setEditingZoneId(null)
    // keep formTeamId, formSupervisorIds, formDate, formNote
  }

  // Dismiss the assign confirmation and show next-action prompt
  const handleAssignConfirmDismiss = useCallback(() => {
    setAssignConfirm(null)
    setShowNextAction(true)
    setPanelOpen(false)
    setDrawMode('idle')
    setCurrentLine([])
    setDrawnStreets([])
    setSaveSuccess(false)
    setSaveError('')
    setAiInput('')
    setAiPreview(null)
    setAiError('')
    setEditingZoneId(null)
    setFormSupervisorIds([])
  }, [])

  const startDrawing = () => {
    if (!formTeamId) { setSaveError(locale !== 'en' ? 'Sélectionnez une équipe' : 'Select a team'); return }
    if (formSupervisorIds.length === 0 && !editingZoneId) { setSaveError(locale !== 'en' ? 'Sélectionnez au moins un superviseur' : 'Select at least one supervisor'); return }
    setSaveError('')
    setCurrentLine([])
    setDrawnStreets([])
    setAiPreview(null)
    setDrawMode('drawing')
  }

  const finishStreet = async () => {
    if (currentLine.length < 2) return

    // Reverse geocode midpoint for postal code
    let postalCode: string | undefined
    try {
      const mid = Math.floor(currentLine.length / 2)
      const [lng, lat] = currentLine[mid]
      const url = `https://api.mapbox.com/geocoding/v5/mapbox.places/${lng},${lat}.json?access_token=${MAPBOX_TOKEN}&types=postcode&limit=1`
      const res = await fetch(url)
      const json = await res.json()
      postalCode = json.features?.[0]?.text as string | undefined
    } catch { /* non-critical */ }

    setDrawnStreets(prev => [...prev, {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: currentLine },
      properties: { color: getColor(teamColorMap, formTeamId), postal_code: postalCode ?? null },
    }])
    setCurrentLine([])
  }

  const undoStreet = () => {
    if (currentLine.length > 0) setCurrentLine([])
    else setDrawnStreets(prev => prev.slice(0, -1))
  }

  // ── AI assistant ─────────────────────────────────────────────────────────────
  const handleAIDraw = async () => {
    if (!aiInput.trim()) return
    setAiPending(true)
    setAiError('')
    setAiPreview(null)

    // Use territory centroid or Montreal as proximity hint
    const center = (() => {
      const firstTerr = territories.find(t => t.coordinates?.length)
      if (firstTerr) return polygonCentroid(firstTerr.coordinates!)
      return MONTREAL
    })()

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
            features.push({ type: 'Feature', geometry: feature.geometry, properties: { ai: true, color: getColor(teamColorMap, formTeamId) } })
          } else if (feature.geometry.type === 'Point') {
            const [lng, lat] = feature.geometry.coordinates
            features.push({
              type: 'Feature',
              geometry: { type: 'LineString', coordinates: [[lng - 0.001, lat], [lng + 0.001, lat]] },
              properties: { ai: true, color: getColor(teamColorMap, formTeamId), name: segment },
            })
          }
        }
      } catch { /* skip failed segment */ }
    }

    setAiPending(false)
    if (features.length === 0) {
      setAiError(t('ai_no_results'))
    } else {
      setAiPreview(features)
      // Fit map to preview
      if (mapRef.current) {
        const allCoords = features.flatMap(f =>
          f.geometry.type === 'LineString' ? (f.geometry as GeoJSON.LineString).coordinates : []
        )
        if (allCoords.length >= 2) {
          const lngs = allCoords.map(c => c[0])
          const lats = allCoords.map(c => c[1])
          mapRef.current.fitBounds(
            [[Math.min(...lngs), Math.min(...lats)], [Math.max(...lngs), Math.max(...lats)]],
            { padding: 60, duration: 800 }
          )
        }
      }
    }
  }

  const confirmAIStreets = () => {
    if (!aiPreview) return
    setDrawnStreets(prev => [...prev, ...aiPreview])
    setAiPreview(null)
    setAiInput('')
  }

  const retryAI = () => {
    setAiPreview(null)
    setAiError('')
  }

  const toggleVoice = () => {
    if (typeof window === 'undefined') return
    const SR = (window as unknown as { SpeechRecognition?: new () => SpeechRecognitionType; webkitSpeechRecognition?: new () => SpeechRecognitionType }).SpeechRecognition
      ?? (window as unknown as { webkitSpeechRecognition?: new () => SpeechRecognitionType }).webkitSpeechRecognition
    if (!SR) return

    if (isRecording) {
      recognitionRef.current?.stop()
      setIsRecording(false)
      return
    }

    const rec = new SR()
    rec.lang = 'fr-CA'
    rec.continuous = false
    rec.interimResults = false
    rec.onresult = e => setAiInput(prev => prev ? prev + ', ' + e.results[0][0].transcript : e.results[0][0].transcript)
    rec.onerror = () => setIsRecording(false)
    rec.onend   = () => setIsRecording(false)
    recognitionRef.current = rec
    rec.start()
    setIsRecording(true)
  }

  // ── Auto-dismiss assign confirmation after 3s ─────────────────────────────
  useEffect(() => {
    if (!assignConfirm) return
    const timer = setTimeout(() => handleAssignConfirmDismiss(), 3000)
    return () => clearTimeout(timer)
  }, [assignConfirm, handleAssignConfirmDismiss])

  // ── Delete confirmation handler ────────────────────────────────────────────
  const handleDeleteConfirm = useCallback(async () => {
    if (!deleteTarget) return
    setDeleting(true)
    setDeleteError('')
    const result = await deleteStreetFeature(deleteTarget.entryId, deleteTarget.featureIndex)
    setDeleting(false)
    if (result.error) {
      setDeleteError(result.error)
    } else {
      setDeleteTarget(null)
      router.refresh()
    }
  }, [deleteTarget, router])

  // ── Save zone (create or update) ─────────────────────────────────────────────
  const saveZone = async () => {
    const allStreets = [...drawnStreets]
    if (currentLine.length >= 2) {
      allStreets.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: currentLine },
        properties: { color: getColor(teamColorMap, formTeamId) },
      })
    }
    if (allStreets.length === 0) { setSaveError(t('no_streets')); return }

    setSaving(true)
    setSaveError('')
    const fc: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: allStreets }

    if (editingZoneId) {
      const result = await updateDailyZone(editingZoneId, fc)
      setSaving(false)
      if (result.error) { setSaveError(result.error); return }
      setEditingZoneId(null)
      closePanel()
      router.refresh()
      return
    }

    // Create one zone per selected supervisor (multi-supervisor support)
    const supIds = formSupervisorIds.length > 0 ? formSupervisorIds : [null]
    const results = await Promise.all(
      supIds.map(supId => createDailyZone({
        team_id:       formTeamId,
        supervisor_id: supId,
        date:          formDate,
        streets:       fc,
        note:          formNote,
      }))
    )
    setSaving(false)

    const firstError = results.find(r => r.error)
    if (firstError?.error) { setSaveError(firstError.error); return }

    setSaveSuccess(true)
    const supNames = supIds.map(id => {
      if (!id) return '—'
      return supervisors.find(s => s.id === id)?.full_name
        ?? supervisors.find(s => s.id === id)?.email
        ?? '—'
    })
    const tmName = teams.find(tm => tm.id === formTeamId)?.name ?? '—'
    setAssignConfirm({
      supervisorNames: supNames,
      teamName:        tmName,
      date:            formDate,
      streetCount:     allStreets.length,
    })
  }

  // ── Labels ────────────────────────────────────────────────────────────────────
  const territoryLabels = useMemo(() => territories
    .filter(t => t.coordinates?.length)
    .map(t => ({ id: t.id, name: t.name, center: polygonCentroid(t.coordinates!) })),
  [territories])

  const todayZoneLabels = useMemo(() => {
    const labels: { label: string; center: [number, number]; color: string }[] = []
    for (const zone of zones.filter(z => z.date === todayDate)) {
      const fc = zone.streets as GeoJSON.FeatureCollection
      if (!fc?.features?.length) continue
      const firstLine = fc.features.find(f => f.geometry.type === 'LineString')
      if (!firstLine) continue
      const coords = (firstLine.geometry as GeoJSON.LineString).coordinates
      if (coords.length < 2) continue
      const mid = Math.floor(coords.length / 2)
      const supSuffix = zone.supervisor_name ? ` — ${zone.supervisor_name}` : ''
      labels.push({
        label:  zone.team_name + supSuffix,
        center: [coords[mid][0], coords[mid][1]],
        color:  getColor(teamColorMap, zone.team_id),
      })
    }
    return labels
  }, [zones, todayDate, teamColorMap])

  const totalDrawn = drawnStreets.length + (aiPreview?.length ?? 0)

  return (
    <div className="relative w-full h-full">

      {/* Map */}
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{ longitude: MONTREAL[0], latitude: MONTREAL[1], zoom: 12 }}
        style={{ width: '100%', height: '100%' }}
        mapStyle={mapStyleUrl}
        cursor={cursor}
        onClick={handleMapClick}
        onMouseMove={handleMouseMove}
        onLoad={() => setMapLoaded(true)}
      >
        <NavigationControl position="top-right" />

        {/* Zone polygons — Navy #2E3192 */}
        <Source id="territories" type="geojson" data={territoriesGeoJSON}>
          <Layer id="territories-fill" type="fill" paint={{ 'fill-color': '#2E3192', 'fill-opacity': 0.10 }} />
          <Layer id="territories-line" type="line" paint={{ 'line-color': '#2E3192', 'line-width': 2, 'line-opacity': 0.6 }} />
        </Source>

        {territoryLabels.map(lbl => (
          <Marker key={lbl.id} longitude={lbl.center[0]} latitude={lbl.center[1]} anchor="center">
            <div className="px-2 py-0.5 rounded-full text-[10px] font-bold font-body bg-brand-navy/80 text-white shadow-sm pointer-events-none whitespace-nowrap">
              {lbl.name}
            </div>
          </Marker>
        ))}

        {/* Terrain barré — opacity encodes recency: rank 0=100%, rank 1=60%, rank 2+=35% */}
        <Source id="covered-streets" type="geojson" data={coveredStreetsGeoJSON}>
          <Layer
            id="covered-streets-line"
            type="line"
            filter={['!=', true, ['coalesce', ['get', 'out_of_bounds'], false]]}
            paint={{
              'line-color': ['case',
                ['==', ['get', 'recency_rank'], 0], '#000000',
                ['==', ['get', 'recency_rank'], 1], '#333333',
                '#666666',
              ],
              'line-width': 2,
              'line-opacity': ['case',
                ['==', ['get', 'recency_rank'], 0], 1.0,
                ['==', ['get', 'recency_rank'], 1], 0.60,
                0.35,
              ],
            }}
          />
          <Layer
            id="covered-streets-oob-line"
            type="line"
            filter={['==', true, ['get', 'out_of_bounds']]}
            paint={{
              'line-color': '#f97316',
              'line-width': 2.5,
              'line-opacity': ['case',
                ['==', ['get', 'recency_rank'], 0], 0.9,
                ['==', ['get', 'recency_rank'], 1], 0.60,
                0.35,
              ],
            }}
          />
        </Source>

        {/* Terrain du jour — green #22c55e */}
        <Source id="today-zones" type="geojson" data={todayZonesGeoJSON}>
          <Layer id="today-zones-line" type="line" paint={{ 'line-color': '#22c55e', 'line-width': 3.5, 'line-opacity': 0.9 }} />
        </Source>

        {todayZoneLabels.map((lbl, i) => (
          <Marker key={i} longitude={lbl.center[0]} latitude={lbl.center[1]} anchor="center">
            <div className="px-2 py-0.5 rounded-full text-[10px] font-bold font-body text-white shadow-sm pointer-events-none whitespace-nowrap" style={{ backgroundColor: '#22c55e' }}>
              {lbl.label}
            </div>
          </Marker>
        ))}

        {/* Drawing in progress — orange #f97316 */}
        {drawMode === 'drawing' && (
          <Source id="drawing" type="geojson" data={drawingGeoJSON}>
            <Layer id="drawing-line" type="line" paint={{
              'line-color': '#f97316',
              'line-width': 4, 'line-opacity': 0.95,
              'line-dasharray': ['literal', [2, 1]],
            }} />
          </Source>
        )}

        {/* Recall pins */}
        {showRecallPins && recallPins.map((pin, i) => (
          <Marker key={`recall-${i}`} longitude={pin.lng} latitude={pin.lat} anchor="center">
            <div
              title={`${pin.street}${pin.numbers.length ? ': ' + pin.numbers.join(', ') : ''} — ${pin.supervisor_name}`}
              className="w-5 h-5 rounded-full bg-brand-red border-2 border-white shadow-md flex items-center justify-center pointer-events-auto cursor-default"
            >
              <span className="text-white font-bold text-[9px] leading-none">!</span>
            </div>
          </Marker>
        ))}

        {/* Terrain barré popup — hide in edit mode */}
        {barreHover && !editMode && (
          <Marker longitude={barreHover.lng} latitude={barreHover.lat} anchor="bottom">
            <BarrePopup info={barreHover} onClose={() => setBarreHover(null)} />
          </Marker>
        )}

        {/* Zone click popup */}
        {zonePopup && !panelOpen && (
          <Marker longitude={zonePopup.lng} latitude={zonePopup.lat} anchor="bottom">
            <div className={cn(
              'mb-2 rounded-2xl overflow-hidden shadow-2xl border min-w-[200px]',
              'bg-white dark:bg-[#12163a] border-slate-200/80 dark:border-white/[0.08]',
            )}>
              <div className="h-1 bg-[#22c55e]" />
              <div className="px-4 py-3 space-y-2">
                <div>
                  <p className="font-body text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wide">
                    {locale !== 'en' ? 'Terrain du jour' : "Today's turf"}
                  </p>
                  <p className="font-display text-sm font-bold text-brand-navy dark:text-white">
                    {zonePopup.supervisorName ?? (locale !== 'en' ? 'Aucun superviseur' : 'No supervisor')}
                  </p>
                  <p className="font-body text-xs text-slate-500 dark:text-white/50">{zonePopup.teamName}</p>
                </div>
                <div className="flex gap-1.5">
                  <button
                    onClick={() => {
                      const zone = zones.find(z => z.id === zonePopup.zoneId)
                      if (!zone) return
                      const fc = zone.streets as GeoJSON.FeatureCollection
                      setEditingZoneId(zone.id)
                      setFormTeamId(zone.team_id)
                      setFormSupervisorIds(zone.supervisor_id ? [zone.supervisor_id] : [])
                      setFormDate(zone.date)
                      setDrawnStreets(fc?.features ?? [])
                      setZonePopup(null)
                      setPanelOpen(true)
                      setDrawMode('drawing')
                      setSaveError('')
                      setSaveSuccess(false)
                    }}
                    className="flex-1 h-8 rounded-xl font-body text-xs font-semibold bg-brand-navy text-white hover:bg-brand-navy-light transition-colors"
                  >
                    {locale !== 'en' ? 'Modifier' : 'Edit'}
                  </button>
                  <button
                    onClick={() => {
                      setSwapModal({
                        zoneId: zonePopup.zoneId,
                        currentSupervisorId:   zonePopup.supervisorId,
                        currentSupervisorName: zonePopup.supervisorName,
                        zoneDate: zonePopup.date,
                      })
                      setSwapNewSupId(zonePopup.supervisorId ?? '')
                      setSwapError('')
                      setSwapSuccess(false)
                      setZonePopup(null)
                      // Load all supervisors lazily
                      fetchAllSupervisors().then(sups => setAllSupervisors(sups))
                    }}
                    className="flex-1 h-8 rounded-xl font-body text-xs font-semibold bg-brand-teal/10 text-brand-teal hover:bg-brand-teal/20 transition-colors"
                  >
                    {locale !== 'en' ? 'Changer' : 'Swap'}
                  </button>
                  <button
                    onClick={() => {
                      setZoneDeleteConfirm({ zoneId: zonePopup.zoneId, supervisorName: zonePopup.supervisorName, teamName: zonePopup.teamName })
                      setZonePopup(null)
                    }}
                    className="flex-1 h-8 rounded-xl font-body text-xs font-semibold bg-brand-red/10 text-brand-red hover:bg-brand-red/20 transition-colors"
                  >
                    {locale !== 'en' ? 'Supprimer' : 'Delete'}
                  </button>
                  <button
                    onClick={() => setZonePopup(null)}
                    className="w-8 h-8 rounded-xl font-body text-xs text-slate-400 dark:text-white/40 hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors flex items-center justify-center"
                  >✕</button>
                </div>
              </div>
            </div>
          </Marker>
        )}
      </Map>

      {/* Edit mode toggle button (only when panel is closed + not drawing) */}
      {!panelOpen && drawMode === 'idle' && (
        <button
          onClick={() => { setEditMode(prev => !prev); setDeleteTarget(null); setDeleteError('') }}
          className={cn(
            'absolute top-4 left-4 z-20',
            'flex items-center gap-1.5 px-3 h-9 rounded-xl',
            'font-body text-xs font-semibold',
            'border shadow-md backdrop-blur-sm transition-colors',
            editMode
              ? 'bg-brand-red/90 text-white border-brand-red/30'
              : 'bg-white/95 dark:bg-[#12163a]/95 text-slate-700 dark:text-white/80 border-slate-200/80 dark:border-white/[0.12]',
          )}
        >
          {editMode ? (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12"/>
              </svg>
              {locale !== 'en' ? 'Terminer' : 'Done'}
            </>
          ) : (
            <>
              <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M11 5H6a2 2 0 00-2 2v11a2 2 0 002 2h11a2 2 0 002-2v-5m-1.414-9.414a2 2 0 112.828 2.828L11.828 15H9v-2.828l8.586-8.586z"/>
              </svg>
              {locale !== 'en' ? 'Éditer' : 'Edit'}
            </>
          )}
        </button>
      )}

      {/* Edit mode hint */}
      {editMode && !panelOpen && (
        <div className={cn(
          'absolute top-4 left-1/2 -translate-x-1/2 z-20',
          'flex items-center gap-2 px-4 py-2 rounded-xl',
          'bg-brand-red/90 backdrop-blur-sm text-white',
          'font-body text-xs pointer-events-none whitespace-nowrap',
        )}>
          <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
          </svg>
          {locale !== 'en' ? 'Cliquez sur une rue pour la supprimer' : 'Click a street to remove it'}
        </div>
      )}

      {/* Delete confirmation dialog */}
      {deleteTarget && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className={cn(
            'mx-4 w-full max-w-xs rounded-2xl overflow-hidden shadow-2xl',
            'bg-white dark:bg-[#12163a]',
            'border border-slate-200/80 dark:border-white/[0.08]',
          )}>
            <div className="h-1 bg-brand-red" />
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-red/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-brand-red" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                </div>
                <div>
                  <p className="font-display font-bold text-brand-navy dark:text-white text-sm">
                    {locale !== 'en'
                      ? `Supprimer la rue barrée de ${deleteTarget.supervisorName || '—'}`
                      : `Remove ${deleteTarget.supervisorName || '—'}'s covered street`}
                  </p>
                  {deleteTarget.date && (
                    <p className="font-body text-xs text-slate-500 dark:text-white/50 mt-0.5">
                      {deleteTarget.date}
                    </p>
                  )}
                </div>
              </div>
              {deleteError && (
                <p className="font-body text-xs text-brand-red">{deleteError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setDeleteTarget(null); setDeleteError('') }}
                  className="flex-1 h-10 rounded-xl font-body text-sm font-semibold border border-slate-200 dark:border-white/[0.12] text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-colors"
                >
                  {locale !== 'en' ? 'Annuler' : 'Cancel'}
                </button>
                <button
                  onClick={handleDeleteConfirm}
                  disabled={deleting}
                  className="flex-1 h-10 rounded-xl font-body text-sm font-semibold bg-brand-red text-white hover:bg-brand-red/90 disabled:opacity-60 transition-colors"
                >
                  {deleting ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin mx-auto" />
                  ) : (
                    locale !== 'en' ? 'Confirmer' : 'Confirm'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Assignment confirmation popup */}
      {assignConfirm && (
        <div className="absolute inset-0 z-50 flex items-center justify-center pointer-events-none">
          <div className={cn(
            'mx-4 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl pointer-events-auto',
            'bg-white dark:bg-[#12163a]',
            'border border-slate-200/80 dark:border-white/[0.08]',
            'animate-fade-in',
          )}>
            <div className="h-1.5 bg-brand-navy" />
            <div className="px-6 py-5 text-center space-y-3">
              {/* Green checkmark */}
              <div className="w-14 h-14 rounded-full bg-[#22c55e]/10 flex items-center justify-center mx-auto">
                <svg className="w-8 h-8 text-[#22c55e]" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7"/>
                </svg>
              </div>
              <div>
                <p className="font-display text-lg font-bold text-brand-navy dark:text-white">
                  {locale !== 'en' ? 'Terrain assigné!' : 'Turf assigned!'}
                </p>
                <p className="font-body text-sm text-slate-600 dark:text-white/70 mt-1">
                  {assignConfirm.supervisorNames.join(', ')}
                  {assignConfirm.teamName !== '—' && ` · ${assignConfirm.teamName}`}
                  {assignConfirm.date && ` · ${new Date(assignConfirm.date + 'T00:00:00').toLocaleDateString(locale !== 'en' ? 'fr-CA' : 'en-CA', { day: 'numeric', month: 'long', year: 'numeric' })}`}
                </p>
                {assignConfirm.streetCount > 0 && (
                  <p className="font-body text-xs text-slate-400 dark:text-white/40 mt-1">
                    {assignConfirm.streetCount} {locale !== 'en'
                      ? (assignConfirm.streetCount > 1 ? 'rues assignées' : 'rue assignée')
                      : (assignConfirm.streetCount > 1 ? 'streets assigned' : 'street assigned')}
                  </p>
                )}
              </div>
              <button
                onClick={handleAssignConfirmDismiss}
                className="mt-1 font-body text-xs text-slate-400 dark:text-white/30 hover:text-slate-600 dark:hover:text-white/60 transition-colors"
              >
                {locale !== 'en' ? 'Fermer' : 'Close'}
              </button>
            </div>
          </div>
        </div>
      )}

      {/* Next-action prompt after successful assignment */}
      {showNextAction && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/30 backdrop-blur-sm">
          <div className={cn(
            'mx-4 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl',
            'bg-white dark:bg-[#12163a]',
            'border border-slate-200/80 dark:border-white/[0.08]',
          )}>
            <div className="h-1.5 bg-brand-navy" />
            <div className="px-6 py-5">
              <p className="font-display text-base font-bold text-brand-navy dark:text-white text-center mb-4">
                {locale !== 'en' ? 'Que voulez-vous faire?' : 'What would you like to do?'}
              </p>
              <div className="grid grid-cols-2 gap-3">
                <button
                  onClick={() => { setShowNextAction(false); openPanel() }}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-2xl',
                    'border-2 border-brand-navy/20 hover:border-brand-navy',
                    'bg-slate-50 dark:bg-white/[0.04] hover:bg-brand-navy/5',
                    'transition-all duration-150 group',
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-brand-navy/10 flex items-center justify-center group-hover:bg-brand-navy/20 transition-colors">
                    <svg className="w-5 h-5 text-brand-navy dark:text-white" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4"/>
                    </svg>
                  </div>
                  <span className="font-body text-xs font-semibold text-brand-navy dark:text-white text-center leading-tight">
                    {locale !== 'en' ? 'Assigner un autre terrain' : 'Assign another turf'}
                  </span>
                </button>
                <button
                  onClick={() => setShowNextAction(false)}
                  className={cn(
                    'flex flex-col items-center gap-2 p-4 rounded-2xl',
                    'border-2 border-slate-200/80 dark:border-white/[0.12] hover:border-slate-400',
                    'bg-slate-50 dark:bg-white/[0.04] hover:bg-slate-100 dark:hover:bg-white/[0.08]',
                    'transition-all duration-150 group',
                  )}
                >
                  <div className="w-10 h-10 rounded-full bg-slate-200/80 dark:bg-white/[0.08] flex items-center justify-center group-hover:bg-slate-300/80 transition-colors">
                    <svg className="w-5 h-5 text-slate-600 dark:text-white/70" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7"/>
                    </svg>
                  </div>
                  <span className="font-body text-xs font-semibold text-slate-700 dark:text-white/70 text-center leading-tight">
                    {locale !== 'en' ? 'Retour à la carte' : 'Back to map'}
                  </span>
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Swap supervisor modal */}
      {swapModal && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className={cn(
            'mx-4 w-full max-w-sm rounded-2xl overflow-hidden shadow-2xl',
            'bg-white dark:bg-[#12163a]',
            'border border-slate-200/80 dark:border-white/[0.08]',
          )}>
            <div className="h-1 bg-brand-teal" />
            <div className="px-5 py-5 space-y-4">
              <div>
                <p className="font-display font-bold text-brand-navy dark:text-white text-sm">
                  {locale !== 'en' ? 'Changer le superviseur' : 'Change supervisor'}
                </p>
                {swapModal.currentSupervisorName && (
                  <p className="font-body text-xs text-slate-500 dark:text-white/50 mt-0.5">
                    {locale !== 'en' ? 'Actuel' : 'Current'}: {swapModal.currentSupervisorName}
                  </p>
                )}
              </div>
              <div>
                <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
                  {locale !== 'en' ? 'Nouveau superviseur' : 'New supervisor'}
                </label>
                <select
                  value={swapNewSupId}
                  onChange={e => setSwapNewSupId(e.target.value)}
                  className={inputCls}
                >
                  <option value="">{locale !== 'en' ? 'Sélectionnez…' : 'Select…'}</option>
                  {allSupervisors.map(s => (
                    <option key={s.id} value={s.id}>{s.full_name || s.email}</option>
                  ))}
                </select>
              </div>
              {swapError && <p className="font-body text-xs text-brand-red">{swapError}</p>}
              {swapSuccess && (
                <p className="font-body text-xs text-brand-teal font-semibold">
                  {locale !== 'en' ? 'Superviseur mis à jour!' : 'Supervisor updated!'}
                </p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setSwapModal(null); setSwapError(''); setSwapSuccess(false) }}
                  className="flex-1 h-10 rounded-xl font-body text-sm font-semibold border border-slate-200 dark:border-white/[0.12] text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-colors"
                >
                  {locale !== 'en' ? 'Annuler' : 'Cancel'}
                </button>
                <button
                  onClick={async () => {
                    if (!swapNewSupId) return
                    setSwapping(true)
                    setSwapError('')
                    const result = await swapDailyZoneSupervisor(
                      swapModal.zoneId,
                      swapNewSupId,
                      swapModal.currentSupervisorId,
                      swapModal.zoneDate,
                    )
                    setSwapping(false)
                    if (result.error) {
                      setSwapError(result.error)
                    } else {
                      setSwapSuccess(true)
                      setTimeout(() => { setSwapModal(null); setSwapSuccess(false); router.refresh() }, 1200)
                    }
                  }}
                  disabled={swapping || !swapNewSupId}
                  className="flex-1 h-10 rounded-xl font-body text-sm font-semibold bg-brand-teal text-white hover:bg-brand-teal/90 disabled:opacity-60 transition-colors"
                >
                  {swapping ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin mx-auto" />
                  ) : (
                    locale !== 'en' ? 'Confirmer' : 'Confirm'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

      {/* Zone delete confirmation */}
      {zoneDeleteConfirm && (
        <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/40 backdrop-blur-sm">
          <div className={cn(
            'mx-4 w-full max-w-xs rounded-2xl overflow-hidden shadow-2xl',
            'bg-white dark:bg-[#12163a]',
            'border border-slate-200/80 dark:border-white/[0.08]',
          )}>
            <div className="h-1 bg-brand-red" />
            <div className="px-5 py-5 space-y-4">
              <div className="flex items-start gap-3">
                <div className="w-10 h-10 rounded-full bg-brand-red/10 flex items-center justify-center shrink-0">
                  <svg className="w-5 h-5 text-brand-red" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
                  </svg>
                </div>
                <div>
                  <p className="font-display font-bold text-brand-navy dark:text-white text-sm">
                    {locale !== 'en' ? 'Supprimer ce terrain?' : 'Delete this turf?'}
                  </p>
                  <p className="font-body text-xs text-slate-500 dark:text-white/50 mt-0.5">
                    {zoneDeleteConfirm.supervisorName ?? '—'} · {zoneDeleteConfirm.teamName}
                  </p>
                </div>
              </div>
              {deleteZoneError && (
                <p className="font-body text-xs text-brand-red">{deleteZoneError}</p>
              )}
              <div className="flex gap-2">
                <button
                  onClick={() => { setZoneDeleteConfirm(null); setDeleteZoneError('') }}
                  className="flex-1 h-10 rounded-xl font-body text-sm font-semibold border border-slate-200 dark:border-white/[0.12] text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-colors"
                >
                  {locale !== 'en' ? 'Annuler' : 'Cancel'}
                </button>
                <button
                  onClick={async () => {
                    setDeletingZone(true)
                    setDeleteZoneError('')
                    const result = await deleteDailyZone(zoneDeleteConfirm.zoneId)
                    setDeletingZone(false)
                    if (result.error) {
                      setDeleteZoneError(result.error)
                    } else {
                      setZoneDeleteConfirm(null)
                      router.refresh()
                    }
                  }}
                  disabled={deletingZone}
                  className="flex-1 h-10 rounded-xl font-body text-sm font-semibold bg-brand-red text-white hover:bg-brand-red/90 disabled:opacity-60 transition-colors"
                >
                  {deletingZone ? (
                    <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin mx-auto" />
                  ) : (
                    locale !== 'en' ? 'Confirmer' : 'Confirm'
                  )}
                </button>
              </div>
            </div>
          </div>
        </div>
      )}

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

      {/* Map style selector — bottom-center, hidden when panel is open on desktop */}
      {(!panelOpen || isTouch) && (
        <MapStyleSelector
          activeUrl={mapStyleUrl}
          onSelect={setMapStyle}
          locale={locale}
        />
      )}

      {/* Legend */}
      <div className={cn(
        'absolute bottom-8 left-4 z-10 p-3 rounded-xl shadow-card',
        'bg-white/90 dark:bg-[#12163a]/90 backdrop-blur-sm',
        'border border-slate-200/80 dark:border-white/[0.08]',
        'text-xs font-body space-y-1.5',
      )}>
        <div className="flex items-center gap-2">
          <div className="w-6 h-2 rounded-full bg-[#2E3192]/40 border border-[#2E3192]/60" />
          <span className="text-slate-600 dark:text-white/60">{t('legend_territories')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-[3px] rounded-full bg-[#22c55e]" />
          <span className="text-slate-600 dark:text-white/60">{t('legend_today')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-[4px] rounded-full bg-black" />
          <span className="text-slate-600 dark:text-white/60">{t('legend_barre')}</span>
        </div>
        <div className="flex items-center gap-2">
          <div className="w-6 h-[4px] rounded-full bg-[#f97316]" />
          <span className="text-slate-600 dark:text-white/60">{locale !== 'en' ? 'Hors zone' : 'Out-of-bounds'}</span>
        </div>
        {/* Recency opacity guide */}
        <div className="pt-1 border-t border-slate-200/60 dark:border-white/[0.06] space-y-1">
          <p className="text-[10px] text-slate-400 dark:text-white/30 uppercase tracking-wide">
            {locale !== 'en' ? 'Intensité = récence' : 'Darkness = recency'}
          </p>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-[3px] rounded-full bg-black opacity-100" />
            <span className="text-slate-500 dark:text-white/50">{locale !== 'en' ? 'Récent' : 'Recent'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-[3px] rounded-full bg-[#333333] opacity-60" />
            <span className="text-slate-400 dark:text-white/40">{locale !== 'en' ? '2e visite' : '2nd visit'}</span>
          </div>
          <div className="flex items-center gap-1.5">
            <div className="w-6 h-[3px] rounded-full bg-[#666666] opacity-35" />
            <span className="text-slate-400 dark:text-white/30">{locale !== 'en' ? 'Ancien' : 'Older'}</span>
          </div>
        </div>
        {/* Recall pins toggle */}
        <button
          onClick={() => setShowRecallPins(prev => !prev)}
          className="flex items-center gap-2 w-full text-left"
        >
          <div className={cn('w-5 h-5 rounded-full border-2 border-white shadow-sm flex items-center justify-center shrink-0', showRecallPins ? 'bg-brand-red' : 'bg-slate-300 dark:bg-white/20')}>
            <span className="text-white font-bold text-[8px] leading-none">!</span>
          </div>
          <span className={cn('transition-colors', showRecallPins ? 'text-brand-red font-semibold' : 'text-slate-400 dark:text-white/30')}>
            {locale !== 'en' ? 'Rappels' : 'Recalls'}
          </span>
        </button>
        {/* Period filter for terrain barré */}
        <div className="pt-1 border-t border-slate-200/60 dark:border-white/[0.06]">
          <p className="text-[10px] text-slate-400 dark:text-white/30 uppercase tracking-wide mb-1">
            {locale !== 'en' ? 'Période (terrain barré)' : 'Period (covered streets)'}
          </p>
          <select
            value={periodFilter}
            onChange={e => setPeriodFilter(e.target.value as 'quarter' | 'prev_quarter' | 'rolling_3mo' | 'all')}
            className="w-full text-[11px] rounded-lg px-2 py-1.5 bg-slate-100 dark:bg-white/[0.08] border border-slate-200 dark:border-white/10 text-slate-700 dark:text-white/70 focus:outline-none"
          >
            <option value="quarter">{locale !== 'en' ? 'Ce trimestre' : 'This quarter'}</option>
            <option value="prev_quarter">{locale !== 'en' ? 'Trimestre précédent' : 'Prev quarter'}</option>
            <option value="rolling_3mo">{locale !== 'en' ? '3 derniers mois' : 'Rolling 3 months'}</option>
            <option value="all">{locale !== 'en' ? 'Tout' : 'All time'}</option>
          </select>
        </div>
      </div>

      {/* Mobile map lock/unlock — positioned below the Assign Zone button */}
      {!panelOpen && isTouch && drawMode === 'idle' && (
        <button
          onClick={() => setMapLocked(prev => !prev)}
          className={cn(
            'absolute top-[64px] right-4 z-20',
            'flex items-center gap-2 px-3 h-9 rounded-xl',
            'backdrop-blur-sm border shadow-md',
            'font-body text-xs font-medium transition-colors',
            mapLocked
              ? 'bg-brand-navy/95 text-white border-white/10'
              : 'bg-brand-teal/90 text-white border-brand-teal/30',
          )}
        >
          {mapLocked ? (
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
          ) : (
            <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
            </svg>
          )}
          {mapLocked ? t('map_lock_activate') : t('map_lock_lock')}
        </button>
      )}

      {/* Mobile lock hint */}
      {showLockHint && (
        <div className={cn(
          'absolute inset-x-4 top-28 z-10',
          'flex items-center justify-center',
          'bg-brand-navy/90 backdrop-blur-sm text-white',
          'rounded-xl border border-white/10 shadow-lg',
          'px-4 py-3 pointer-events-none animate-fade-in',
        )}>
          <svg className="w-4 h-4 mr-2 shrink-0 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
            <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
            <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
          </svg>
          <p className="font-body text-xs">{t('map_lock_hint')}</p>
        </div>
      )}

      {/* ── MOBILE: Drawing mode overlay (floating buttons + thin bar) ─────── */}
      {isTouch && panelOpen && drawMode === 'drawing' && (
        <>
          {/* Drawing instruction banner */}
          <div className={cn(
            'absolute top-4 left-1/2 -translate-x-1/2 z-30',
            'flex items-center gap-2 px-4 py-2 rounded-xl',
            'bg-brand-navy/90 backdrop-blur-sm border border-white/10 shadow-lg',
            'pointer-events-none',
          )}>
            <svg className="w-3.5 h-3.5 shrink-0 text-brand-teal" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
            </svg>
            <span className="font-body text-xs text-white whitespace-nowrap">
              {locale !== 'en'
                ? 'Appuyez sur la carte pour tracer'
                : 'Tap the map to draw'}
            </span>
          </div>

          {/* Floating Undo (top-left, below nav) */}
          <button
            onClick={undoStreet}
            className={cn(
              'absolute top-16 left-4 z-30',
              'flex items-center gap-1.5 px-3 h-10 rounded-xl',
              'bg-white/95 dark:bg-[#12163a]/95 backdrop-blur-sm',
              'border border-slate-200/80 dark:border-white/[0.12] shadow-md',
              'font-body text-xs font-semibold text-slate-700 dark:text-white/80',
              'active:scale-[0.97] transition-transform',
            )}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M3 10h10a8 8 0 0 1 8 8v2M3 10l6 6M3 10l6-6" />
            </svg>
            {t('undo_street')}
          </button>

          {/* Floating Finish Street (top-right, below nav) */}
          <button
            onClick={finishStreet}
            disabled={currentLine.length < 2}
            className={cn(
              'absolute top-16 right-4 z-30',
              'flex items-center gap-1.5 px-3 h-10 rounded-xl',
              'bg-brand-navy/95 backdrop-blur-sm border border-white/10 shadow-md',
              'font-body text-xs font-semibold text-white',
              'active:scale-[0.97] disabled:opacity-50 transition-transform',
            )}
          >
            <svg className="w-3.5 h-3.5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
            </svg>
            {t('finish_street')}
          </button>

          {/* Thin bar at bottom — team + supervisor name + save */}
          <div className={cn(
            'absolute inset-x-0 bottom-0 z-30',
            'flex items-center justify-between px-4 gap-3',
            'h-16 bg-white dark:bg-[#12163a]',
            'border-t border-slate-200/80 dark:border-white/[0.08] shadow-2xl',
          )}>
            <div className="flex items-center gap-2 min-w-0">
              <div className="w-3 h-3 rounded-full shrink-0" style={{ backgroundColor: getColor(teamColorMap, formTeamId) }} />
              <div className="min-w-0">
                <p className="font-body text-[10px] text-slate-400 dark:text-white/40 uppercase tracking-wide leading-none mb-0.5">
                  {teams.find(tm => tm.id === formTeamId)?.name ?? '—'}
                </p>
                <p className="font-body text-sm font-semibold text-brand-navy dark:text-white truncate">
                  {formSupervisorIds.length === 0
                    ? '—'
                    : formSupervisorIds.length === 1
                      ? (supervisors.find(s => s.id === formSupervisorIds[0])?.full_name ?? supervisors.find(s => s.id === formSupervisorIds[0])?.email ?? '—')
                      : `${formSupervisorIds.length} superviseur${formSupervisorIds.length > 1 ? 's' : ''}`}
                </p>
              </div>
            </div>
            <div className="flex items-center gap-2 shrink-0">
              {(drawnStreets.length > 0 || currentLine.length >= 2) && (
                <span className="font-body text-xs text-slate-400 dark:text-white/40">
                  {drawnStreets.length + (currentLine.length >= 2 ? 1 : 0)} rue(s)
                </span>
              )}
              <button
                onClick={saveZone}
                disabled={saving || (drawnStreets.length === 0 && currentLine.length < 2 && !aiPreview?.length)}
                className={cn(
                  'flex items-center gap-1.5 px-4 h-10 rounded-xl',
                  'bg-brand-teal text-white font-body text-sm font-semibold',
                  'active:scale-[0.97] disabled:opacity-50 transition-transform',
                )}
              >
                {saving ? (
                  <div className="w-4 h-4 rounded-full border-2 border-white border-t-transparent animate-spin" />
                ) : (
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                )}
                {t('finish')}
              </button>
            </div>
          </div>
        </>
      )}

      {/* ── MOBILE: Setup bottom sheet (idle drawing setup) ───────────────── */}
      {isTouch && panelOpen && drawMode === 'idle' && (
        <div className={cn(
          'absolute inset-x-0 bottom-0 z-30',
          'rounded-t-3xl bg-white dark:bg-[#12163a]',
          'border-t border-slate-200/80 dark:border-white/[0.08] shadow-2xl',
          'max-h-[65vh] flex flex-col',
          'animate-slide-up',
        )}>
          {/* Drag handle */}
          <div className="flex justify-center pt-3 pb-1 shrink-0">
            <div className="w-10 h-1 rounded-full bg-slate-300 dark:bg-white/20" />
          </div>

          {/* Header */}
          <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200/60 dark:border-white/[0.07] shrink-0">
            <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">
              {t('panel_title')}
            </h2>
            <button onClick={closePanel} className="p-1.5 rounded-lg text-slate-400 hover:text-slate-600 dark:hover:text-white hover:bg-slate-100 dark:hover:bg-white/[0.06] transition-colors">
              <svg className="w-5 h-5" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
              </svg>
            </button>
          </div>

          {/* Form fields (scrollable) */}
          <div className="flex-1 overflow-y-auto px-5 py-4 space-y-4">
            {saveSuccess && (
              <div className="rounded-xl px-4 py-3 bg-brand-teal/10 border border-brand-teal/30 text-brand-teal font-body text-sm font-semibold flex items-center gap-2">
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {t('zone_saved')}
              </div>
            )}
            {saveError && (
              <div className="rounded-xl px-4 py-3 bg-brand-red/10 border border-brand-red/30 text-brand-red font-body text-sm">
                {saveError}
              </div>
            )}
            {/* Team */}
            <div>
              <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
                {t('team')} <span className="text-brand-red">*</span>
              </label>
              <select value={formTeamId} onChange={e => setFormTeamId(e.target.value)} className={inputCls}>
                <option value="">{t('team_placeholder')}</option>
                {teams.map(team => (
                  <option key={team.id} value={team.id}>{team.name}</option>
                ))}
              </select>
            </div>
            {/* Supervisor — multi-select checkboxes */}
            <div>
              <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
                {locale !== 'en' ? 'Superviseur(s)' : 'Supervisor(s)'} <span className="text-brand-red">*</span>
              </label>
              {loadingSups ? (
                <p className="font-body text-xs text-slate-400 dark:text-white/40 py-2">...</p>
              ) : !formTeamId ? (
                <p className="font-body text-xs text-slate-400 dark:text-white/40 py-2">
                  {locale !== 'en' ? 'Sélectionnez une équipe d\'abord' : 'Select a team first'}
                </p>
              ) : supervisors.length === 0 ? (
                <p className="font-body text-xs text-slate-400 dark:text-white/40 py-2">
                  {locale !== 'en' ? 'Aucun superviseur dans cette équipe' : 'No supervisors in this team'}
                </p>
              ) : (
                <div className="space-y-1.5">
                  {supervisors.map(s => (
                    <label key={s.id} className="flex items-center gap-2.5 cursor-pointer group">
                      <input
                        type="checkbox"
                        checked={formSupervisorIds.includes(s.id)}
                        onChange={e => setFormSupervisorIds(prev =>
                          e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id)
                        )}
                        className="w-4 h-4 rounded accent-brand-teal"
                      />
                      <span className="font-body text-sm text-slate-700 dark:text-white/80 group-hover:text-brand-navy dark:group-hover:text-white transition-colors">
                        {s.full_name || s.email}
                      </span>
                    </label>
                  ))}
                </div>
              )}
            </div>
            {/* Date */}
            <div>
              <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
                {t('date')} <span className="text-brand-red">*</span>
              </label>
              <input type="date" value={formDate} onChange={e => setFormDate(e.target.value)} className={inputCls} />
            </div>
            {/* Note */}
            <div>
              <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
                {t('note')}
              </label>
              <textarea rows={2} value={formNote} onChange={e => setFormNote(e.target.value)} placeholder={t('note_placeholder')} className={cn(inputCls, 'resize-none')} />
            </div>
          </div>

          {/* Footer */}
          <div className="px-5 py-4 border-t border-slate-200/60 dark:border-white/[0.07] space-y-2 shrink-0">
            {saveSuccess ? (
              <>
                <div className="rounded-xl px-4 py-3 bg-brand-teal/10 border border-brand-teal/30 text-brand-teal font-body text-sm font-semibold flex items-center gap-2">
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                  </svg>
                  {t('zone_saved')}
                </div>
                <button onClick={resetForAnotherZone} className={cn(btnPrimary, 'min-h-[48px]')}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                  </svg>
                  {locale !== 'en' ? 'Assigner une autre zone' : 'Assign another zone'}
                </button>
                <button onClick={closePanel} className={cn(btnGhost, 'min-h-[44px]')}>{t('cancel')}</button>
              </>
            ) : (
              <>
                <button onClick={startDrawing} className={cn(btnPrimary, 'min-h-[48px]')}>
                  <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M15.232 5.232l3.536 3.536m-2.036-5.036a2.5 2.5 0 113.536 3.536L6.5 21.036H3v-3.572L16.732 3.732z" />
                  </svg>
                  {t('start_drawing')}
                </button>
                <button onClick={closePanel} className={cn(btnGhost, 'min-h-[44px]')}>{t('cancel')}</button>
              </>
            )}
          </div>
        </div>
      )}

      {/* ── DESKTOP: Right-side assignment panel ─────────────────────────── */}
      {!isTouch && (
      <div className={cn(
        'absolute inset-y-0 right-0 z-30 w-96',
        'bg-white dark:bg-[#12163a]',
        'border-l border-slate-200/80 dark:border-white/[0.08]',
        'shadow-2xl flex flex-col',
        'transition-transform duration-300 ease-out',
        panelOpen ? 'translate-x-0' : 'translate-x-full',
      )}>

        {/* Panel header */}
        <div className="flex items-center justify-between px-5 py-4 border-b border-slate-200/60 dark:border-white/[0.07]">
          <h2 className="font-display text-base font-bold text-brand-navy dark:text-white">
            {editingZoneId ? (locale !== 'en' ? 'Modifier le terrain' : 'Edit turf') : t('panel_title')}
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

          {/* Team selector */}
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
            {formTeamId && (
              <div className="flex items-center gap-2 mt-2">
                <div className="w-4 h-4 rounded-full border-2 border-white shadow-sm" style={{ backgroundColor: getColor(teamColorMap, formTeamId) }} />
                <span className="font-body text-xs text-slate-500 dark:text-white/50">
                  {teams.find(tm => tm.id === formTeamId)?.name}
                </span>
              </div>
            )}
          </div>

          {/* Supervisor — multi-select checkboxes */}
          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {locale !== 'en' ? 'Superviseur(s)' : 'Supervisor(s)'} <span className="text-brand-red">*</span>
            </label>
            {loadingSups ? (
              <p className="font-body text-xs text-slate-400 dark:text-white/40 py-1">...</p>
            ) : !formTeamId ? (
              <p className="font-body text-xs text-slate-400 dark:text-white/40 py-1">
                {locale !== 'en' ? 'Sélectionnez une équipe d\'abord' : 'Select a team first'}
              </p>
            ) : supervisors.length === 0 ? (
              <p className="font-body text-xs text-slate-400 dark:text-white/40 py-1">
                {locale !== 'en' ? 'Aucun superviseur dans cette équipe' : 'No supervisors in this team'}
              </p>
            ) : (
              <div className={cn('space-y-1.5 rounded-xl p-3', 'bg-slate-50 border border-slate-200 dark:bg-white/[0.04] dark:border-white/10')}>
                {supervisors.map(s => (
                  <label key={s.id} className={cn('flex items-center gap-2.5 cursor-pointer group', drawMode === 'drawing' && 'pointer-events-none opacity-60')}>
                    <input
                      type="checkbox"
                      checked={formSupervisorIds.includes(s.id)}
                      onChange={e => setFormSupervisorIds(prev =>
                        e.target.checked ? [...prev, s.id] : prev.filter(id => id !== s.id)
                      )}
                      disabled={drawMode === 'drawing'}
                      className="w-4 h-4 rounded accent-brand-teal"
                    />
                    <span className="font-body text-sm text-slate-700 dark:text-white/80 group-hover:text-brand-navy dark:group-hover:text-white transition-colors">
                      {s.full_name || s.email}
                    </span>
                  </label>
                ))}
              </div>
            )}
          </div>

          {/* Date */}
          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {t('date')} <span className="text-brand-red">*</span>
            </label>
            <input
              type="date" value={formDate}
              onChange={e => setFormDate(e.target.value)}
              disabled={drawMode === 'drawing'}
              className={inputCls}
            />
          </div>

          {/* Note */}
          <div>
            <label className="block font-body text-xs font-semibold text-slate-500 dark:text-white/50 uppercase tracking-wide mb-1.5">
              {t('note')}
            </label>
            <textarea
              rows={2} value={formNote}
              onChange={e => setFormNote(e.target.value)}
              placeholder={t('note_placeholder')}
              className={cn(inputCls, 'resize-none')}
            />
          </div>

          {/* ── Drawing tools (only visible when drawing) ── */}
          {drawMode === 'drawing' && (
            <>
              {/* Hint */}
              <div className="rounded-xl px-4 py-3 bg-brand-teal/10 border border-brand-teal/25 font-body text-sm text-brand-teal flex items-start gap-2">
                <svg className="w-4 h-4 mt-0.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M13 16h-1v-4h-1m1-4h.01M21 12a9 9 0 11-18 0 9 9 0 0118 0z" />
                </svg>
                <span>
                  {locale !== 'en'
                    ? 'Cliquez sur la carte pour tracer les rues de l\'équipe'
                    : 'Click on the map to draw team streets'}
                </span>
              </div>

              {/* AI Street Assistant */}
              <div className={cn(
                'rounded-2xl border p-4 space-y-3',
                'bg-slate-50 border-slate-200 dark:bg-white/[0.03] dark:border-white/[0.07]',
              )}>
                <p className="font-body text-xs font-semibold text-slate-500 dark:text-white/40 uppercase tracking-wide">
                  {t('ai_title')}
                </p>

                <div className="flex gap-2">
                  <input
                    type="text"
                    value={aiInput}
                    onChange={e => setAiInput(e.target.value)}
                    onKeyDown={e => e.key === 'Enter' && handleAIDraw()}
                    placeholder={t('ai_placeholder')}
                    className={cn(inputCls, 'flex-1 text-xs py-2')}
                  />
                  {/* Mic button */}
                  <button
                    onClick={toggleVoice}
                    aria-label={t('mic_label')}
                    className={cn(
                      'w-9 h-9 rounded-xl flex items-center justify-center shrink-0',
                      isRecording
                        ? 'bg-brand-red text-white animate-pulse'
                        : 'bg-slate-200 text-slate-600 dark:bg-white/10 dark:text-white/60',
                      'transition-colors duration-150',
                    )}
                  >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                      <path strokeLinecap="round" strokeLinejoin="round" d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"/>
                      <path strokeLinecap="round" strokeLinejoin="round" d="M19 10v2a7 7 0 0 1-14 0v-2M12 19v4M8 23h8"/>
                    </svg>
                  </button>
                </div>

                {aiError && <p className="font-body text-xs text-brand-red">{aiError}</p>}

                {aiPreview ? (
                  <div className="flex gap-2">
                    <button onClick={confirmAIStreets} className={cn(btnSave, 'flex-1 py-2 text-xs')}>
                      {t('ai_confirm')} ({aiPreview.length})
                    </button>
                    <button onClick={retryAI} className={cn(btnGhost, 'flex-1 py-2 text-xs')}>
                      {t('ai_retry')}
                    </button>
                  </div>
                ) : (
                  <button
                    onClick={handleAIDraw}
                    disabled={aiPending || !aiInput.trim()}
                    className={cn(btnGhost, 'w-full py-2 text-xs')}
                  >
                    {aiPending ? t('ai_drawing') : t('ai_draw')}
                  </button>
                )}
              </div>

              {/* Streets drawn counter */}
              {totalDrawn > 0 && (
                <div className="flex items-center gap-2 px-3 py-2 rounded-lg bg-slate-100 dark:bg-white/[0.06]">
                  <svg className="w-4 h-4 text-brand-navy dark:text-brand-teal" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                    <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l4.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-.553-.894L15 4m0 13V4m0 0L9 7" />
                  </svg>
                  <span className="font-body text-sm text-slate-600 dark:text-white/60">
                    {totalDrawn} rue(s){currentLine.length > 0 ? ' + 1 en cours' : ''}
                  </span>
                </div>
              )}
            </>
          )}
        </div>

        {/* Panel footer */}
        <div className="px-5 py-4 border-t border-slate-200/60 dark:border-white/[0.07] space-y-2">
          {saveSuccess && drawMode === 'idle' ? (
            <>
              <div className="rounded-xl px-3 py-2.5 bg-brand-teal/10 border border-brand-teal/30 text-brand-teal font-body text-sm font-semibold flex items-center gap-2">
                <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M5 13l4 4L19 7" />
                </svg>
                {t('zone_saved')}
              </div>
              <button onClick={resetForAnotherZone} className={btnPrimary}>
                <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                  <path strokeLinecap="round" strokeLinejoin="round" d="M12 4v16m8-8H4" />
                </svg>
                {locale !== 'en' ? 'Assigner une autre zone' : 'Assign another zone'}
              </button>
              <button onClick={closePanel} className={btnGhost}>{t('cancel')}</button>
            </>
          ) : drawMode === 'idle' ? (
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
                  disabled={saving || (drawnStreets.length === 0 && currentLine.length < 2 && !aiPreview?.length)}
                  className={cn(btnSave, 'col-span-1')}
                >
                  {saving ? '...' : (editingZoneId ? (locale !== 'en' ? 'Enregistrer' : 'Save') : t('finish'))}
                </button>
              </div>
            </>
          )}
        </div>
      </div>
      )} {/* end !isTouch desktop panel */}

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
