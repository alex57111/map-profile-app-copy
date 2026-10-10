import type { GPSPosition, GPSStatus } from '../types/geo'
import { isInsideTelegram, hasTelegramLocationManager, getTelegramLocation, getTelegramWebApp, type TelegramLocationData } from '../lib/telegram'

export type GPSCallback = (pos: GPSPosition) => void
export type GPSErrorCallback = (status: GPSStatus, msg: string, code?: number) => void

interface GPSEngineOptions {
  onPosition: GPSCallback
  onError: GPSErrorCallback
  maxAge?: number
  timeout?: number
  minDistanceM?: number
  minIntervalMs?: number
  // Заход 46: «пульс» — вызывается на КАЖДЫЙ валидный сырой фикс (даже если
  // позиция отфильтрована как неподвижная/неточная). Нужен для индикатора
  // качества связи: по нему видно, что GPS жив, хотя position не менялась.
  onHeartbeat?: (hb: { at: number; accuracy: number }) => void
}

interface KalmanState { lat: number; lng: number; variance: number }

const EARTH_R = 6_371_000

function haversineMetres(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const dLat = ((lat2 - lat1) * Math.PI) / 180
  const dLng = ((lng2 - lng1) * Math.PI) / 180
  const a = Math.sin(dLat / 2) ** 2 + Math.cos((lat1 * Math.PI) / 180) * Math.cos((lat2 * Math.PI) / 180) * Math.sin(dLng / 2) ** 2
  return EARTH_R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a))
}

function kalmanUpdate(state: KalmanState, measLat: number, measLng: number, accuracy: number, q = 3): KalmanState {
  const r = accuracy * accuracy
  const newVariance = state.variance + q
  const k = newVariance / (newVariance + r)
  return {
    lat: state.lat + k * (measLat - state.lat),
    lng: state.lng + k * (measLng - state.lng),
    variance: (1 - k) * newVariance,
  }
}

class HeadingSmootherImpl {
  private samples: number[] = []
  private readonly maxSamples: number
  constructor(maxSamples = 5) { this.maxSamples = maxSamples }
  push(heading: number): number {
    this.samples.push(heading)
    if (this.samples.length > this.maxSamples) this.samples.shift()
    let sinSum = 0, cosSum = 0
    for (const h of this.samples) {
      const r = (h * Math.PI) / 180
      sinSum += Math.sin(r)
      cosSum += Math.cos(r)
    }
    const mean = (Math.atan2(sinSum, cosSum) * 180) / Math.PI
    return (mean + 360) % 360
  }
  reset(): void { this.samples = [] }
}

// Интервал опроса Telegram LocationManager — это one-shot API (getLocation),
// не watch, поэтому поток координат имитируется периодическим вызовом.
const TELEGRAM_POLL_MS = 2_000

// Заход 46: защиты от «GPS не работает».
const TG_CALL_TIMEOUT_MS = 5_000   // getLocation/init иногда не отвечают вообще
const GOOD_ACC_M = 100             // выше — фикс считается неточным
const COARSE_ACC_M = 5_000         // ещё выше — вообще не показываем
const GOOD_WINDOW_MS = 15_000      // неточные фиксы режем, только если недавно был точный
const GAP_RESET_MS = 30_000        // после такой паузы фильтры и калман сбрасываются
const MAX_SPEED_MS = 70            // ~250 км/ч — быстрее не «едем», а «прыгаем»
const MAX_JUMP_REJECTS = 3         // столько подряд «прыжков» режем, потом принимаем
const WATCHDOG_MS = 3_000
const FALLBACK_AFTER_MS = 10_000   // Telegram молчит → подключаем navigator.geolocation
const STALE_AFTER_MS = 15_000      // нет фиксов → статус 'lost'
const RESTART_AFTER_MS = 20_000    // нет фиксов → перезапуск watchPosition

function withTimeout<T>(p: Promise<T>, ms: number, fallback: T): Promise<T> {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(fallback), ms)
    p.then((v) => { clearTimeout(t); resolve(v) }, () => { clearTimeout(t); resolve(fallback) })
  })
}

export class GPSEngine {
  private watchId: number | null = null
  private telegramPollId: ReturnType<typeof setInterval> | null = null
  private watchdogId: ReturnType<typeof setInterval> | null = null
  private stopped = false
  private kalman: KalmanState | null = null
  private headingSmoother = new HeadingSmootherImpl(5)
  private lastEmitTime = 0
  private lastEmitLat = 0
  private lastEmitLng = 0
  private lastRawAt = 0        // последний валидный сырой фикс (любой источник)
  private lastGoodAt = 0       // последний фикс с нормальной точностью
  private lastTgFixAt = 0      // последний фикс именно от Telegram
  private jumpRejects = 0
  private lastRestartAt = 0
  private staleReported = false
  private inTelegram = false
  private readonly opts: Required<GPSEngineOptions>

  constructor(opts: GPSEngineOptions) {
    this.opts = { maxAge: 3_000, timeout: 10_000, minDistanceM: 2, minIntervalMs: 1_000, onHeartbeat: () => {}, ...opts }
  }

  start(): void {
    this.stopped = false
    this.lastRawAt = Date.now()
    this.inTelegram = isInsideTelegram()
    // Внутри Telegram предпочитаем нативный LocationManager (Bot API 8.0+) —
    // обычный navigator.geolocation внутри Telegram WebView во многих
    // версиях клиента не работает (не триггерит системный запрос доступа).
    // navigator.geolocation подключается как запасной, только если Telegram
    // молчит (см. watchdog) — чтобы не вызывать лишних системных запросов.
    if (this.inTelegram) {
      void this.tryStartTelegram()
    } else {
      this.startBrowserWatch()
    }
    this.watchdogId = setInterval(() => this.watchdog(), WATCHDOG_MS)
    document.addEventListener('visibilitychange', this.onResume)
    try { getTelegramWebApp()?.onEvent('activated', this.onResume) } catch { /* старый клиент */ }
  }

  // Приложение вернулось на экран (сон, сворачивание, звонок): координаты за
  // время паузы «прыгнули» — сбрасываем фильтры, чтобы не застрять на старой
  // точке, и сразу перезапускаем источники.
  private onResume = (): void => {
    if (this.stopped) return
    if (document.visibilityState === 'hidden') return
    this.resetFilters()
    this.restartSources()
    if (this.inTelegram) void this.pollTelegram()
  }

  private resetFilters(): void {
    this.kalman = null
    this.jumpRejects = 0
    this.lastEmitTime = 0
    this.lastGoodAt = 0
    this.headingSmoother.reset()
  }

  private async pollTelegram(): Promise<void> {
    if (!hasTelegramLocationManager()) return
    const data = await withTimeout(getTelegramLocation(), TG_CALL_TIMEOUT_MS, null)
    if (this.stopped || !data) return
    this.handleTelegramFix(data)
  }

  private async tryStartTelegram(): Promise<void> {
    if (hasTelegramLocationManager()) {
      const first = await withTimeout(getTelegramLocation(), TG_CALL_TIMEOUT_MS, null)
      if (this.stopped) return
      if (first) this.handleTelegramFix(first)
      // Опрос идёт всегда (даже если первый ответ пуст): доступ могли выдать
      // позже, а Telegram мог просто не успеть ответить.
      this.telegramPollId = setInterval(() => { void this.pollTelegram() }, TELEGRAM_POLL_MS)
    }
    if (!this.stopped && this.lastTgFixAt === 0) {
      // LocationManager недоступен/нет доступа в этом клиенте — запасной путь.
      this.startBrowserWatch()
    }
  }

  private startBrowserWatch(): void {
    if (this.watchId !== null) return
    if (!navigator.geolocation) {
      this.opts.onError('denied', 'Геолокация не поддерживается устройством')
      return
    }
    // Быстрый грубый фикс (сеть/кэш) — карта центрируется, пока ждём точный GPS.
    try {
      navigator.geolocation.getCurrentPosition(
        (raw) => this.handleRaw(raw),
        () => { /* ошибки обрабатывает watchPosition */ },
        { enableHighAccuracy: false, maximumAge: 60_000, timeout: 8_000 }
      )
    } catch { /* нет — не страшно */ }
    this.watchId = navigator.geolocation.watchPosition(
      (raw) => this.handleRaw(raw),
      (err) => this.handleGeoError(err),
      { enableHighAccuracy: true, maximumAge: this.opts.maxAge, timeout: this.opts.timeout }
    )
  }

  private restartSources(): void {
    this.lastRestartAt = Date.now()
    if (this.watchId !== null) {
      try { navigator.geolocation.clearWatch(this.watchId) } catch { /* ignore */ }
      this.watchId = null
      this.startBrowserWatch()
    }
  }

  private watchdog(): void {
    if (this.stopped) return
    const now = Date.now()
    const idle = now - this.lastRawAt
    if (this.inTelegram && this.watchId === null && idle > FALLBACK_AFTER_MS) this.startBrowserWatch()
    if (idle > RESTART_AFTER_MS && now - this.lastRestartAt > RESTART_AFTER_MS) this.restartSources()
    if (idle > STALE_AFTER_MS && !this.staleReported) {
      this.staleReported = true
      this.opts.onError('lost', 'Нет сигнала GPS')
    }
  }

  stop(): void {
    this.stopped = true
    if (this.watchId !== null) {
      try { navigator.geolocation.clearWatch(this.watchId) } catch { /* ignore */ }
      this.watchId = null
    }
    if (this.telegramPollId !== null) {
      clearInterval(this.telegramPollId)
      this.telegramPollId = null
    }
    if (this.watchdogId !== null) {
      clearInterval(this.watchdogId)
      this.watchdogId = null
    }
    document.removeEventListener('visibilitychange', this.onResume)
    try { getTelegramWebApp()?.offEvent('activated', this.onResume) } catch { /* ignore */ }
    this.kalman = null
    this.headingSmoother.reset()
  }

  private handleTelegramFix(data: TelegramLocationData): void {
    this.lastTgFixAt = Date.now()
    this.emit({
      latitude: data.latitude,
      longitude: data.longitude,
      accuracy: data.horizontal_accuracy ?? 30,
      heading: data.course ?? null,
      speed: data.speed ?? null,
    })
  }

  private handleRaw(raw: GeolocationPosition): void {
    const { latitude, longitude, accuracy, heading, speed } = raw.coords
    this.emit({ latitude, longitude, accuracy, heading, speed })
  }

  private emit(fix: {
    latitude: number; longitude: number; accuracy: number
    heading: number | null; speed: number | null
  }): void {
    const { latitude, longitude, heading, speed } = fix
    // Мусорные координаты (NaN/вне диапазона) — отбрасываем до всего остального.
    if (!Number.isFinite(latitude) || !Number.isFinite(longitude)) return
    if (Math.abs(latitude) > 90 || Math.abs(longitude) > 180) return
    const accuracy = Number.isFinite(fix.accuracy) && fix.accuracy > 0 ? fix.accuracy : 30

    const now = Date.now()
    this.lastRawAt = now
    this.staleReported = false
    this.opts.onHeartbeat({ at: now, accuracy })

    // Точность: раньше любой фикс >100 м резался насовсем — в городе/в
    // помещении позиция так и не появлялась. Теперь неточный фикс принимается,
    // пока точного ещё не было; точные потом уточняют его.
    if (accuracy > COARSE_ACC_M) return
    if (accuracy > GOOD_ACC_M && now - this.lastGoodAt < GOOD_WINDOW_MS) return
    if (accuracy <= GOOD_ACC_M) this.lastGoodAt = now

    // Долгая пауза (тоннель, сон) — начинаем с чистого листа.
    if (this.lastEmitTime > 0 && now - this.lastEmitTime > GAP_RESET_MS) this.resetFilters()

    // Фильтр «прыжков». Раньше после ОДНОГО прыжка >500 м от первой (возможно
    // плохой) точки все дальнейшие фиксы отбрасывались навсегда. Теперь порог
    // растёт со временем, а после нескольких подряд «прыжков» новая точка
    // принимается как истинная.
    if (this.lastEmitTime > 0) {
      const jump = haversineMetres(this.lastEmitLat, this.lastEmitLng, latitude, longitude)
      const dt = (now - this.lastEmitTime) / 1000
      if (jump > Math.max(500, MAX_SPEED_MS * dt)) {
        this.jumpRejects++
        if (this.jumpRejects < MAX_JUMP_REJECTS) return
        this.kalman = null
      }
    }
    this.jumpRejects = 0

    if (!this.kalman) this.kalman = { lat: latitude, lng: longitude, variance: accuracy * accuracy }
    this.kalman = kalmanUpdate(this.kalman, latitude, longitude, accuracy)
    if (now - this.lastEmitTime < this.opts.minIntervalMs) return
    const dist = haversineMetres(this.lastEmitLat, this.lastEmitLng, this.kalman.lat, this.kalman.lng)
    if (this.lastEmitTime > 0 && dist < this.opts.minDistanceM) return
    const rawHeading = heading != null && Number.isFinite(heading)
      ? heading : this.derivedHeading(this.kalman.lat, this.kalman.lng)
    const smoothHeading = this.headingSmoother.push(rawHeading)
    const pos: GPSPosition = {
      lat: this.kalman.lat, lng: this.kalman.lng, heading: smoothHeading,
      speed: speed != null && Number.isFinite(speed) && speed >= 0 ? speed : 0,
      accuracy, timestamp: now,
    }
    this.lastEmitTime = now
    this.lastEmitLat = this.kalman.lat
    this.lastEmitLng = this.kalman.lng
    this.opts.onPosition(pos)
  }

  private derivedHeading(lat: number, lng: number): number {
    if (this.lastEmitTime === 0) return 0
    const dLng = lng - this.lastEmitLng
    const dLat = lat - this.lastEmitLat
    const angle = (Math.atan2(dLng, dLat) * 180) / Math.PI
    return (angle + 360) % 360
  }

  private handleGeoError(err: GeolocationPositionError): void {
    // В Telegram браузерный GPS — только запасной: пока Telegram отдаёт фиксы,
    // его ошибки (например, запрет в WebView) не должны перебивать статус.
    if (this.inTelegram && Date.now() - this.lastTgFixAt < FALLBACK_AFTER_MS) return
    switch (err.code) {
      case err.PERMISSION_DENIED: this.opts.onError('denied', 'Доступ к геолокации запрещён', err.code); break
      case err.POSITION_UNAVAILABLE: this.opts.onError('lost', 'Сигнал GPS потерян', err.code); break
      case err.TIMEOUT: this.opts.onError('error', 'Превышено время ожидания GPS', err.code); break
    }
  }
}
