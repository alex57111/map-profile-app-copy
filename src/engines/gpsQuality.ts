import type { GPSState } from '../types/geo'

// Заход 46: качество связи GPS для плашки. good — зелёный, poor — жёлтый,
// none — красный («нет связи»).
export type GpsQuality = 'good' | 'poor' | 'none'

const FRESH_MS = 12_000      // фикс свежее — связь уверенная
const STALE_MS = 30_000      // старше — связи нет
const SEARCH_MS = 15_000     // первый фикс ищем не дольше — потом «нет связи»
const GOOD_ACC_M = 50
const POOR_ACC_M = 150

const rank: Record<GpsQuality, number> = { good: 0, poor: 1, none: 2 }
const worst = (a: GpsQuality, b: GpsQuality): GpsQuality => (rank[a] >= rank[b] ? a : b)

export function gpsQuality(gps: GPSState, now: number): GpsQuality {
  if (gps.status === 'denied' || gps.status === 'idle') return 'none'
  const at = gps.lastFixAt
  if (at === undefined) {
    // Фиксов ещё не было: ищем (жёлтый), а если долго — нет связи.
    const since = gps.startedAt ?? now
    return now - since > SEARCH_MS ? 'none' : 'poor'
  }
  const age = now - at
  let q: GpsQuality = age <= FRESH_MS ? 'good' : age <= STALE_MS ? 'poor' : 'none'
  const acc = gps.lastAccuracy
  if (acc !== undefined) {
    q = worst(q, acc <= GOOD_ACC_M ? 'good' : acc <= POOR_ACC_M ? 'poor' : 'none')
  }
  return q
}
