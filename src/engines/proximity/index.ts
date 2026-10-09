// Модуль Proximity Alerts (заход 37, AGENT_LOG.md) — ядро без React и без
// побочных эффектов: фильтр фиксов, пространственный индекс, автомат
// "пересечение радиуса внутрь". Строится РЯДОМ с useEventsAhead и его не
// заменяет — подключение и откат на старый хук см. useProximityAlerts.ts.
import { haversineMetres, bearingDeg } from '../haversine'

export interface GeoEvent { id: string; lat: number; lng: number; heading?: number }
export interface Fix {
  lat: number; lng: number; heading: number | null
  speed: number // м/с
  accuracy: number // м
  ts: number // мс
}
export interface ProximityConfig {
  radiusM: number // R — порог срабатывания
  hysteresisM: number // перевзвод на R + H
  maxAccuracyM: number // фиксы хуже — игнорируем
  maxJumpSpeed: number // м/с; быстрее — считаем выбросом GPS
  fovDeg: number // "Впереди", если |bearing - heading| <= fovDeg
  minHeadingSpeed: number // м/с; медленнее heading считаем ненадёжным
  pollMarginS: number // запас радиуса выборки на шаг опроса (LocationManager ~2 с)
}
export interface Hit<E> { event: E; distanceM: number; dir: 'ahead' | 'near' }

export const DEFAULT_CFG: ProximityConfig = {
  radiusM: 500, hysteresisM: 100, maxAccuracyM: 50, maxJumpSpeed: 70,
  fovDeg: 35, minHeadingSpeed: 1.5, pollMarginS: 2.5,
}

const angleDiff = (a: number, b: number) => {
  const d = Math.abs(a - b) % 360
  return Math.min(d, 360 - d)
}

/** Равномерная сетка. lat0 — опорная широта проекции (регион: Брянск–Тула ≈ 53°). */
export class GridIndex<E extends GeoEvent> {
  private cells = new Map<string, E[]>()
  private where = new Map<string, string>()
  private born = new Map<string, number>()
  private counter = 0
  constructor(private cellM = 1000, private lat0 = 53) {}
  /** Растёт с каждым НОВЫМ id (обновление существующего не считается). */
  get seq() { return this.counter }
  bornSeq(id: string) { return this.born.get(id) ?? 0 }
  private mx(lng: number) { return lng * 111_320 * Math.cos((this.lat0 * Math.PI) / 180) }
  private my(lat: number) { return lat * 110_574 }
  private key(lat: number, lng: number) {
    return `${Math.floor(this.mx(lng) / this.cellM)},${Math.floor(this.my(lat) / this.cellM)}`
  }
  upsert(e: E) {
    this.detach(e.id)
    if (!this.born.has(e.id)) this.born.set(e.id, ++this.counter)
    const k = this.key(e.lat, e.lng)
    const arr = this.cells.get(k) ?? []
    arr.push(e)
    this.cells.set(k, arr)
    this.where.set(e.id, k)
  }
  remove(id: string) {
    this.detach(id)
    this.born.delete(id)
  }
  private detach(id: string) {
    const k = this.where.get(id)
    if (!k) return
    const arr = this.cells.get(k)
    if (arr) {
      const i = arr.findIndex((x) => x.id === id)
      if (i >= 0) arr.splice(i, 1)
      if (arr.length === 0) this.cells.delete(k)
    }
    this.where.delete(id)
  }
  within(lat: number, lng: number, r: number) {
    const cx = Math.floor(this.mx(lng) / this.cellM)
    const cy = Math.floor(this.my(lat) / this.cellM)
    const n = Math.ceil(r / this.cellM)
    const out: { event: E; distanceM: number }[] = []
    for (let x = cx - n; x <= cx + n; x++)
      for (let y = cy - n; y <= cy + n; y++)
        for (const e of this.cells.get(`${x},${y}`) ?? []) {
          const d = haversineMetres(lat, lng, e.lat, e.lng)
          if (d <= r) out.push({ event: e, distanceM: d })
        }
    return out
  }
}

interface S { armed: boolean; prevD: number }

const GAP_RESET_S = 30

export class ProximityEngine<E extends GeoEvent> {
  private state = new Map<string, S>()
  private last: Fix | null = null
  private rejects = 0
  private fixSeq = 0 // index.seq на момент прошлого обработанного фикса
  constructor(private index: GridIndex<E>, private cfg: ProximityConfig = DEFAULT_CFG) {}

  /** После паузы/возврата в приложение: следующий фикс — "первое появление", без алертов. */
  resync() { this.state.clear(); this.last = null; this.rejects = 0 }

  /** 'reject' — фикс отброшен; 'first' — нет непрерывной истории; 'continuing' — продолжение трека. */
  private accept(f: Fix): 'reject' | 'first' | 'continuing' {
    if (f.accuracy > this.cfg.maxAccuracyM) return 'reject'
    let p = this.last
    // Большая пауза (фон, туннель, свёрнутое приложение): история устарела —
    // начинаем заново, без алертов по уже "внутренним" событиям.
    if (p && (f.ts - p.ts) / 1000 > GAP_RESET_S) {
      this.state.clear(); this.last = null; this.rejects = 0; p = null
    }
    if (p) {
      const dt = (f.ts - p.ts) / 1000
      if (dt <= 0) return 'reject'
      const jump = haversineMetres(p.lat, p.lng, f.lat, f.lng) / dt > this.cfg.maxJumpSpeed
      // 3 отброшенных подряд — принимаем: иначе плохой первый фикс заблокирует всё.
      if (jump && ++this.rejects < 3) return 'reject'
    }
    this.rejects = 0
    this.last = f
    return p ? 'continuing' : 'first'
  }

  private direction(f: Fix, e: E): 'ahead' | 'near' | null {
    if (f.heading == null || !Number.isFinite(f.heading) || f.speed < this.cfg.minHeadingSpeed) return 'near'
    if (e.heading != null && angleDiff(e.heading, f.heading) > 45) return null // встречное направление
    return angleDiff(bearingDeg(f.lat, f.lng, e.lat, e.lng), f.heading) <= this.cfg.fovDeg ? 'ahead' : 'near'
  }

  update(f: Fix): Hit<E>[] {
    const mode = this.accept(f)
    if (mode === 'reject') return []
    const { radiusM: R, hysteresisM: H } = this.cfg
    const seen = new Set<string>()
    const hits: Hit<E>[] = []
    for (const { event, distanceM: d } of this.index.within(f.lat, f.lng, R + H + f.speed * this.cfg.pollMarginS)) {
      seen.add(event.id)
      let s = this.state.get(event.id)
      if (!s) {
        const known = this.index.bornSeq(event.id) <= this.fixSeq // уже был в индексе на прошлом фиксе
        if (mode === 'continuing' && known) {
          // Раньше было за зоной выборки (скачок/пропуск фиксов) → считаем
          // подходом извне: дальше сработает проверка пересечения.
          s = { armed: true, prevD: R + H + 1 }
          this.state.set(event.id, s)
        } else {
          // Старт внутри R или событие только что появилось — молча.
          this.state.set(event.id, { armed: d > R, prevD: d })
          continue
        }
      }
      if (d >= R + H) s.armed = true
      if (s.armed && s.prevD > R && d <= R) {
        s.armed = false
        const dir = this.direction(f, event)
        if (dir) hits.push({ event, distanceM: d, dir })
      }
      s.prevD = d
    }
    // Вне зоны выборки состояние эквивалентно "взведено" — не храним.
    for (const id of this.state.keys()) if (!seen.has(id)) this.state.delete(id)
    this.fixSeq = this.index.seq
    return hits.sort((a, b) => a.distanceM - b.distanceM)
  }
}
