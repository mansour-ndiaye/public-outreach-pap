'use client'

import { useMemo, useState } from 'react'
import { createPortal } from 'react-dom'
import Map, { Source, Layer, NavigationControl } from 'react-map-gl/mapbox'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!
const MAP_STYLE    = 'mapbox://styles/mapbox/streets-v12'

// ── bbox helper ───────────────────────────────────────────────────────────────
function computeBBox(
  fc: GeoJSON.FeatureCollection,
): [[number, number], [number, number]] | null {
  let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity
  let found = false
  for (const f of fc.features) {
    const coords =
      f.geometry.type === 'LineString'
        ? (f.geometry as GeoJSON.LineString).coordinates
        : f.geometry.type === 'MultiLineString'
        ? (f.geometry as GeoJSON.MultiLineString).coordinates.flat()
        : []
    for (const [lng, lat] of coords) {
      if (lng < minLng) minLng = lng
      if (lat < minLat) minLat = lat
      if (lng > maxLng) maxLng = lng
      if (lat > maxLat) maxLat = lat
      found = true
    }
  }
  if (!found) return null
  // small buffer so a single-point result still has a valid bbox
  const padLng = Math.max(0.002, (maxLng - minLng) * 0.1)
  const padLat = Math.max(0.002, (maxLat - minLat) * 0.1)
  return [
    [minLng - padLng, minLat - padLat],
    [maxLng + padLng, maxLat + padLat],
  ]
}

function formatDateFr(dateStr: string) {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('fr-CA', {
      day: 'numeric', month: 'long', year: 'numeric',
    })
  } catch {
    return dateStr
  }
}

// ── component ─────────────────────────────────────────────────────────────────
interface EodMiniMapProps {
  coveredStreets:  GeoJSON.FeatureCollection | null
  height?:         number
  locale?:         string
  /** Optional header info shown inside the expand modal */
  supervisorName?: string
  teamName?:       string
  date?:           string
}

export default function EodMiniMap({
  coveredStreets,
  height = 120,
  locale,
  supervisorName,
  teamName,
  date,
}: EodMiniMapProps) {
  const [modalOpen, setModalOpen] = useState(false)

  const bbox = useMemo(() => {
    if (!coveredStreets?.features?.length) return null
    return computeBBox(coveredStreets)
  }, [coveredStreets])

  // ── placeholder ──────────────────────────────────────────────────────────
  if (!bbox) {
    return (
      <div
        className="w-full rounded-xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center shrink-0"
        style={{ height }}
      >
        <p className="font-body text-xs text-slate-400 dark:text-white/30">
          {locale !== 'en' ? 'Aucune rue barrée' : 'No streets covered'}
        </p>
      </div>
    )
  }

  // ── full-screen modal (rendered via portal to avoid overflow clipping) ────
  const modal = modalOpen ? createPortal(
    <div className="fixed inset-0 z-[9999] flex items-end sm:items-center justify-center">
      {/* Backdrop */}
      <div
        className="absolute inset-0 bg-black/70 backdrop-blur-sm"
        onClick={() => setModalOpen(false)}
      />

      {/* Panel */}
      <div className="relative z-10 w-full h-[92dvh] sm:h-[88vh] sm:w-[90vw] sm:max-w-5xl sm:rounded-2xl overflow-hidden bg-white dark:bg-[#12163a] shadow-2xl flex flex-col">

        {/* Modal header */}
        <div className="flex items-center justify-between px-5 py-3 border-b border-slate-200 dark:border-white/[0.08] bg-white dark:bg-[#12163a] shrink-0">
          <div className="min-w-0">
            {date && (
              <p className="font-body text-xs text-slate-500 dark:text-white/50">
                {formatDateFr(date)}
              </p>
            )}
            <div className="flex items-center gap-2 flex-wrap">
              {supervisorName && (
                <p className="font-display text-sm font-bold text-brand-navy dark:text-white truncate">
                  {supervisorName}
                </p>
              )}
              {teamName && (
                <p className="font-body text-xs text-slate-400 dark:text-white/40 truncate">
                  {teamName}
                </p>
              )}
            </div>
          </div>

          <button
            onClick={() => setModalOpen(false)}
            className="ml-4 shrink-0 w-8 h-8 flex items-center justify-center rounded-full text-slate-500 dark:text-white/60 hover:bg-slate-100 dark:hover:bg-white/[0.08] transition-colors"
            aria-label="Close"
          >
            <svg className="w-4 h-4" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
              <path strokeLinecap="round" strokeLinejoin="round" d="M6 18L18 6M6 6l12 12" />
            </svg>
          </button>
        </div>

        {/* Interactive map */}
        <div className="flex-1 min-h-0">
          <Map
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{
              bounds: bbox,
              fitBoundsOptions: { padding: 40, maxZoom: 15 },
            }}
            mapStyle={MAP_STYLE}
            style={{ width: '100%', height: '100%' }}
          >
            <NavigationControl position="top-right" />
            <Source id="modal-covered" type="geojson" data={coveredStreets!}>
              <Layer
                id="modal-covered-line"
                type="line"
                paint={{ 'line-color': '#000000', 'line-width': 2, 'line-opacity': 0.9 }}
              />
            </Source>
          </Map>
        </div>
      </div>
    </div>,
    document.body,
  ) : null

  // ── mini-map + expand button ──────────────────────────────────────────────
  return (
    <>
      <div className="space-y-1.5">
        {/* Mini-map */}
        <div className="w-full rounded-xl overflow-hidden shrink-0" style={{ height }}>
          <Map
            mapboxAccessToken={MAPBOX_TOKEN}
            initialViewState={{
              bounds: bbox,
              fitBoundsOptions: { padding: 30, maxZoom: 15 },
            }}
            mapStyle={MAP_STYLE}
            interactive={false}
            style={{ width: '100%', height: '100%' }}
            attributionControl={false}
          >
            <Source id="mini-covered" type="geojson" data={coveredStreets!}>
              <Layer
                id="mini-covered-line"
                type="line"
                paint={{ 'line-color': '#000000', 'line-width': 2, 'line-opacity': 0.85 }}
              />
            </Source>
          </Map>
        </div>

        {/* Expand button */}
        <button
          onClick={() => setModalOpen(true)}
          className="flex items-center gap-1 font-body text-[11px] font-semibold text-brand-navy dark:text-white/60 hover:text-brand-teal dark:hover:text-brand-teal transition-colors"
        >
          <svg className="w-3 h-3 shrink-0" fill="none" stroke="currentColor" strokeWidth="2.5" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" d="M15 3h6v6M9 21H3v-6M21 3l-7 7M3 21l7-7" />
          </svg>
          {locale !== 'en' ? 'Voir les rues' : 'View streets'}
        </button>
      </div>

      {modal}
    </>
  )
}
