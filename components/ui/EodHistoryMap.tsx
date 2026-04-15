'use client'

import { useRef, useState, useCallback, useMemo } from 'react'
import Map, {
  Source, Layer, Marker, type MapRef, type MapMouseEvent,
} from 'react-map-gl/mapbox'

const MAPBOX_TOKEN = process.env.NEXT_PUBLIC_MAPBOX_TOKEN!

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

// ── EOD entry shape expected by this component ───────────────────────────────
export type HistoryEodEntry = {
  id:              string
  entry_date:      string | null
  pph:             number
  covered_streets: GeoJSON.FeatureCollection | null
}

// ── component ─────────────────────────────────────────────────────────────────
interface EodHistoryMapProps {
  eods:    HistoryEodEntry[]
  height?: number
  locale?: string
}

export default function EodHistoryMap({
  eods,
  height = 200,
  locale,
}: EodHistoryMapProps) {
  const mapRef = useRef<MapRef>(null)
  const [hover, setHover] = useState<{
    date: string; pph: number; lng: number; lat: number
  } | null>(null)

  // Build combined FeatureCollection with entry_date + pph in properties
  const allStreets = useMemo((): GeoJSON.FeatureCollection => {
    const features: GeoJSON.Feature[] = []
    for (const eod of eods) {
      const fc = eod.covered_streets
      if (!fc?.features) continue
      for (const f of fc.features) {
        features.push({
          ...f,
          properties: {
            ...f.properties,
            entry_date: eod.entry_date ?? '',
            pph:        eod.pph ?? 0,
          },
        })
      }
    }
    return { type: 'FeatureCollection', features }
  }, [eods])

  const bbox = useMemo(() => computeBBox(allStreets), [allStreets])

  const handleMouseMove = useCallback((e: MapMouseEvent) => {
    const map = mapRef.current?.getMap()
    if (!map) return
    const features = map.queryRenderedFeatures(e.point, {
      layers: ['eod-history-line'],
    })
    if (features.length > 0) {
      const p = features[0].properties ?? {}
      setHover({
        date: p.entry_date ?? '',
        pph:  Number(p.pph) || 0,
        lng:  e.lngLat.lng,
        lat:  e.lngLat.lat,
      })
    } else {
      setHover(null)
    }
  }, [])

  if (!bbox || allStreets.features.length === 0) {
    return (
      <div
        className="w-full rounded-xl bg-slate-100 dark:bg-white/[0.04] flex items-center justify-center"
        style={{ height }}
      >
        <p className="font-body text-xs text-slate-400 dark:text-white/30">
          {locale !== 'en' ? 'Aucune rue barrée' : 'No streets covered'}
        </p>
      </div>
    )
  }

  return (
    <div className="w-full rounded-xl overflow-hidden" style={{ height }}>
      <Map
        ref={mapRef}
        mapboxAccessToken={MAPBOX_TOKEN}
        initialViewState={{
          bounds: bbox,
          fitBoundsOptions: { padding: 20 },
        }}
        mapStyle="mapbox://styles/mapbox/light-v11"
        dragPan={false}
        scrollZoom={false}
        boxZoom={false}
        dragRotate={false}
        keyboard={false}
        doubleClickZoom={false}
        touchZoomRotate={false}
        style={{ width: '100%', height: '100%' }}
        attributionControl={false}
        cursor={hover ? 'pointer' : 'default'}
        onMouseMove={handleMouseMove}
        onMouseLeave={() => setHover(null)}
      >
        <Source id="eod-history" type="geojson" data={allStreets}>
          <Layer
            id="eod-history-line"
            type="line"
            paint={{ 'line-color': '#000000', 'line-width': 2, 'line-opacity': 0.85 }}
          />
        </Source>

        {hover && (
          <Marker longitude={hover.lng} latitude={hover.lat} anchor="bottom">
            <div className="mb-1.5 px-2.5 py-1.5 rounded-xl bg-brand-navy text-white font-body text-xs shadow-lg pointer-events-none whitespace-nowrap">
              <p className="font-semibold">{formatDateFr(hover.date)}</p>
              <p className="text-white/70 text-[11px]">PPH {hover.pph.toFixed(2)}</p>
            </div>
          </Marker>
        )}
      </Map>
    </div>
  )
}
