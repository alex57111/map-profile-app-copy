// Заход 46: последняя известная позиция — ТОЛЬКО для стартового вида карты,
// пока GPS ещё не дал фикс. В gps.position она НЕ подставляется (иначе
// оповещения и счётчики работали бы по устаревшей точке).
import type { Coords } from '../types/geo'

const KEY = 'gps_last_fix_v1'

export function loadLastFix(): Coords | null {
  try {
    const raw = localStorage.getItem(KEY)
    if (!raw) return null
    const v = JSON.parse(raw) as { lat?: number; lng?: number }
    if (typeof v.lat !== 'number' || typeof v.lng !== 'number') return null
    if (!Number.isFinite(v.lat) || !Number.isFinite(v.lng)) return null
    return { lat: v.lat, lng: v.lng }
  } catch { return null }
}

let lastSaved = 0
export function saveLastFix(lat: number, lng: number): void {
  const now = Date.now()
  if (now - lastSaved < 10_000) return
  lastSaved = now
  try { localStorage.setItem(KEY, JSON.stringify({ lat, lng, ts: now })) } catch { /* приватный режим */ }
}
