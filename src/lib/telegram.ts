// Обёртка над Telegram WebApp JS API (window.Telegram.WebApp).
// Этап 1 (Telegram Mini App) — миграция AGENT_LOG.md заход 23.
//
// Важно: это ДОПОЛНЕНИЕ, не замена. Приложение остаётся рабочим на обычном
// вебе (Cloudflare Pages) и в Capacitor-оболочке (Android) — там
// window.Telegram не существует, все функции здесь — no-op в этом случае.
// Ничего из существующего поведения (auth, carousel экранов и т.д.) не
// меняется этим файлом.

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
