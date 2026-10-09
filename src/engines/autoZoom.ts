// Автозум как в навигаторе (заход 38): масштаб карты зависит от скорости, пока
// камера следует за GPS. Ширина экрана в метрах → целый уровень зума Leaflet
// (формула Web Mercator), поэтому работает на любом размере экрана.
//   стоим/медленно ≈ 350 м · город ≈ 700–1300 м · трасса ≈ 2.5–4.5 км

interface Tier { maxKmh: number; widthM: number }
const TIERS: Tier[] = [
  { maxKmh: 15, widthM: 350 },
  { maxKmh: 50, widthM: 700 },
  { maxKmh: 80, widthM: 1300 },
  { maxKmh: 110, widthM: 2500 },
  { maxKmh: Infinity, widthM: 4500 },
]
const HYST_KMH = 5 // запас вокруг порога скорости — против дребезга уровней
const DWELL_MS = 4_000 // новый уровень должен продержаться, прежде чем менять зум
const MIN_Z = 3
const MAX_Z = 19

export const tierFor = (speedKmh: number): number => {
  const i = TIERS.findIndex((t) => speedKmh < t.maxKmh)
  return i < 0 ? TIERS.length - 1 : i
}

export const zoomForWidth = (widthM: number, mapPx: number, lat: number): number => {
  const z = Math.log2((mapPx * 156543.03 * Math.cos((lat * Math.PI) / 180)) / widthM)
  return Math.min(MAX_Z, Math.max(MIN_Z, Math.round(z)))
}

export class AutoZoomController {
  private tier = 0
  private candidate = 0
  private since = 0
  private progUntil = 0
  /** Последний вычисленный базовый зум (без смещения пользователя). */
  currentBase: number | null = null

  /** Первый фикс / кнопка "на меня": уровень по текущей скорости, без задержки. */
  reset(speedKmh: number): void {
    this.tier = tierFor(speedKmh)
    this.candidate = this.tier
    this.since = 0
  }

  /** true — уровень сменился (пора менять зум). */
  update(speedKmh: number, now: number): boolean {
    const t = this.tier
    const raw = tierFor(speedKmh)
    let cand = t
    if (raw > t && speedKmh > TIERS[t]!.maxKmh + HYST_KMH) cand = raw
    else if (raw < t && speedKmh < TIERS[t - 1]!.maxKmh - HYST_KMH) cand = raw
    if (cand === t) { this.candidate = t; return false }
    if (cand !== this.candidate) { this.candidate = cand; this.since = now; return false }
    if (now - this.since >= DWELL_MS) { this.tier = cand; return true }
    return false
  }

  /** Базовый зум для текущего уровня. */
  targetZoom(mapPx: number, lat: number): number {
    const z = zoomForWidth(TIERS[this.tier]!.widthM, mapPx, lat)
    this.currentBase = z
    return z
  }

  /** Зум меняет код, а не пользователь — не считать жестом (смещение не пересчитывать). */
  markProgrammatic(ms = 1500): void { this.progUntil = Date.now() + ms }
  isProgrammatic(): boolean { return Date.now() < this.progUntil }
}

export const autoZoom = new AutoZoomController()
