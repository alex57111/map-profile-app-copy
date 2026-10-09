// Звук/вибро/голос для Proximity Alerts (заход 37). Всё в try/catch — сбой
// обратной связи не должен ронять карту. Ограничения Mini App:
//  - вибро: Telegram HapticFeedback (Bot API 6.1+) предпочтительнее
//    navigator.vibrate (на iOS его нет);
//  - звук: AudioContext нужно "разбудить" жестом пользователя — слушаем тапы;
//  - визуальный тост показывается всегда (звук может быть заглушён ОС).
import { getTelegramWebApp } from './telegram'

let ctx: AudioContext | null = null
let lastSpeechAt = 0
const SPEECH_MIN_GAP_MS = 5_000

function getCtx(): AudioContext | null {
  if (ctx) return ctx
  const Ctor = window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext
  if (!Ctor) return null
  ctx = new Ctor()
  return ctx
}

/** Вешает разблокировку звука на тапы; вернуть функцию отписки. */
export function installAudioUnlock(): () => void {
  const unlock = () => {
    try {
      const c = getCtx()
      if (c && c.state === 'suspended') void c.resume()
    } catch { /* нет аудио — ок */ }
  }
  window.addEventListener('pointerdown', unlock, { passive: true })
  return () => window.removeEventListener('pointerdown', unlock)
}

function beep() {
  const c = getCtx()
  if (!c || c.state !== 'running') return
  const t0 = c.currentTime
  for (const offset of [0, 0.22]) {
    const osc = c.createOscillator()
    const gain = c.createGain()
    osc.frequency.value = 880
    gain.gain.setValueAtTime(0.0001, t0 + offset)
    gain.gain.exponentialRampToValueAtTime(0.25, t0 + offset + 0.02)
    gain.gain.exponentialRampToValueAtTime(0.0001, t0 + offset + 0.16)
    osc.connect(gain).connect(c.destination)
    osc.start(t0 + offset)
    osc.stop(t0 + offset + 0.18)
  }
}

export function notifyProximity(speechText: string): void {
  try {
    const haptic = getTelegramWebApp()?.HapticFeedback
    if (haptic) haptic.notificationOccurred('warning')
    else if ('vibrate' in navigator) navigator.vibrate([200, 100, 200])
  } catch { /* ignore */ }
  try { beep() } catch { /* ignore */ }
  try {
    const now = Date.now()
    if ('speechSynthesis' in window && now - lastSpeechAt >= SPEECH_MIN_GAP_MS) {
      lastSpeechAt = now
      const utt = new SpeechSynthesisUtterance(speechText)
      utt.lang = 'ru-RU'
      utt.rate = 1.1
      window.speechSynthesis.speak(utt)
    }
  } catch { /* ignore */ }
}
