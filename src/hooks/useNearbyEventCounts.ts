import { useMemo } from 'react'
import { haversineMetres } from '../engines/haversine'
import type { GPSPosition } from '../types/geo'
import type { RoadEvent } from '../types/event'

// Заход 45: счётчики событий по типам в радиусе от позиции пользователя
// (плашка MapHUD). Типы — 5 пользовательских; speed_zone (синтетические зоны
// OSM) не считается.
export const COUNTED_TYPES = ['camera', 'police', 'accident', 'repair', 'danger'] as const
export type CountedType = (typeof COUNTED_TYPES)[number]
export type EventCounts = Record<CountedType, number>

export const ZERO_COUNTS: EventCounts = { camera: 0, police: 0, accident: 0, repair: 0, danger: 0 }
export const COUNT_RADIUS_M = 50_000

interface PointLike { lat: number; lng: number }

/**
 * null позиция → null (в плашке покажем прочерки). Камеры = события type
 * "camera" из БД + камеры OSM (те, что раньше считал индикатор слева вверху).
 */
export function useNearbyEventCounts(
  position: GPSPosition | null,
  events: RoadEvent[],
  osmCameras: PointLike[],
  radiusM: number = COUNT_RADIUS_M,
): EventCounts | null {
  const lat = position?.lat ?? null
  const lng = position?.lng ?? null
  return useMemo(() => {
    if (lat === null || lng === null) return null
    const counts: EventCounts = { ...ZERO_COUNTS }
    for (const e of events) {
      if (e.type === 'speed_zone') continue
      if (!(e.type in counts)) continue
      if (haversineMetres(lat, lng, e.lat, e.lng) <= radiusM) counts[e.type as CountedType]++
    }
    for (const c of osmCameras) {
      if (haversineMetres(lat, lng, c.lat, c.lng) <= radiusM) counts.camera++
    }
    return counts
  }, [lat, lng, events, osmCameras, radiusM])
}
