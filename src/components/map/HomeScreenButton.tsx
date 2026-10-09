import { useEffect, useState } from 'react'
import { COLORS, FONT, RADIUS } from '../ui/tokens'
import {
  addToHomeScreen,
  checkHomeScreenStatus,
  getTelegramWebApp,
  isInsideTelegram,
} from '../../lib/telegram'

// Кнопка «На главный экран» (заход 33). Показывается только внутри Telegram,
// если клиент поддерживает API (Bot API 8.0+) и ярлык ещё не добавлен.
// Отступ сверху учитывает safe area Telegram — в fullscreen там нативные
// кнопки Telegram (переменные задаёт telegram-web-app.js).
export function HomeScreenButton() {
  const [visible, setVisible] = useState(false)

  useEffect(() => {
    if (!isInsideTelegram()) return
    let alive = true
    checkHomeScreenStatus().then((status) => {
      if (alive) setVisible(status === 'missed' || status === 'unknown')
    })
    const wa = getTelegramWebApp()
    const onAdded = () => setVisible(false)
    wa?.onEvent('homeScreenAdded', onAdded)
    return () => {
      alive = false
      wa?.offEvent('homeScreenAdded', onAdded)
    }
  }, [])

  if (!visible) return null

  return (
    <button
      onClick={addToHomeScreen}
      style={{
        position: 'absolute',
        top: 'calc(var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px) + 12px)',
        right: 12,
        zIndex: 430,
        backgroundColor: 'rgba(15,15,15,0.75)',
        color: COLORS.textPrimary,
        border: 'none',
        borderRadius: RADIUS.full,
        padding: '6px 12px',
        fontSize: FONT.xs,
        fontWeight: 600,
        backdropFilter: 'blur(8px)',
        WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        cursor: 'pointer',
        whiteSpace: 'nowrap',
      }}
    >
      📲 На главный экран
    </button>
  )
}
