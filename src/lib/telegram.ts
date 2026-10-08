// Обёртка над Telegram WebApp JS API (window.Telegram.WebApp).
// Этап 1 (Telegram Mini App) — миграция AGENT_LOG.md заход 23.
//
// Важно: это ДОПОЛНЕНИЕ, не замена. Приложение остаётся рабочим на обычном
// вебе (Cloudflare Pages) и в Capacitor-оболочке (Android) — там
// window.Telegram не существует, все функции здесь — no-op в этом случае.
// Ничего из существующего поведения (auth, carousel экранов и т.д.) не
// меняется этим файлом.

export interface TelegramLocationData {
  latitude: number
  longitude: number
  altitude: number | null
  course: number | null
  speed: number | null
  horizontal_accuracy: number | null
  vertical_accuracy: number | null
  course_accuracy: number | null
  speed_accuracy: number | null
}

export interface TelegramLocationManager {
  isInited: boolean
  isLocationAvailable: boolean
  isAccessRequested: boolean
  isAccessGranted: boolean
  init: (callback?: () => void) => void
  getLocation: (callback: (data: TelegramLocationData | null) => void) => void
  openSettings: () => void
}

export interface TelegramWebApp {
  initData: string
  initDataUnsafe: Record<string, unknown>
  colorScheme: 'light' | 'dark'
  themeParams: Record<string, string>
  viewportHeight: number
  ready: () => void
  expand: () => void
  close: () => void
  onEvent: (eventType: string, callback: () => void) => void
  offEvent: (eventType: string, callback: () => void) => void
  // Bot API 8.0+ — может отсутствовать в старых клиентах Telegram, поэтому
  // везде, где используется, нужна проверка на undefined.
  LocationManager?: TelegramLocationManager
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TelegramWebApp }
  }
}

export function getTelegramWebApp(): TelegramWebApp | null {
  return window.Telegram?.WebApp ?? null
}

/**
 * true только если приложение реально открыто внутри Telegram
 * (скрипт telegram-web-app.js загружен И initData не пуст).
 */
export function isInsideTelegram(): boolean {
  const wa = getTelegramWebApp()
  return !!wa && typeof wa.initData === 'string' && wa.initData.length > 0
}

/**
 * Сырая строка initData. ОБЯЗАТЕЛЬНО валидируется на сервере при
 * использовании для аутентификации (Supabase Edge Function) —
 * initDataUnsafe на клиенте НЕ считается доверенным источником
 * (см. README.md, раздел Telegram Mini App).
 */
export function getInitData(): string {
  return getTelegramWebApp()?.initData ?? ''
}

/**
 * Инициализация WebApp — вызывать один раз при старте приложения
 * (main.tsx). Вне Telegram — безопасный no-op.
 */
export function initTelegramWebApp(): void {
  const wa = getTelegramWebApp()
  if (!wa) return
  try {
    wa.ready()
    wa.expand()
  } catch {
    // защитный catch — на случай неполной реализации API в нестандартном клиенте
  }
}

/**
 * true, если в этом клиенте Telegram в принципе есть LocationManager
 * (Bot API 8.0+, апрель 2024). В старых версиях приложения Telegram
 * его нет — тогда используем обычный navigator.geolocation (см. gps.ts).
 */
export function hasTelegramLocationManager(): boolean {
  return !!getTelegramWebApp()?.LocationManager
}

let locationManagerInitPromise: Promise<void> | null = null

function ensureLocationManagerInited(): Promise<void> {
  const lm = getTelegramWebApp()?.LocationManager
  if (!lm) return Promise.resolve()
  if (lm.isInited) return Promise.resolve()
  if (!locationManagerInitPromise) {
    locationManagerInitPromise = new Promise((resolve) => {
      try {
        lm.init(() => resolve())
      } catch {
        resolve()
      }
    })
  }
  return locationManagerInitPromise
}

/**
 * Запрашивает одну координату через нативный Telegram LocationManager.
 * Возвращает null, если API недоступен, доступ не дан, или пользователь
 * отказал — тогда вызывающий код (gps.ts) сам решает, откатываться ли
 * на navigator.geolocation. ВАЖНО: это one-shot запрос, не watch — для
 * потока координат вызывающий код опрашивает её периодически (см. gps.ts).
 */
export async function getTelegramLocation(): Promise<TelegramLocationData | null> {
  const lm = getTelegramWebApp()?.LocationManager
  if (!lm) return null
  await ensureLocationManagerInited()
  if (!lm.isLocationAvailable) return null
  return new Promise((resolve) => {
    try {
      lm.getLocation((data) => resolve(data))
    } catch {
      resolve(null)
    }
  })
}
