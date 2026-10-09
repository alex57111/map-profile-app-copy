export type Theme = 'dark' | 'light'
export type Lang = 'ru' | 'en'
const THEME_KEY = 'app_theme'
const LANG_KEY = 'app_lang'
export function getTheme(): Theme { return (localStorage.getItem(THEME_KEY) as Theme) ?? 'dark' }
export function getLang(): Lang { return (localStorage.getItem(LANG_KEY) as Lang) ?? 'ru' }
export function setTheme(t: Theme): void { localStorage.setItem(THEME_KEY, t); window.dispatchEvent(new CustomEvent('app-settings-change')) }
export function setLang(l: Lang): void { localStorage.setItem(LANG_KEY, l); window.dispatchEvent(new CustomEvent('app-settings-change')) }
export const T: Record<string, Record<Lang, string>> = {
  profile:    { ru: 'Профиль',  en: 'Profile' },
  driver:     { ru: 'Водитель', en: 'Driver' },
  passenger:  { ru: 'Пассажир', en: 'Passenger' },
  settings:   { ru: 'Настройки', en: 'Settings' },
  theme_dark: { ru: 'Тёмная', en: 'Dark' },
  theme_light:{ ru: 'Светлая', en: 'Light' },
  edit:       { ru: 'Изменить', en: 'Edit' },
  anon:       { ru: 'Анонимный профиль', en: 'Anonymous profile' },
  loading:    { ru: 'Загрузка...', en: 'Loading...' },
  notif:      { ru: 'Уведомления о событиях', en: 'Event notifications' },
  voice:      { ru: 'Голосовые оповещения', en: 'Voice alerts' },
  on:         { ru: 'Вкл', en: 'On' },
}

// Переключатели в Профиле (заход 35): по умолчанию ВКЛ, читаются экраном Карта
// при открытии. '0' в localStorage = выключено.
const TRACK_KEY = 'app_track_location'
const KEEP_ON_KEY = 'app_keep_screen_on'
export function getTrackLocation(): boolean { return localStorage.getItem(TRACK_KEY) !== '0' }
export function setTrackLocation(v: boolean): void { localStorage.setItem(TRACK_KEY, v ? '1' : '0'); window.dispatchEvent(new CustomEvent('app-settings-change')) }
export function getKeepScreenOn(): boolean { return localStorage.getItem(KEEP_ON_KEY) !== '0' }
export function setKeepScreenOn(v: boolean): void { localStorage.setItem(KEEP_ON_KEY, v ? '1' : '0'); window.dispatchEvent(new CustomEvent('app-settings-change')) }

// Зум, выбранный пользователем (щипок), — заход 36. null = не выбирался.
const ZOOM_KEY = 'map_zoom_pref_v1'
export function getMapZoomPref(): number | null {
  try {
    const v = parseFloat(localStorage.getItem(ZOOM_KEY) ?? '')
    return Number.isFinite(v) ? v : null
  } catch { return null }
}
export function setMapZoomPref(z: number): void {
  try { localStorage.setItem(ZOOM_KEY, String(z)) } catch { /* приватный режим — не критично */ }
}
