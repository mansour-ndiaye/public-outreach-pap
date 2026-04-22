'use client'

import {
  useRef, useState, useCallback, useEffect, useMemo, useTransition, type RefObject,
} from 'react'
import { useRouter } from 'next/navigation'
import Map, {
  Source, Layer, Marker, NavigationControl, type MapRef, type MapMouseEvent,
} from 'react-map-gl/mapbox'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import nextDynamic from 'next/dynamic'
import { MapStyleSelector, useMapStyle } from '@/components/ui/MapStyleSelector'
import { BarrePopup } from '@/components/ui/BarrePopup'
import type { BarrePopupInfo } from '@/components/ui/BarrePopup'
import { PPHLeaderboard } from '@/components/ui/PPHLeaderboard'

const EodMiniMap = nextDynamic(() => import('@/components/ui/EodMiniMap'), { ssr: false })
import { submitEOD, deleteStreetFeature } from '@/lib/supabase/eod-actions'
import type { TerritoryRow } from '@/types'
import type { DailyZoneWithTeam } from '@/lib/supabase/zone-actions'
import type { EODEntry, RecallEntry } from '@/lib/supabase/eod-actions'

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

function pointInPolygon(point: [number, number], ring: number[][]): boolean {
  const [x, y] = point
  let inside = false
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const xi = ring[i][0], yi = ring[i][1]
    const xj = ring[j][0], yj = ring[j][1]
    if (((yi > y) !== (yj > y)) && (x < (xj - xi) * (y - yi) / (yj - yi) + xi)) {
      inside = !inside
    }
  }
  return inside
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
  todayEODs:        EODEntry[]
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
  todayEODs, eodHistory, pastStreets, teamPastStreets,
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

  // ── Out-of-bounds state ────────────────────────────────────────────────────
  const [outOfBoundsFlags, setOutOfBoundsFlags] = useState<boolean[]>([])
  const [currentLineOOB,   setCurrentLineOOB]   = useState(false)

  // ── EOD form state ─────────────────────────────────────────────────────────
  const [submittedEODs, setSubmittedEODs] = useState<EODEntry[]>(todayEODs)
  const [showNewForm,   setShowNewForm]   = useState(todayEODs.length === 0)
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
  const [barreHover, setBarreHover] = useState<(BarrePopupInfo & { lng: number; lat: number; entry_id?: string; feature_index?: number }) | null>(null)

  // ── Edit mode (delete terrain barré) ──────────────────────────────────────
  const router = useRouter()
  const [editMode,     setEditMode]     = useState(false)
  const [deleteTarget, setDeleteTarget] = useState<{ entryId: string; featureIndex: number; supervisorName: string; date: string } | null>(null)
  const [deleting,     setDeleting]     = useState(false)
  const [deleteError,  setDeleteError]  = useState('')

  // ── Tab navigation ─────────────────────────────────────────────────────────
  const [activeTab, setActiveTab] = useState<'dashboard' | 'ranking'>('dashboard')

  // ── History expand ─────────────────────────────────────────────────────────
  const [expandedEOD, setExpandedEOD]  = useState<string | null>(null)

  const [mapStyleUrl, setMapStyle] = useMapStyle(resolvedTheme)

  // ── Fullscreen map ─────────────────────────────────────────────────────────
  const [isMapFullscreen, setIsMapFullscreen] = useState(false)
  const mapContainerRef = useRef<HTMLDivElement>(null)

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

  // Covered streets GeoJSON (session) — stamped with out_of_bounds for layer filtering
  const coveredGeoJSON = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = coveredStreets.map((f, i) => ({
      ...f,
      properties: { ...f.properties, out_of_bounds: outOfBoundsFlags[i] ?? false },
    }))
    if (currentLine.length >= 2) {
      features.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: currentLine },
        properties: { out_of_bounds: currentLineOOB },
      })
    }
    if (aiPreview) features.push(...aiPreview)
    return { type: 'FeatureCollection', features }
  }, [coveredStreets, outOfBoundsFlags, currentLine, currentLineOOB, aiPreview])

  // Progress — based on ALL zones assigned to this supervisor today
  const progress = useMemo(() => {
    const assignedFeatures = todayZoneGeoJSON.features ?? []
    const submittedFeatures = submittedEODs.flatMap(e =>
      (e.covered_streets as GeoJSON.FeatureCollection | null)?.features ?? []
    )
    const all = [...coveredStreets, ...submittedFeatures]
    return computeProgress(all, assignedFeatures)
  }, [coveredStreets, submittedEODs, todayZoneGeoJSON])

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

  // ── Map handlers ───────────────────────────────────────────────────────────
  const handleMapClick = useCallback((e: MapMouseEvent) => {
    if (drawMode === 'drawing') {
      const { lng, lat } = e.lngLat
      const newPoint: [number, number] = [lng, lat]
      setCurrentLine(prev => [...prev, newPoint])
      if (!currentLineOOB && territory?.coordinates?.[0]) {
        if (!pointInPolygon(newPoint, territory.coordinates[0])) {
          setCurrentLineOOB(true)
        }
      }
      return
    }
    if (editMode && drawMode === 'idle') {
      const map = mapRef.current?.getMap()
      if (!map) return
      const features = map.queryRenderedFeatures(e.point, {
        layers: ['past-streets-line', 'team-past-streets-line'],
      })
      if (features.length > 0) {
        const p = features[0].properties ?? {}
        const entryId = p.entry_id as string | undefined
        const featureIndex = p.feature_index != null ? Number(p.feature_index) : undefined
        if (entryId != null && featureIndex != null) {
          setDeleteTarget({
            entryId,
            featureIndex,
            supervisorName: p.supervisor_name ?? '',
            date:           p.entry_date ?? '',
          })
          setBarreHover(null)
        }
      }
    }
  }, [drawMode, editMode])

  const handleBarreMouseMove = useCallback((e: MapMouseEvent) => {
    if (drawMode === 'drawing') return
    const map = mapRef.current?.getMap()
    if (!map) return
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['past-streets-line', 'team-past-streets-line'],
    })
    if (features.length > 0) {
      const p = features[0].properties ?? {}
      setBarreHover({
        supervisor_name:  p.supervisor_name  ?? '',
        team_name:        p.team_name        ?? null,
        date:             p.entry_date       ?? '',
        pph:              Number(p.pph)      || 0,
        canvas_hours:     p.canvas_hours != null ? Number(p.canvas_hours) : null,
        pac_count:        Number(p.pac_count)        || 0,
        pac_total_amount: Number(p.pac_total_amount) || 0,
        pfu:              Number(p.pfu)              || 0,
        recalls_count:    Number(p.recalls_count)    || 0,
        note:             p.note ?? null,
        streets_count:    Number(p.streets_count)    || 0,
        out_of_bounds:    p.out_of_bounds === true,
        lng:              e.lngLat.lng,
        lat:              e.lngLat.lat,
        entry_id:         p.entry_id  ?? undefined,
        feature_index:    p.feature_index != null ? Number(p.feature_index) : undefined,
      })
      setCursor(editMode ? 'pointer' : 'pointer')
    } else {
      setBarreHover(null)
      setCursor('grab')
    }
  }, [drawMode, editMode])

  useEffect(() => {
    setCursor(drawMode === 'drawing' ? 'crosshair' : 'grab')
  }, [drawMode])

  useEffect(() => {
    if (!isMapFullscreen) return
    const handleKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') setIsMapFullscreen(false)
    }
    window.addEventListener('keydown', handleKey)
    return () => window.removeEventListener('keydown', handleKey)
  }, [isMapFullscreen])

  const finishStreet = () => {
    if (currentLine.length < 2) return
    setCoveredStreets(prev => [...prev, {
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: currentLine },
      properties: {},
    }])
    setOutOfBoundsFlags(prev => [...prev, currentLineOOB])
    setCurrentLine([])
    setCurrentLineOOB(false)
  }

  const undoStreet = () => {
    if (currentLine.length > 0) {
      setCurrentLine([])
      setCurrentLineOOB(false)
    } else {
      setCoveredStreets(prev => prev.slice(0, -1))
      setOutOfBoundsFlags(prev => prev.slice(0, -1))
    }
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

    // Include in-progress line, stamp out_of_bounds on each feature
    const allStreets: GeoJSON.Feature[] = coveredStreets.map((f, i) => ({
      ...f,
      properties: { ...f.properties, out_of_bounds: outOfBoundsFlags[i] ?? false },
    }))
    if (currentLine.length >= 2) {
      allStreets.push({
        type: 'Feature',
        geometry: { type: 'LineString', coordinates: currentLine },
        properties: { out_of_bounds: currentLineOOB },
      })
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
        supervisorName:   supervisorName,
        teamName:         teamName,
      })

      if (result.error) {
        setFormError(result.error)
      } else {
        setSubmitSuccess(true)
        const newEntry: EODEntry = {
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
        }
        setSubmittedEODs(prev => [...prev, newEntry])
        setShowNewForm(false)
        setCoveredStreets([])
        setCurrentLine([])
        setOutOfBoundsFlags([])
        setCurrentLineOOB(false)
        setCanvasHours('')
        setPacAmount('')
        setPacCount('')
        setRecalls([])
        setPfu('')
        setFieldNote('')
      }
    })
  }

  // Group history by date for display (exclude today since shown separately above)
  const groupedHistory = useMemo(() => {
    const groups: Record<string, EODEntry[]> = {}
    for (const entry of eodHistory) {
      if (entry.entry_date === todayDate) continue
      const d = entry.entry_date ?? 'unknown'
      if (!groups[d]) groups[d] = []
      groups[d].push(entry)
    }
    return Object.entries(groups).sort(([a], [b]) => b.localeCompare(a))
  }, [eodHistory, todayDate])

  const handleSubmitAnother = () => {
    setShowNewForm(true)
    setDrawMode('idle')
    setCoveredStreets([])
    setCurrentLine([])
    setOutOfBoundsFlags([])
    setCurrentLineOOB(false)
    setCanvasHours('')
    setPacAmount('')
    setPacCount('')
    setRecalls([])
    setPfu('')
    setFieldNote('')
    setFormError('')
    setSubmitSuccess(false)
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
              'px-4 min-h-[44px] font-body text-sm font-semibold transition-colors',
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
        <div
          ref={mapContainerRef}
          className={cn(
            'relative overflow-hidden transition-[border-radius] duration-200',
            isMapFullscreen
              ? 'fixed inset-0 z-50 rounded-none bg-black'
              : 'rounded-2xl border border-slate-200/80 dark:border-white/[0.07] shadow-card h-[260px] sm:h-[380px]',
          )}
        >
          <Map
            ref={mapRef}
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{ longitude: mapCenter[0], latitude: mapCenter[1], zoom: 13 }}
            style={{ width: '100%', height: '100%' }}
            mapStyle={mapStyleUrl}
            cursor={editMode ? (barreHover ? 'pointer' : 'default') : cursor}
            onClick={handleMapClick}
            onMouseMove={handleBarreMouseMove}
            onMouseLeave={() => { setBarreHover(null); setCursor(drawMode === 'drawing' ? 'crosshair' : 'grab' as string) }}
          >
            <NavigationControl position="top-right" />

            {/* Territory polygon */}
            <Source id="territory" type="geojson" data={territoryGeoJSON}>
              <Layer id="territory-fill" type="fill" paint={{ 'fill-color': '#2E3192', 'fill-opacity': 0.08 }} />
              <Layer id="territory-line" type="line" paint={{ 'line-color': '#2E3192', 'line-width': 1.5, 'line-opacity': 0.5 }} />
            </Source>

            {/* Terrain barré — all covered streets in black #000000 */}
            <Source id="past-streets" type="geojson" data={pastStreets}>
              <Layer id="past-streets-line" type="line" paint={{ 'line-color': '#000000', 'line-width': 2, 'line-opacity': 0.85 }} />
            </Source>

            {/* Other supervisors' terrain barré — also black */}
            <Source id="team-past-streets" type="geojson" data={filteredTeamPastStreets}>
              <Layer id="team-past-streets-line" type="line" paint={{ 'line-color': '#000000', 'line-width': 2, 'line-opacity': 0.85 }} />
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

            {/* Drawing in progress — orange for in-bounds, red for out-of-bounds */}
            <Source id="covered" type="geojson" data={coveredGeoJSON}>
              <Layer
                id="covered-line"
                type="line"
                filter={['!=', true, ['coalesce', ['get', 'out_of_bounds'], false]]}
                paint={{ 'line-color': '#f97316', 'line-width': 4, 'line-opacity': 0.95 }}
              />
              <Layer
                id="covered-oob-line"
                type="line"
                filter={['==', true, ['get', 'out_of_bounds']]}
                paint={{ 'line-color': '#ef4444', 'line-width': 4, 'line-opacity': 0.95 }}
              />
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

            {/* Terrain barré hover popup — hide in edit mode (click to delete instead) */}
            {barreHover && !editMode && (
              <Marker longitude={barreHover.lng} latitude={barreHover.lat} anchor="bottom">
                <BarrePopup info={barreHover} onClose={() => setBarreHover(null)} />
              </Marker>
            )}
          </Map>

          {/* Edit mode toggle button */}
          {drawMode === 'idle' && (
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

          {/* Edit mode hint banner */}
          {editMode && (
            <div className={cn(
              'absolute top-4 left-1/2 -translate-x-1/2 z-20',
              'flex items-center gap-2 px-4 py-2 rounded-xl',
              'bg-brand-red/90 backdrop-blur-sm text-white',
              'font-body text-xs pointer-events-none whitespace-nowrap',
            )}>
              <svg className="w-3.5 h-3.5 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M19 7l-.867 12.142A2 2 0 0116.138 21H7.862a2 2 0 01-1.995-1.858L5 7m5 4v6m4-6v6m1-10V4a1 1 0 00-1-1h-4a1 1 0 00-1 1v3M4 7h16"/>
              </svg>
              {locale !== 'en' ? 'Touchez une rue pour la supprimer' : 'Tap a street to remove it'}
            </div>
          )}

          {/* Map style selector (inside map container) */}
          <MapStyleSelector
            activeUrl={mapStyleUrl}
            onSelect={setMapStyle}
          />

          {/* Fullscreen toggle button */}
          <button
            onClick={() => setIsMapFullscreen(prev => !prev)}
            aria-label={isMapFullscreen
              ? (locale !== 'en' ? 'Réduire la carte' : 'Exit fullscreen')
              : (locale !== 'en' ? 'Agrandir la carte' : 'Fullscreen')}
            className={cn(
              'absolute right-2 z-20 transition-[bottom] duration-200',
              isMapFullscreen && showNewForm && todayZones.length > 0 && !isTouch
                ? 'bottom-[60px]'
                : 'bottom-2',
              'w-9 h-9 rounded-xl flex items-center justify-center',
              'bg-white/95 dark:bg-[#12163a]/95',
              'border border-slate-200/80 dark:border-white/[0.12]',
              'shadow-md backdrop-blur-sm',
              'text-slate-700 dark:text-white/80',
              'hover:bg-slate-50 dark:hover:bg-white/[0.1]',
            )}
          >
            {isMapFullscreen ? (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3v3a2 2 0 0 1-2 2H3M21 8h-3a2 2 0 0 1-2-2V3M3 16h3a2 2 0 0 1 2 2v3M16 21v-3a2 2 0 0 1 2-2h3"/>
              </svg>
            ) : (
              <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>
              </svg>
            )}
          </button>

          {/* Fullscreen in-map drawing controls — desktop only (mobile uses fixed bar) */}
          {isMapFullscreen && !isTouch && showNewForm && todayZones.length > 0 && (
            <div className={cn(
              'absolute bottom-0 left-0 right-0 z-20',
              'flex items-center gap-2 px-4 py-3',
              'bg-white/95 dark:bg-[#12163a]/95 backdrop-blur-sm',
              'border-t border-slate-200/80 dark:border-white/[0.08] shadow-2xl',
            )}>
              {drawMode === 'idle' ? (
                <button onClick={() => setDrawMode('drawing')} className={cn(btnPrimary, 'flex-1 min-h-[44px]')}>
                  <IconPencil />{t('map.draw_hint')}
                </button>
              ) : (
                <>
                  <button onClick={finishStreet} disabled={currentLine.length < 2} className={cn(btnPrimary, 'flex-1 min-h-[44px]')}>
                    <IconCheck />{t('map.finish_street')}
                  </button>
                  <button onClick={undoStreet} className={cn(btnGhost, 'flex-1 min-h-[44px]')}>
                    {t('map.undo_street')}
                  </button>
                  <button onClick={() => { setDrawMode('idle'); setCurrentLine([]) }} className={cn(btnGhost, 'min-h-[44px] px-4')}>✕</button>
                </>
              )}
              {coveredStreets.length > 0 && (
                <span className="ml-auto font-body text-xs text-slate-500 dark:text-white/40 whitespace-nowrap">
                  {coveredStreets.length} {t('history.streets_drawn')}
                </span>
              )}
            </div>
          )}

          {/* Delete confirmation dialog */}
          {deleteTarget && (
            <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/40 backdrop-blur-sm">
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
                        {locale !== 'en' ? 'Supprimer cette rue barrée?' : 'Remove this covered street?'}
                      </p>
                      {deleteTarget.supervisorName && (
                        <p className="font-body text-xs text-slate-500 dark:text-white/50 mt-0.5">
                          {deleteTarget.supervisorName}
                          {deleteTarget.date ? ` — ${deleteTarget.date}` : ''}
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
        </div>

        {/* Out-of-bounds warning banner */}
        {(outOfBoundsFlags.some(Boolean) || currentLineOOB) && (
          <div className="flex items-center gap-2 mt-2 px-4 py-2.5 rounded-xl bg-brand-red/10 border border-brand-red/20 text-brand-red font-body text-sm">
            <svg className="w-4 h-4 shrink-0" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M12 9v2m0 4h.01m-6.938 4h13.856c1.54 0 2.502-1.667 1.732-3L13.732 4c-.77-1.333-2.694-1.333-3.464 0L3.34 16c-.77 1.333.192 3 1.732 3z"/>
            </svg>
            {locale !== 'en'
              ? 'Certaines rues sont hors du territoire assigné'
              : 'Some streets are outside the assigned territory'}
          </div>
        )}

        {/* Legend + Team Toggle */}
        <div className="flex items-start justify-between gap-2 mt-3 px-1">
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1.5">
            {[
              { color: '#2E3192', label: t('map.legend_territory') },
              { color: '#22c55e', label: t('map.legend_assigned_own') },
              { color: '#ef4444', label: t('map.legend_assigned_others') },
              { color: '#000000', label: t('map.legend_barre') },
              { color: '#f97316', label: locale !== 'en' ? 'Tracé en cours' : 'In progress' },
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
                  'flex items-center gap-1.5 px-3 min-h-[44px] rounded-xl font-body text-xs font-semibold shrink-0',
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
        {showNewForm && todayZones.length === 0 && (
          <div className="mt-4 rounded-2xl border border-slate-200 dark:border-white/[0.07] px-4 py-3 font-body text-sm text-slate-500 dark:text-white/40">
            {t('map.no_turf_assigned')}
          </div>
        )}
        {showNewForm && todayZones.length > 0 && (
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
                    'w-11 h-11 rounded-xl flex items-center justify-center shrink-0',
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

        {submittedEODs.length > 0 && !showNewForm ? (
          /* Already submitted today — show last + allow another */
          (() => {
            const last = submittedEODs[submittedEODs.length - 1]
            return (
              <div className={cn('rounded-2xl border border-brand-teal/30 bg-brand-teal/10 p-6 space-y-4')}>
                <div className="flex items-center justify-between gap-3">
                  <div className="flex items-center gap-3">
                    <div className="w-10 h-10 rounded-full bg-brand-teal flex items-center justify-center text-white shrink-0">
                      <IconCheck />
                    </div>
                    <div>
                      <p className="font-display font-bold text-brand-teal">{t('eod.submitted_title')}</p>
                      {submittedEODs.length > 1 && (
                        <span className="inline-flex px-2 py-0.5 rounded-full bg-brand-teal/20 text-brand-teal font-body text-[11px] font-semibold mt-0.5">
                          {submittedEODs.length} {locale !== 'en' ? 'rapports aujourd\'hui' : 'reports today'}
                        </span>
                      )}
                    </div>
                  </div>
                </div>
                <div className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                  {[
                    { label: 'PPH', value: last.pph.toFixed(2) },
                    { label: t('eod.canvas_hours'), value: `${last.canvas_hours ?? 0}h` },
                    { label: 'PAC $', value: `$${last.pac_total_amount}` },
                    { label: t('eod.recalls'), value: String(last.recalls?.length ?? last.recalls_count ?? 0) },
                    { label: t('eod.pfu'), value: String(last.pfu ?? 0) },
                  ].map(({ label, value }) => (
                    <div key={label} className="rounded-xl bg-white/50 dark:bg-white/[0.05] p-3">
                      <p className="font-body text-[10px] text-slate-500 dark:text-white/40 uppercase tracking-wide">{label}</p>
                      <p className="font-display text-lg font-bold text-brand-navy dark:text-white">{value}</p>
                    </div>
                  ))}
                </div>
                <EodMiniMap
                  coveredStreets={last.covered_streets as GeoJSON.FeatureCollection | null}
                  locale={locale}
                  height={120}
                  supervisorName={supervisorName}
                  teamName={teamName}
                  date={todayDate}
                />
                {last.note && (
                  <p className="font-body text-sm text-slate-600 dark:text-white/60 italic">"{last.note}"</p>
                )}
                <button
                  onClick={handleSubmitAnother}
                  className={cn(btnGhost, 'w-full min-h-[44px]')}
                >
                  {locale !== 'en' ? '+ Soumettre un autre rapport' : '+ Submit another report'}
                </button>
              </div>
            )
          })()
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

        {groupedHistory.length === 0 ? (
          <p className="font-body text-sm text-slate-500 dark:text-white/40">{t('history.empty')}</p>
        ) : (
          <div className="space-y-4">
            {groupedHistory.map(([date, entries]) => (
              <div key={date} className="space-y-2">
                {entries.length > 1 && (
                  <div className="flex items-center gap-2 px-1">
                    <span className="font-body text-xs font-semibold text-slate-500 dark:text-white/40">
                      {formatDate(date)}
                    </span>
                    <span className="px-1.5 py-0.5 rounded-full bg-brand-teal/10 text-brand-teal font-body text-[10px] font-bold">
                      {entries.length} {locale !== 'en' ? 'rapports' : 'reports'}
                    </span>
                  </div>
                )}
                {entries.map(entry => {
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
                      <button
                        onClick={() => setExpandedEOD(isExpanded ? null : entry.id)}
                        className="w-full flex items-center justify-between px-5 py-4 text-left hover:bg-slate-50 dark:hover:bg-white/[0.03] transition-colors"
                      >
                        <div className="flex items-center gap-4">
                          <span className="font-body text-sm font-semibold text-brand-navy dark:text-white whitespace-nowrap">
                            {entries.length > 1
                              ? `Rapport ${entries.indexOf(entry) + 1}`
                              : (entry.entry_date ? formatDate(entry.entry_date) : '—')}
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
                          <EodMiniMap
                            coveredStreets={fc}
                            locale={locale}
                            height={120}
                            supervisorName={supervisorName}
                            teamName={teamName}
                            date={entry.entry_date ?? undefined}
                          />
                          {streetCount > 0 && (
                            <p className="font-body text-xs text-slate-400 dark:text-white/30">
                              {streetCount} {t('history.streets_drawn')}
                            </p>
                          )}
                          {entry.note && (
                            <p className="font-body text-sm text-slate-600 dark:text-white/60 italic">
                              "{entry.note.length > 80 ? entry.note.slice(0, 80) + '…' : entry.note}"
                            </p>
                          )}
                          <RecallsDisplay recalls={entry.recalls} locale={locale} />
                        </div>
                      )}
                    </div>
                  )
                })}
              </div>
            ))}
          </div>
        )}
      </section>

      </>}

      {/* ── MOBILE drawing bar: fixed bottom bar when drawing on touch device ── */}
      {isTouch && drawMode === 'drawing' && showNewForm && (
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
