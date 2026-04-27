'use client'

import {
  useRef, useState, useCallback, useEffect, useMemo,
} from 'react'
import { useRouter } from 'next/navigation'
import Map, {
  Source,
  Layer,
  Marker,
  Popup,
  type MapRef,
  type MapMouseEvent,
  NavigationControl,
} from 'react-map-gl/mapbox'
import { useTheme } from 'next-themes'
import { useTranslations } from 'next-intl'
import { cn } from '@/lib/utils'
import { MapStyleSelector, useMapStyle } from '@/components/ui/MapStyleSelector'
import { BarrePopup } from '@/components/ui/BarrePopup'
import { deleteStreetFeature } from '@/lib/supabase/eod-actions'
import { updateTerritory } from '@/lib/supabase/territory-actions'
import type { TerritoryRow, TeamRow } from '@/types'
import { SaveTerritoryModal } from './SaveTerritoryModal'
import { DeleteTerritoryModal } from './DeleteTerritoryModal'

// ── Types ──────────────────────────────────────────────────────────────────────
type DrawMode = 'idle' | 'click' | 'freehand'

// ── Constants ──────────────────────────────────────────────────────────────────
const STATUS_COLORS: Record<string, string> = {
  active:   '#22c55e',
  pending:  '#eab308',
  inactive: '#6b7280',
}

const MONTREAL: [number, number] = [-73.5673, 45.5017]

// ── RDP path simplification (for freehand) ────────────────────────────────────
function perpendicularDist(
  p: [number, number],
  a: [number, number],
  b: [number, number],
): number {
  const dx = b[0] - a[0]
  const dy = b[1] - a[1]
  const lenSq = dx * dx + dy * dy
  if (lenSq === 0) return Math.hypot(p[0] - a[0], p[1] - a[1])
  const t = ((p[0] - a[0]) * dx + (p[1] - a[1]) * dy) / lenSq
  return Math.hypot(p[0] - (a[0] + t * dx), p[1] - (a[1] + t * dy))
}

function rdpSimplify(pts: [number, number][], tol: number): [number, number][] {
  if (pts.length < 3) return pts
  let maxD = 0, maxI = 0
  for (let i = 1; i < pts.length - 1; i++) {
    const d = perpendicularDist(pts[i], pts[0], pts[pts.length - 1])
    if (d > maxD) { maxD = d; maxI = i }
  }
  if (maxD > tol) {
    const l = rdpSimplify(pts.slice(0, maxI + 1), tol)
    const r = rdpSimplify(pts.slice(maxI), tol)
    return [...l.slice(0, -1), ...r]
  }
  return [pts[0], pts[pts.length - 1]]
}

// ── GeoJSON helpers ───────────────────────────────────────────────────────────
function territoriesToGeoJSON(
  territories: TerritoryRow[],
  selectedId: string | null,
): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: territories
      .filter(t => t.coordinates && t.coordinates.length > 0)
      .map(t => ({
        type: 'Feature' as const,
        id: t.id,
        geometry: { type: 'Polygon' as const, coordinates: t.coordinates! },
        properties: {
          id: t.id,
          name: t.name,
          status: t.status,
          sector: t.sector,
          color: STATUS_COLORS[t.status] ?? '#6b7280',
          selected: t.id === selectedId,
        },
      })),
  }
}

function previewGeoJSON(
  pts: [number, number][],
  hover: [number, number] | null,
  freehand: [number, number][],
): GeoJSON.FeatureCollection {
  const features: GeoJSON.Feature[] = []

  if (freehand.length >= 2) {
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: freehand },
      properties: { kind: 'freehand' },
    })
  }

  if (pts.length >= 2) {
    const line: [number, number][] = hover
      ? [...pts, hover]
      : pts
    features.push({
      type: 'Feature',
      geometry: { type: 'LineString', coordinates: line },
      properties: { kind: 'draft-line' },
    })
  }

  if (pts.length >= 3 && hover) {
    features.push({
      type: 'Feature',
      geometry: {
        type: 'Polygon',
        coordinates: [[...pts, hover, pts[0]]],
      },
      properties: { kind: 'draft-fill' },
    })
  }

  return { type: 'FeatureCollection', features }
}

function polygonCentroid(rings: number[][][]): [number, number] {
  const coords = rings[0] as [number, number][]
  const lngs = coords.map(c => c[0])
  const lats = coords.map(c => c[1])
  return [
    (Math.min(...lngs) + Math.max(...lngs)) / 2,
    (Math.min(...lats) + Math.max(...lats)) / 2,
  ]
}

// ── Component ──────────────────────────────────────────────────────────────────
interface Props {
  territories:       TerritoryRow[]
  teams:             TeamRow[]
  allCoveredStreets?: GeoJSON.FeatureCollection
  locale?:           string
}

export function TerritoriesMap({ territories: initialTerritories, teams, allCoveredStreets, locale }: Props) {
  const mapRef = useRef<MapRef>(null)
  const router = useRouter()
  const { resolvedTheme } = useTheme()
  const t = useTranslations('admin.territories')

  // ── Core state ───────────────────────────────────────────────────────────────
  const [territories, setTerritories] = useState<TerritoryRow[]>(initialTerritories)
  const [selectedId, setSelectedId] = useState<string | null>(null)
  const [mapLoaded, setMapLoaded] = useState(false)
  const [isTouch, setIsTouch] = useState(false)
  const [sidebarOpen, setSidebarOpen] = useState(false) // mobile sidebar toggle
  const [mapLocked, setMapLocked] = useState(true)      // mobile: locked by default
  const [showLockHint, setShowLockHint] = useState(false)

  // ── Drawing state ────────────────────────────────────────────────────────────
  const [drawMode, setDrawMode] = useState<DrawMode>('idle')
  const [draftPoints, setDraftPoints] = useState<[number, number][]>([])
  const [hoverLngLat, setHoverLngLat] = useState<[number, number] | null>(null)
  const [freehandPath, setFreehandPath] = useState<[number, number][]>([])
  const [saveCoords, setSaveCoords] = useState<number[][][] | null>(null)
  const [deleteTarget, setDeleteTarget] = useState<TerritoryRow | null>(null)
  const [tooltipInfo, setTooltipInfo] = useState<{ name: string; lng: number; lat: number } | null>(null)
  const [barreHover, setBarreHover] = useState<{
    supervisor_name: string; team_name: string | null; date: string
    pph: number; canvas_hours: number | null; pac_count: number; pac_total_amount: number
    pfu: number; recalls_count: number; note: string | null; streets_count: number
    out_of_bounds?: boolean | 'soft' | 'hard'
    visits?: import('@/components/ui/BarrePopup').VisitEntry[]
    lng: number; lat: number
    entry_id?: string; feature_index?: number
  } | null>(null)

  // Quick-edit / polygon redraw state
  const [editingTerritoryId, setEditingTerritoryId] = useState<string | null>(null)
  const [sidebarToast, setSidebarToast] = useState<string | null>(null)
  const showSidebarToast = (msg: string) => {
    setSidebarToast(msg)
    setTimeout(() => setSidebarToast(null), 2500)
  }

  // Edit mode (delete terrain barré)
  const [editMode,           setEditMode]           = useState(false)
  const [streetDeleteTarget, setStreetDeleteTarget] = useState<{ entryId: string; featureIndex: number; supervisorName: string; date: string } | null>(null)
  const [streetDeleting,     setStreetDeleting]     = useState(false)
  const [streetDeleteError,  setStreetDeleteError]  = useState('')

  // ── Refs for freehand (avoid stale closures in raw event handlers) ───────────
  const freehandRef = useRef<{ drawing: boolean; pts: [number, number][] }>({
    drawing: false,
    pts: [],
  })
  const clickTimer = useRef<ReturnType<typeof setTimeout>>()
  const lastClickMs = useRef(0)

  const [mapStyleUrl, setMapStyle] = useMapStyle(resolvedTheme)

  // ── Detect touch device ───────────────────────────────────────────────────────
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

  // ── Clear tooltip when leaving idle mode ─────────────────────────────────────
  useEffect(() => {
    if (drawMode !== 'idle') setTooltipInfo(null)
  }, [drawMode])

  // ── ESC → cancel drawing ──────────────────────────────────────────────────────
  useEffect(() => {
    if (drawMode === 'idle') return
    const handler = (e: KeyboardEvent) => { if (e.key === 'Escape') cancelDraw() }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [drawMode]) // eslint-disable-line

  // ── Disable double-click zoom while drawing ───────────────────────────────────
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded) return
    if (drawMode !== 'idle') {
      map.doubleClickZoom.disable()
    } else {
      map.doubleClickZoom.enable()
    }
  }, [drawMode, mapLoaded])

  // ── Mobile map lock/unlock ────────────────────────────────────────────────────
  useEffect(() => {
    const map = mapRef.current?.getMap()
    if (!map || !mapLoaded || !isTouch) return
    // During drawing the map must be interactive; otherwise respect mapLocked
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

  // ── Freehand: raw canvas event listeners (desktop only) ───────────────────────
  useEffect(() => {
    if (drawMode !== 'freehand' || !mapLoaded || isTouch) return
    const map = mapRef.current?.getMap()
    if (!map) return
    const canvas = map.getCanvas()

    const onMouseDown = (e: MouseEvent) => {
      e.preventDefault()
      freehandRef.current = { drawing: true, pts: [] }
      setFreehandPath([])
      map.dragPan.disable()
      const rect = canvas.getBoundingClientRect()
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
      freehandRef.current.pts = [[ll.lng, ll.lat]]
    }

    const onMouseMove = (e: MouseEvent) => {
      if (!freehandRef.current.drawing) return
      const rect = canvas.getBoundingClientRect()
      const ll = map.unproject([e.clientX - rect.left, e.clientY - rect.top])
      freehandRef.current.pts.push([ll.lng, ll.lat])
      // throttle setState to every ~5 points for perf
      if (freehandRef.current.pts.length % 5 === 0) {
        setFreehandPath([...freehandRef.current.pts])
      }
    }

    const onMouseUp = () => {
      if (!freehandRef.current.drawing) return
      freehandRef.current.drawing = false
      map.dragPan.enable()
      const pts = freehandRef.current.pts
      setFreehandPath([])
      if (pts.length >= 6) {
        const simplified = rdpSimplify(pts, 0.00008)
        if (simplified.length >= 3) {
          setSaveCoords([[...simplified, simplified[0]]])
        }
      }
      freehandRef.current = { drawing: false, pts: [] }
    }

    canvas.addEventListener('mousedown', onMouseDown, { capture: true })
    document.addEventListener('mousemove', onMouseMove)
    document.addEventListener('mouseup', onMouseUp)

    return () => {
      canvas.removeEventListener('mousedown', onMouseDown, { capture: true } as EventListenerOptions)
      document.removeEventListener('mousemove', onMouseMove)
      document.removeEventListener('mouseup', onMouseUp)
      map.dragPan.enable()
    }
  }, [drawMode, mapLoaded, isTouch])

  // ── Drawing actions ───────────────────────────────────────────────────────────
  const startClickMode = useCallback(() => {
    setDrawMode('click')
    setDraftPoints([])
    setHoverLngLat(null)
    setSelectedId(null)
    if (isTouch) setSidebarOpen(false)
  }, [isTouch])

  const startFreehandMode = useCallback(() => {
    setDrawMode('freehand')
    setFreehandPath([])
    setSelectedId(null)
  }, [])

  const cancelDraw = useCallback(() => {
    clearTimeout(clickTimer.current)
    setDrawMode('idle')
    setDraftPoints([])
    setHoverLngLat(null)
    setFreehandPath([])
    freehandRef.current = { drawing: false, pts: [] }
  }, [])

  const undoLastPoint = useCallback(() => {
    setDraftPoints(prev => prev.slice(0, -1))
  }, [])

  const finishPolygon = useCallback((pts: [number, number][]) => {
    clearTimeout(clickTimer.current)
    if (pts.length < 3) return
    setSaveCoords([[...pts, pts[0]]])
    setHoverLngLat(null)
  }, [])

  // ── Map events ────────────────────────────────────────────────────────────────
  const onMapLoad = useCallback(() => setMapLoaded(true), [])

  const onMapClick = useCallback((e: MapMouseEvent) => {
    if (drawMode === 'click') {
      // Debounce: ignore first click of a double-click
      const now = Date.now()
      const isDoubleClick = now - lastClickMs.current < 350
      lastClickMs.current = now
      if (isDoubleClick) { clearTimeout(clickTimer.current); return }

      const newPt: [number, number] = [e.lngLat.lng, e.lngLat.lat]
      clickTimer.current = setTimeout(() => {
        setDraftPoints(prev => {
          const next = [...prev, newPt]
          return next
        })
      }, 180)
      return
    }

    if (drawMode === 'idle') {
      if (editMode) {
        // In edit mode: click on terrain barré to delete
        const barreFeatures = mapRef.current?.queryRenderedFeatures(e.point, { layers: ['admin-covered-streets-line'] })
        if (barreFeatures?.length) {
          const p = barreFeatures[0].properties ?? {}
          const entryId      = p.entry_id as string | undefined
          const featureIndex = p.feature_index != null ? Number(p.feature_index) : undefined
          if (entryId != null && featureIndex != null) {
            setStreetDeleteTarget({
              entryId,
              featureIndex,
              supervisorName: (p.supervisor_name as string) ?? '',
              date:           (p.entry_date as string) ?? (p.date as string) ?? '',
            })
            setBarreHover(null)
          }
        }
        return
      }
      const feat = e.features?.[0]
      setSelectedId(feat?.properties?.id ?? null)
    }
  }, [drawMode, editMode])

  const onMapDblClick = useCallback(() => {
    if (drawMode !== 'click') return
    clearTimeout(clickTimer.current)
    setDraftPoints(prev => {
      finishPolygon(prev)
      return prev
    })
  }, [drawMode, finishPolygon])

  const onMapMouseMove = useCallback((e: MapMouseEvent) => {
    if (drawMode === 'click' && !isTouch && draftPoints.length > 0) {
      setHoverLngLat([e.lngLat.lng, e.lngLat.lat])
    }

    if (drawMode === 'idle') {
      const feat = e.features?.[0]
      if (feat?.properties?.name) {
        setTooltipInfo({ name: feat.properties.name as string, lng: e.lngLat.lng, lat: e.lngLat.lat })
        setBarreHover(null)
      } else {
        setTooltipInfo(null)
        // Check for covered streets hover
        const barreFeatures = mapRef.current?.queryRenderedFeatures(e.point, { layers: ['admin-covered-streets-line'] })
        if (barreFeatures?.length) {
          const p = barreFeatures[0].properties ?? {}
          // Multi-visit: collect all features at this point sharing the same street_key
          const streetKey = (p.street_key as string | null) ?? null
          let visits: import('@/components/ui/BarrePopup').VisitEntry[] | undefined
          if (streetKey) {
            const sameStreet = barreFeatures.filter(f => (f.properties?.street_key as string | null) === streetKey)
            if (sameStreet.length > 1) {
              const seen = new Set<string>()
              visits = sameStreet
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
          const rawOOB = p.out_of_bounds as string | boolean | null
          const oobVal: boolean | 'soft' | 'hard' | undefined =
            rawOOB === 'hard' ? 'hard' : rawOOB === 'soft' ? 'soft' : rawOOB === true ? true : undefined
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
            out_of_bounds:    oobVal,
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
      }
    }
  }, [drawMode, isTouch, draftPoints.length])

  // ── Delete terrain barré ─────────────────────────────────────────────────────
  const handleDeleteStreetConfirm = useCallback(async () => {
    if (!streetDeleteTarget) return
    setStreetDeleting(true)
    setStreetDeleteError('')
    const result = await deleteStreetFeature(streetDeleteTarget.entryId, streetDeleteTarget.featureIndex)
    setStreetDeleting(false)
    if (result.error) {
      setStreetDeleteError(result.error)
    } else {
      setStreetDeleteTarget(null)
      router.refresh()
    }
  }, [streetDeleteTarget, router])

  // ── Save / delete callbacks ───────────────────────────────────────────────────
  const handleSave = useCallback((territory: TerritoryRow) => {
    setTerritories(prev => [...prev, territory])
    setSaveCoords(null)
    setDraftPoints([])
    setDrawMode('idle')
    setEditingTerritoryId(null)
  }, [])

  // Called when polygon is finished and we're redrawing an existing territory
  const handlePolygonRedrawFinish = useCallback(async (coords: number[][][]) => {
    if (!editingTerritoryId) return
    const res = await updateTerritory(editingTerritoryId, { coordinates: coords })
    if (res.error) {
      showSidebarToast('Erreur: ' + res.error)
    } else {
      setTerritories(prev =>
        prev.map(t => t.id === editingTerritoryId ? { ...t, coordinates: coords } : t)
      )
      showSidebarToast('Polygone mis à jour ✓')
    }
    setSaveCoords(null)
    setDraftPoints([])
    setDrawMode('idle')
    setEditingTerritoryId(null)
  }, [editingTerritoryId]) // eslint-disable-line

  const handleSaveCancel = useCallback(() => {
    setSaveCoords(null)
    setDraftPoints([])
    setDrawMode('idle')
  }, [])

  const handleDeleted = useCallback((id: string) => {
    setTerritories(prev => prev.filter(t => t.id !== id))
    setDeleteTarget(null)
    setSelectedId(null)
  }, [])

  // When saveCoords is set during a polygon redraw, auto-save to DB
  useEffect(() => {
    if (saveCoords && editingTerritoryId) {
      handlePolygonRedrawFinish(saveCoords)
    }
  }, [saveCoords, editingTerritoryId, handlePolygonRedrawFinish])

  // ── Fly to territory ──────────────────────────────────────────────────────────
  const flyTo = useCallback((territory: TerritoryRow) => {
    if (!territory.coordinates || !mapRef.current) return
    const [lng, lat] = polygonCentroid(territory.coordinates)
    mapRef.current.flyTo({ center: [lng, lat], zoom: 14, duration: 800 })
    setSelectedId(territory.id)
  }, [])

  // ── Derived data ──────────────────────────────────────────────────────────────
  const selectedTerritory = territories.find(t => t.id === selectedId)

  const counts = useMemo(() => ({
    active:   territories.filter(t => t.status === 'active').length,
    pending:  territories.filter(t => t.status === 'pending').length,
    inactive: territories.filter(t => t.status === 'inactive').length,
  }), [territories])

  const territoryGeoJSON = useMemo(
    () => territoriesToGeoJSON(territories, selectedId),
    [territories, selectedId],
  )

  const previewGJ = useMemo(
    () => previewGeoJSON(draftPoints, hoverLngLat, freehandPath),
    [draftPoints, hoverLngLat, freehandPath],
  )

  const coveredStreetsGeoJSON = useMemo(
    (): GeoJSON.FeatureCollection => allCoveredStreets ?? { type: 'FeatureCollection', features: [] },
    [allCoveredStreets],
  )

  const isDrawing = drawMode !== 'idle'
  const canFinish = draftPoints.length >= 3

  // ── Layer paints ──────────────────────────────────────────────────────────────
  const fillPaint: mapboxgl.FillPaint = {
    'fill-color': ['get', 'color'],
    'fill-opacity': ['case', ['==', ['get', 'selected'], true], 0.45, 0.18],
  }
  const outlinePaint: mapboxgl.LinePaint = {
    'line-color': ['get', 'color'],
    'line-width': ['case', ['==', ['get', 'selected'], true], 2.5, 1.5],
    'line-opacity': 0.9,
  }
  const previewLinePaint: mapboxgl.LinePaint = {
    'line-color': '#2E3192',
    'line-width': 2,
    'line-dasharray': [4, 3],
    'line-opacity': 0.9,
  }
  const previewFillPaint: mapboxgl.FillPaint = {
    'fill-color': '#2E3192',
    'fill-opacity': 0.12,
  }

  // ── Render ────────────────────────────────────────────────────────────────────
  return (
    <div className="flex h-full overflow-hidden relative">

      {/* ── Sidebar ────────────────────────────────────────────────────────────
           Desktop: always visible (lg:flex)
           Mobile: shown when sidebarOpen OR when not drawing in idle mode
      ─────────────────────────────────────────────────────────────────────── */}
      {/* Sidebar toast */}
      {sidebarToast && (
        <div className="fixed bottom-6 left-1/2 -translate-x-1/2 z-50 flex items-center gap-2 px-4 py-2.5 rounded-xl shadow-lg bg-brand-teal text-white font-body text-sm font-semibold animate-fade-in pointer-events-none">
          {sidebarToast}
        </div>
      )}

      <aside className={cn(
        'flex-shrink-0 flex flex-col overflow-hidden',
        'border-r border-slate-200 dark:border-white/[0.06]',
        'bg-white dark:bg-[#0f1035]',
        // Desktop: always visible
        'hidden lg:flex w-72 xl:w-80',
        // Mobile overlay when sidebarOpen
        sidebarOpen && 'flex fixed inset-y-0 left-0 z-30 w-72 shadow-xl lg:shadow-none lg:static lg:z-auto',
      )}>
        <SidebarContent
          t={t}
          territories={territories}
          teams={teams}
          counts={counts}
          selectedId={selectedId}
          isDrawing={isDrawing}
          onStartDraw={startClickMode}
          onSelectTerritory={territory => {
            flyTo(territory)
            setSidebarOpen(false)
          }}
          onCloseSidebar={() => setSidebarOpen(false)}
          selectedTerritory={selectedTerritory ?? null}
          onDelete={t => setDeleteTarget(t)}
          onClearSelection={() => setSelectedId(null)}
          onUpdateTerritory={(id, data) => {
            updateTerritory(id, data).then(res => {
              if (res.error) { showSidebarToast('Erreur: ' + res.error); return }
              setTerritories(prev => prev.map(t => t.id === id ? { ...t, ...data } : t))
              showSidebarToast('Zone mise à jour ✓')
            })
          }}
          onRedrawPolygon={(territory) => {
            setEditingTerritoryId(territory.id)
            flyTo(territory)
            startClickMode()
            setSidebarOpen(false)
          }}
        />
      </aside>

      {/* Mobile sidebar backdrop */}
      {sidebarOpen && (
        <div
          className="lg:hidden fixed inset-0 z-20 bg-black/40"
          onClick={() => setSidebarOpen(false)}
        />
      )}

      {/* ── Map area ────────────────────────────────────────────────────────── */}
      <div className="flex-1 relative overflow-hidden">
        <Map
          ref={mapRef}
          mapboxAccessToken={process.env.NEXT_PUBLIC_MAPBOX_TOKEN}
          initialViewState={{ longitude: MONTREAL[0], latitude: MONTREAL[1], zoom: 11 }}
          style={{ width: '100%', height: '100%' }}
          mapStyle={mapStyleUrl}
          interactiveLayerIds={drawMode === 'idle' ? ['territories-fill'] : []}
          onClick={onMapClick}
          onDblClick={onMapDblClick}
          onMouseMove={onMapMouseMove}
          onLoad={onMapLoad}
          cursor={isDrawing ? 'crosshair' : 'default'}
        >
          <NavigationControl position="bottom-right" visualizePitch={false} />

          {/* Existing territory polygons */}
          <Source id="territories" type="geojson" data={territoryGeoJSON}>
            <Layer id="territories-fill"    type="fill" paint={fillPaint} />
            <Layer id="territories-outline" type="line" paint={outlinePaint} />
          </Source>

          {/* Terrain barré — OOB overrides recency; opacity encodes recency */}
          <Source id="admin-covered-streets" type="geojson" data={coveredStreetsGeoJSON}>
            <Layer
              id="admin-covered-streets-line"
              type="line"
              paint={{
                'line-color': ['case',
                  ['any', ['==', ['get', 'out_of_bounds'], 'hard'], ['==', ['get', 'out_of_bounds'], true]], '#ef4444',
                  ['==', ['get', 'out_of_bounds'], 'soft'], '#f97316',
                  ['==', ['get', 'recency_rank'], 0], '#000000',
                  ['==', ['get', 'recency_rank'], 1], '#333333',
                  '#666666',
                ],
                'line-width': 2,
                'line-opacity': ['case',
                  ['any', ['==', ['get', 'out_of_bounds'], 'hard'], ['==', ['get', 'out_of_bounds'], 'soft'], ['==', ['get', 'out_of_bounds'], true]], 0.9,
                  ['==', ['get', 'recency_rank'], 0], 1.0,
                  ['==', ['get', 'recency_rank'], 1], 0.60,
                  0.35,
                ],
              }}
            />
          </Source>

          {/* Hover tooltip for terrain barré — hidden in edit mode */}
          {barreHover && !editMode && (
            <Marker longitude={barreHover.lng} latitude={barreHover.lat} anchor="bottom">
              <BarrePopup info={barreHover} onClose={() => setBarreHover(null)} />
            </Marker>
          )}

          {/* Drawing preview */}
          <Source id="preview" type="geojson" data={previewGJ}>
            <Layer
              id="preview-fill"
              type="fill"
              filter={['==', ['get', 'kind'], 'draft-fill']}
              paint={previewFillPaint}
            />
            <Layer
              id="preview-line"
              type="line"
              filter={['in', ['get', 'kind'], ['literal', ['draft-line', 'freehand']]]}
              paint={previewLinePaint}
            />
          </Source>

          {/* Hover tooltip — shown in idle mode when hovering a polygon */}
          {tooltipInfo && drawMode === 'idle' && (
            <Popup
              longitude={tooltipInfo.lng}
              latitude={tooltipInfo.lat}
              closeButton={false}
              closeOnClick={false}
              anchor="bottom"
              offset={10}
              className="territory-tooltip"
            >
              <span className="font-body text-xs font-semibold">{tooltipInfo.name}</span>
            </Popup>
          )}

          {/* Draft point markers (click-to-place) */}
          {drawMode === 'click' && draftPoints.map((pt, i) => (
            <Marker
              key={i}
              longitude={pt[0]}
              latitude={pt[1]}
              anchor="center"
            >
              <div
                onClick={e => {
                  e.stopPropagation()
                  // Double-click first point also finishes when 3+ pts
                  if (i === 0 && draftPoints.length >= 3) finishPolygon(draftPoints)
                }}
                className={cn(
                  'w-11 h-11 rounded-full flex items-center justify-center',
                  'border-[3px] border-white',
                  'shadow-lg cursor-pointer select-none',
                  'transition-transform active:scale-90',
                  i === 0 && draftPoints.length >= 3
                    ? 'bg-brand-teal'   // first point glows teal = tap to close
                    : 'bg-brand-navy',
                )}
                style={{ touchAction: 'none' }}
              >
                {i === 0 && draftPoints.length >= 3 && (
                  <svg className="w-4 h-4 text-white" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
                    <polyline points="20 6 9 17 4 12"/>
                  </svg>
                )}
              </div>
            </Marker>
          ))}
        </Map>

        {/* Edit mode toggle button — visible when not drawing */}
        {!isDrawing && !saveCoords && (
          <button
            onClick={() => { setEditMode(prev => !prev); setStreetDeleteTarget(null); setStreetDeleteError('') }}
            className={cn(
              'absolute bottom-16 right-4 z-10',
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
                {locale !== 'en' ? 'Éditer rues' : 'Edit streets'}
              </>
            )}
          </button>
        )}

        {/* Edit mode hint */}
        {editMode && !isDrawing && (
          <div className={cn(
            'absolute top-4 left-1/2 -translate-x-1/2 z-10',
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

        {/* Delete terrain barré confirmation dialog */}
        {streetDeleteTarget && (
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
                      {locale !== 'en'
                        ? `Supprimer la rue barrée de ${streetDeleteTarget.supervisorName || '—'}`
                        : `Remove ${streetDeleteTarget.supervisorName || '—'}'s covered street`}
                    </p>
                    {streetDeleteTarget.date && (
                      <p className="font-body text-xs text-slate-500 dark:text-white/50 mt-0.5">
                        {streetDeleteTarget.date}
                      </p>
                    )}
                  </div>
                </div>
                {streetDeleteError && (
                  <p className="font-body text-xs text-brand-red">{streetDeleteError}</p>
                )}
                <div className="flex gap-2">
                  <button
                    onClick={() => { setStreetDeleteTarget(null); setStreetDeleteError('') }}
                    className="flex-1 h-10 rounded-xl font-body text-sm font-semibold border border-slate-200 dark:border-white/[0.12] text-slate-600 dark:text-white/70 hover:bg-slate-50 dark:hover:bg-white/[0.06] transition-colors"
                  >
                    {locale !== 'en' ? 'Annuler' : 'Cancel'}
                  </button>
                  <button
                    onClick={handleDeleteStreetConfirm}
                    disabled={streetDeleting}
                    className="flex-1 h-10 rounded-xl font-body text-sm font-semibold bg-brand-red text-white hover:bg-brand-red/90 disabled:opacity-60 transition-colors"
                  >
                    {streetDeleting ? (
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

        {/* ── Drawing toolbar ─────────────────────────────────────────────────
             Desktop: top-left, both modes
             Mobile:  top-right, only click mode
        ──────────────────────────────────────────────────────────────────── */}
        {!saveCoords && (
          <div className={cn(
            'absolute z-10 flex gap-1.5',
            'bg-brand-navy/95 backdrop-blur-sm',
            'rounded-xl border border-white/10 shadow-lg p-1.5',
            // Desktop: top-left
            'top-4 left-4',
            // Mobile: top-right
            'sm:top-4 sm:left-4',
          )}>
            {/* Click-to-place */}
            <ToolbarButton
              active={drawMode === 'click'}
              onClick={drawMode === 'click' ? cancelDraw : startClickMode}
              title={t('draw_click_mode')}
            >
              <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
                <path d="M5 3l14 9-7 2-3 7-4-18z"/>
              </svg>
            </ToolbarButton>

            {/* Freehand — desktop only */}
            {!isTouch && (
              <ToolbarButton
                active={drawMode === 'freehand'}
                onClick={drawMode === 'freehand' ? cancelDraw : startFreehandMode}
                title={t('draw_freehand_mode')}
              >
                <svg viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.8" className="w-4 h-4">
                  <path d="M3 17c2-4 5-6 8-6s6 4 9 4"/>
                  <path d="M3 7c2 2 4 3 7 3" strokeDasharray="2 2"/>
                </svg>
              </ToolbarButton>
            )}
          </div>
        )}

        {/* ── Mobile sidebar toggle ──────────────────────────────────────────── */}
        {!isDrawing && (
          <button
            onClick={() => setSidebarOpen(true)}
            className={cn(
              'lg:hidden absolute top-4 right-4 z-10',
              'flex items-center gap-2 px-3 h-9 rounded-xl',
              'bg-brand-navy/95 backdrop-blur-sm text-white',
              'border border-white/10 shadow-lg',
              'font-body text-xs font-medium',
            )}
          >
            <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <line x1="3" y1="6" x2="21" y2="6"/><line x1="3" y1="12" x2="21" y2="12"/><line x1="3" y1="18" x2="21" y2="18"/>
            </svg>
            {t('show_list')}
          </button>
        )}

        {/* ── Drawing hint banner ───────────────────────────────────────────── */}
        {isDrawing && (
          <div className={cn(
            'absolute top-4 left-1/2 -translate-x-1/2 z-10',
            'bg-brand-navy/90 backdrop-blur-sm text-white',
            'rounded-full border border-white/10 shadow-md',
            'px-4 py-2',
            'max-w-[90vw] text-center',
          )}>
            <p className="font-body text-xs">
              {drawMode === 'freehand'
                ? t('draw_hint_freehand')
                : isTouch
                  ? t('draw_hint_mobile')
                  : draftPoints.length >= 3
                    ? t('draw_hint_desktop')
                    : t('draw_hint')}
            </p>
          </div>
        )}

        {/* ── Mobile: floating Finish / Undo / Cancel bar ───────────────────── */}
        {drawMode === 'click' && (
          <div className={cn(
            'absolute bottom-0 inset-x-0 z-10',
            'px-4 pb-6 pt-3',
            'bg-gradient-to-t from-black/60 to-transparent',
            'flex flex-col gap-2',
            'lg:hidden', // desktop uses dblclick/toolbar, mobile uses buttons
          )}>
            {canFinish && (
              <button
                onClick={() => finishPolygon(draftPoints)}
                className={cn(
                  'w-full h-12 rounded-xl font-body text-sm font-semibold',
                  'bg-brand-teal text-white shadow-lg active:scale-[0.98]',
                  'transition-transform',
                )}
              >
                {t('draw_finish')} ✓
              </button>
            )}
            <div className="flex gap-2">
              {draftPoints.length > 0 && (
                <button
                  onClick={undoLastPoint}
                  className={cn(
                    'flex-1 h-11 rounded-xl font-body text-sm font-medium',
                    'bg-white/20 backdrop-blur-sm text-white border border-white/20',
                    'active:scale-[0.98] transition-transform',
                  )}
                >
                  ↩ {t('draw_undo_point')}
                </button>
              )}
              <button
                onClick={cancelDraw}
                className={cn(
                  'flex-1 h-11 rounded-xl font-body text-sm font-medium',
                  'bg-white/10 backdrop-blur-sm text-white/80 border border-white/10',
                  'active:scale-[0.98] transition-transform',
                )}
              >
                {t('draw_cancel')}
              </button>
            </div>
          </div>
        )}

        {/* ── Desktop: undo / cancel controls (visible for any draw mode) ──── */}
        {isDrawing && (
          <div className={cn(
            'hidden lg:flex',
            'absolute bottom-8 left-1/2 -translate-x-1/2 z-10',
            'gap-2',
          )}>
            {drawMode === 'click' && draftPoints.length > 0 && (
              <button
                onClick={undoLastPoint}
                className={cn(
                  'h-9 px-4 rounded-xl font-body text-xs font-medium',
                  'bg-white/90 dark:bg-[#0f1035]/90 backdrop-blur-sm',
                  'text-slate-600 dark:text-white/70',
                  'border border-slate-200 dark:border-white/[0.08] shadow-sm',
                  'hover:bg-white dark:hover:bg-white/10',
                  'transition-colors',
                )}
              >
                ↩ {t('draw_undo_point')}
              </button>
            )}
            <button
              onClick={cancelDraw}
              className={cn(
                'h-9 px-4 rounded-xl font-body text-xs font-medium',
                'bg-white/90 dark:bg-[#0f1035]/90 backdrop-blur-sm',
                'text-brand-red border border-brand-red/20 shadow-sm',
                'hover:bg-brand-red/5',
                'transition-colors',
              )}
            >
              {t('draw_cancel')}
            </button>
          </div>
        )}

        {/* ── Mobile map lock/unlock button ─────────────────────────────────── */}
        {!isDrawing && isTouch && (
          <button
            onClick={() => setMapLocked(prev => !prev)}
            className={cn(
              'lg:hidden absolute top-4 right-4 z-10',
              'flex items-center gap-2 px-3 h-11 rounded-xl',
              'backdrop-blur-sm border shadow-md',
              'font-body text-xs font-medium transition-colors',
              mapLocked
                ? 'bg-brand-navy/95 text-white border-white/10'
                : 'bg-brand-teal/90 text-white border-brand-teal/30',
            )}
          >
            {mapLocked ? (
              /* Lock icon */
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
              </svg>
            ) : (
              /* Unlock icon */
              <svg className="w-3.5 h-3.5 shrink-0" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
                <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
                <path d="M7 11V7a5 5 0 0 1 9.9-1"/>
              </svg>
            )}
            {mapLocked ? t('map_lock_activate') : t('map_lock_lock')}
          </button>
        )}

        {/* ── Mobile lock hint overlay (disappears after 3 s) ───────────────── */}
        {showLockHint && (
          <div className={cn(
            'lg:hidden absolute inset-x-4 top-20 z-10',
            'flex items-center justify-center',
            'bg-brand-navy/90 backdrop-blur-sm text-white',
            'rounded-xl border border-white/10 shadow-lg',
            'px-4 py-3 pointer-events-none',
            'animate-fade-in',
          )}>
            <svg className="w-4 h-4 mr-2 shrink-0 text-brand-teal" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.2" strokeLinecap="round" strokeLinejoin="round">
              <rect x="3" y="11" width="18" height="11" rx="2" ry="2"/>
              <path d="M7 11V7a5 5 0 0 1 10 0v4"/>
            </svg>
            <p className="font-body text-xs">{t('map_lock_hint')}</p>
          </div>
        )}

        {/* ── Map style selector ────────────────────────────────────────────── */}
        {!isDrawing && (
          <MapStyleSelector
            activeUrl={mapStyleUrl}
            onSelect={setMapStyle}
          />
        )}

        {/* ── Legend ────────────────────────────────────────────────────────── */}
        {!isDrawing && (
          <div className={cn(
            'absolute bottom-10 left-4 z-10',
            'hidden lg:block',
            'bg-white/90 dark:bg-[#0f1035]/90 backdrop-blur-sm',
            'rounded-xl border border-slate-200 dark:border-white/[0.08]',
            'px-3 py-2.5 shadow-md',
          )}>
            <p className="font-body text-[10px] font-semibold uppercase tracking-wider text-slate-400 dark:text-white/40 mb-2">
              {t('legend')}
            </p>
            {([
              { key: 'active',   color: 'bg-green-500',  label: t('status_active')   },
              { key: 'pending',  color: 'bg-yellow-500', label: t('status_pending')  },
              { key: 'inactive', color: 'bg-gray-400',   label: t('status_inactive') },
            ] as const).map(({ key, color, label }) => (
              <div key={key} className="flex items-center gap-2 mb-1 last:mb-0">
                <span className={`w-3 h-3 rounded-sm opacity-80 shrink-0 ${color}`} />
                <span className="font-body text-xs text-slate-600 dark:text-white/60">{label}</span>
              </div>
            ))}
            <div className="flex items-center gap-2 mb-1">
              <div className="w-5 h-[3px] rounded-full bg-black shrink-0" />
              <span className="font-body text-xs text-slate-600 dark:text-white/60">{locale !== 'en' ? 'Terrain barré' : 'Covered streets'}</span>
            </div>
            <div className="flex items-center gap-2">
              <div className="w-5 h-[3px] rounded-full bg-[#f97316] shrink-0" />
              <span className="font-body text-xs text-slate-600 dark:text-white/60">{locale !== 'en' ? 'Hors zone' : 'Out-of-bounds'}</span>
            </div>
          </div>
        )}
      </div>

      {/* ── Modals ──────────────────────────────────────────────────────────── */}
      {saveCoords && (
        <SaveTerritoryModal
          coords={saveCoords}
          teams={teams}
          onSave={handleSave}
          onCancel={handleSaveCancel}
        />
      )}

      {deleteTarget && (
        <DeleteTerritoryModal
          territory={deleteTarget}
          onDeleted={handleDeleted}
          onCancel={() => setDeleteTarget(null)}
        />
      )}
    </div>
  )
}

// ── SidebarContent (extracted to keep TerritoriesMap readable) ─────────────────
interface SidebarContentProps {
  t: ReturnType<typeof useTranslations<'admin.territories'>>
  territories: TerritoryRow[]
  teams: TeamRow[]
  counts: { active: number; pending: number; inactive: number }
  selectedId: string | null
  isDrawing: boolean
  onStartDraw: () => void
  onSelectTerritory: (t: TerritoryRow) => void
  onCloseSidebar: () => void
  selectedTerritory: TerritoryRow | null
  onDelete: (t: TerritoryRow) => void
  onClearSelection: () => void
  onUpdateTerritory: (id: string, data: { name?: string; status?: import('@/types').TerritoryStatus }) => void
  onRedrawPolygon: (territory: TerritoryRow) => void
}

function SidebarContent({
  t, territories, teams, counts, selectedId, isDrawing,
  onStartDraw, onSelectTerritory, onCloseSidebar,
  selectedTerritory, onDelete, onClearSelection,
  onUpdateTerritory, onRedrawPolygon,
}: SidebarContentProps) {
  const [editingName, setEditingName] = useState(false)
  const [nameVal, setNameVal] = useState('')
  const [statusVal, setStatusVal] = useState<import('@/types').TerritoryStatus>('active')

  useEffect(() => {
    if (selectedTerritory) {
      setNameVal(selectedTerritory.name)
      setStatusVal(selectedTerritory.status as import('@/types').TerritoryStatus)
      setEditingName(false)
    }
  }, [selectedTerritory?.id]) // eslint-disable-line
  return (
    <>
      {/* Header */}
      <div className="px-4 pt-5 pb-4 border-b border-slate-100 dark:border-white/[0.06] shrink-0">
        <div className="flex items-start justify-between gap-2">
          <div>
            <h1 className="font-display text-base font-bold text-brand-navy dark:text-white">
              {t('title')}
            </h1>
            <p className="font-body text-xs text-slate-400 dark:text-white/40 mt-0.5">
              {territories.length} {t('territories_count')}
            </p>
          </div>
          {/* Close button (mobile only) */}
          <button
            onClick={onCloseSidebar}
            className="lg:hidden text-slate-300 dark:text-white/20 hover:text-slate-500 dark:hover:text-white/50 mt-0.5"
          >
            <svg className="w-5 h-5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <path d="M18 6 6 18M6 6l12 12"/>
            </svg>
          </button>
        </div>

        {/* Status counts */}
        <div className="flex gap-3 mt-3">
          {([
            { status: 'active',   color: 'bg-green-500',  count: counts.active   },
            { status: 'pending',  color: 'bg-yellow-500', count: counts.pending  },
            { status: 'inactive', color: 'bg-gray-400',   count: counts.inactive },
          ] as const).map(({ status, color, count }) => (
            <span key={status} className="flex items-center gap-1.5 text-xs font-body">
              <span className={`w-2 h-2 rounded-full shrink-0 ${color}`} />
              <span className="text-slate-500 dark:text-white/50">{count}</span>
            </span>
          ))}
        </div>

        {/* Add territory button */}
        {!isDrawing && (
          <button
            onClick={onStartDraw}
            className={cn(
              'mt-3 w-full h-9 rounded-xl',
              'font-body text-xs font-semibold',
              'bg-brand-navy text-white',
              'hover:bg-brand-navy-dark active:scale-[0.98]',
              'transition-all flex items-center justify-center gap-1.5',
            )}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2.5">
              <path d="M12 5v14M5 12h14"/>
            </svg>
            {t('add_btn')}
          </button>
        )}
      </div>

      {/* Territory list */}
      <div className="flex-1 overflow-y-auto">
        {territories.length === 0 ? (
          <div className="flex items-center justify-center h-40 px-4">
            <p className="text-sm font-body text-slate-400 dark:text-white/30 text-center">
              {t('empty')}
            </p>
          </div>
        ) : territories.map(territory => (
          <button
            key={territory.id}
            onClick={() => onSelectTerritory(territory)}
            className={cn(
              'w-full flex items-start gap-0 px-4 py-3 text-left',
              'transition-colors duration-100',
              'border-b border-slate-50 dark:border-white/[0.03] last:border-0',
              selectedId === territory.id
                ? 'bg-slate-100/80 dark:bg-white/[0.06]'
                : 'hover:bg-slate-50 dark:hover:bg-white/[0.03]',
            )}
          >
            <div className="flex-1 min-w-0">
              {/* Name row: status dot + name + badge */}
              <div className="flex items-center gap-2">
                <span className={cn(
                  'w-2 h-2 rounded-full shrink-0',
                  territory.status === 'active'   && 'bg-green-500',
                  territory.status === 'pending'  && 'bg-yellow-500',
                  territory.status === 'inactive' && 'bg-gray-400',
                )} />
                <p className={cn(
                  'font-body text-sm font-medium truncate flex-1',
                  selectedId === territory.id
                    ? 'text-brand-navy dark:text-white'
                    : 'text-slate-700 dark:text-white/70',
                )}>
                  {territory.name}
                </p>
                <StatusBadge status={territory.status} t={t} />
              </div>

              {/* Sector + no-polygon note */}
              {territory.sector && (
                <p className="font-body text-xs text-slate-400 dark:text-white/30 truncate mt-0.5 pl-4">
                  {territory.sector}
                </p>
              )}
              {!territory.coordinates && (
                <p className="font-body text-[10px] text-slate-300 dark:text-white/20 mt-0.5 pl-4 italic">
                  {t('no_polygon')}
                </p>
              )}
            </div>
          </button>
        ))}
      </div>

      {/* Selected territory quick-edit panel */}
      {selectedTerritory && (
        <div className={cn(
          'border-t border-slate-100 dark:border-white/[0.06]',
          'px-4 py-4 shrink-0 space-y-3',
          'bg-slate-50/80 dark:bg-white/[0.03]',
        )}>
          {/* Header row */}
          <div className="flex items-start justify-between gap-2">
            <h3 className="font-display text-sm font-semibold text-brand-navy dark:text-white leading-tight truncate">
              {selectedTerritory.name}
            </h3>
            <button onClick={onClearSelection} aria-label="Close" className="text-slate-300 hover:text-slate-500 dark:text-white/20 dark:hover:text-white/50 shrink-0 mt-0.5 transition-colors">
              <svg className="w-4 h-4" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2"><path d="M18 6 6 18M6 6l12 12"/></svg>
            </button>
          </div>

          {/* Inline name edit */}
          {editingName ? (
            <div className="flex gap-1.5">
              <input
                value={nameVal}
                onChange={e => setNameVal(e.target.value)}
                autoFocus
                className="flex-1 h-8 rounded-lg px-2.5 font-body text-xs border border-brand-teal focus:outline-none bg-white dark:bg-white/[0.05] text-slate-900 dark:text-white"
              />
              <button
                onClick={() => { onUpdateTerritory(selectedTerritory.id, { name: nameVal.trim() || selectedTerritory.name }); setEditingName(false) }}
                className="h-8 px-2.5 rounded-lg font-body text-xs font-semibold bg-brand-teal text-white"
              >✓</button>
              <button onClick={() => { setEditingName(false); setNameVal(selectedTerritory.name) }} className="h-8 px-2 rounded-lg font-body text-xs text-slate-400 hover:text-slate-600 dark:hover:text-white border border-slate-200 dark:border-white/10">✕</button>
            </div>
          ) : (
            <button onClick={() => setEditingName(true)} className="flex items-center gap-1.5 font-body text-xs text-slate-400 dark:text-white/30 hover:text-brand-navy dark:hover:text-white transition-colors">
              <svg className="w-3 h-3" fill="none" stroke="currentColor" strokeWidth="2" viewBox="0 0 24 24"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
              Modifier le nom
            </button>
          )}

          {/* Status quick-change */}
          <div>
            <label className="font-body text-[10px] uppercase tracking-wider text-slate-400 dark:text-white/30 font-semibold block mb-1">Statut</label>
            <select
              value={statusVal}
              onChange={e => {
                const s = e.target.value as import('@/types').TerritoryStatus
                setStatusVal(s)
                onUpdateTerritory(selectedTerritory.id, { status: s })
              }}
              className="w-full h-8 rounded-lg px-2.5 font-body text-xs border border-slate-200 dark:border-white/[0.10] bg-white dark:bg-white/[0.05] text-slate-900 dark:text-white focus:outline-none focus:ring-1 focus:ring-brand-teal cursor-pointer"
            >
              <option value="active">Actif</option>
              <option value="pending">En attente</option>
              <option value="inactive">Inactif</option>
            </select>
          </div>

          {/* Modifier le polygone */}
          {!isDrawing && (
            <button
              onClick={() => onRedrawPolygon(selectedTerritory)}
              className={cn(
                'w-full h-9 rounded-xl font-body text-xs font-semibold',
                'bg-brand-navy/8 text-brand-navy dark:bg-white/[0.06] dark:text-white/80 border border-brand-navy/15 dark:border-white/[0.10]',
                'hover:bg-brand-navy/15 dark:hover:bg-white/[0.10] active:scale-[0.98]',
                'transition-all flex items-center justify-center gap-1.5',
              )}
            >
              <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
                <path strokeLinecap="round" strokeLinejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7M9 20l6-3M9 20V7m6 13l4.553 2.276A1 1 0 0021 21.382V10.618a1 1 0 00-.553-.894L15 7m0 13V7M9 7l6-3"/>
              </svg>
              Modifier le polygone
            </button>
          )}

          {/* Delete */}
          <button
            onClick={() => onDelete(selectedTerritory)}
            className={cn(
              'w-full h-9 rounded-xl font-body text-xs font-semibold',
              'bg-brand-red/10 text-brand-red border border-brand-red/20',
              'hover:bg-brand-red/15 active:scale-[0.98]',
              'transition-all flex items-center justify-center gap-1.5',
            )}
          >
            <svg className="w-3.5 h-3.5" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
              <polyline points="3 6 5 6 21 6"/>
              <path d="M19 6l-1 14a2 2 0 0 1-2 2H8a2 2 0 0 1-2-2L5 6"/>
              <path d="M10 11v6M14 11v6"/>
            </svg>
            {t('detail_delete')}
          </button>
        </div>
      )}
    </>
  )
}

// ── ToolbarButton ──────────────────────────────────────────────────────────────
function ToolbarButton({
  active, onClick, title, children,
}: {
  active: boolean
  onClick: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <button
      onClick={onClick}
      title={title}
      className={cn(
        'w-9 h-9 rounded-lg flex items-center justify-center',
        'transition-colors',
        active
          ? 'bg-white text-brand-navy'
          : 'text-white/60 hover:text-white hover:bg-white/10',
      )}
    >
      {children}
    </button>
  )
}

// ── StatusBadge ────────────────────────────────────────────────────────────────
function StatusBadge({
  status, t,
}: {
  status: 'active' | 'pending' | 'inactive'
  t: ReturnType<typeof useTranslations<'admin.territories'>>
}) {
  return (
    <span className={cn(
      'inline-flex items-center gap-1 px-2 py-0.5 rounded-full text-[10px] font-medium font-body',
      status === 'active'   && 'bg-green-100 text-green-700 dark:bg-green-900/30 dark:text-green-400',
      status === 'pending'  && 'bg-yellow-100 text-yellow-700 dark:bg-yellow-900/30 dark:text-yellow-400',
      status === 'inactive' && 'bg-gray-100 text-gray-600 dark:bg-gray-800/50 dark:text-gray-400',
    )}>
      <span className={cn(
        'w-1.5 h-1.5 rounded-full shrink-0',
        status === 'active'   && 'bg-green-500',
        status === 'pending'  && 'bg-yellow-500',
        status === 'inactive' && 'bg-gray-400',
      )} />
      {t(`status_${status}` as 'status_active' | 'status_pending' | 'status_inactive')}
    </span>
  )
}
