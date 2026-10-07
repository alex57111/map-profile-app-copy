import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import { initSentry, Sentry } from './lib/sentry'
import { initTelegramWebApp } from './lib/telegram'

// Инициализация Sentry — до рендера App, п.3.2 BLOKNOTERROR.md ТЗ
initSentry()

// Инициализация Telegram WebApp (заход 23, миграция в Mini App) — вне
// Telegram безопасный no-op, остальные каналы (Cloudflare Pages, Capacitor)
// не затрагивает.
initTelegramWebApp()

const style = document.createElement('style')
style.textContent = `
*, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }
html, body { height: 100%; overflow: hidden; background: #0F0F0F; }
input, button, textarea, select { font-family: inherit; }
button { -webkit-tap-highlight-color: transparent; }
`
document.head.appendChild(style)

// п.6.5.1 ТЗ: Sentry.ErrorBoundary вокруг App — падение рендера любого
// компонента (LeafletMap, AddEventSheet, EventDetailSheet и т.д.) больше не
// даёт белый экран без следа в Sentry: событие уходит в Sentry, а пользователь
// видит понятный экран с кнопкой перезагрузки вместо пустого экрана.
function ErrorFallback() {
  return (
    <div style={{
      position: 'fixed', inset: 0, display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center', gap: 16,
      backgroundColor: '#0F0F0F', color: '#FFFFFF',
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      padding: 24, textAlign: 'center',
    }}>
      <div style={{ fontSize: 40 }}>⚠️</div>
      <div style={{ fontSize: 16, fontWeight: 600 }}>Что-то пошло не так</div>
      <div style={{ fontSize: 13, color: '#9A9A9A', maxWidth: 280 }}>
        Приложение столкнулось с ошибкой. Мы уже получили отчёт о ней.
      </div>
      <button
        onClick={() => window.location.reload()}
        style={{
          marginTop: 8, padding: '10px 20px', borderRadius: 10, border: 'none',
          backgroundColor: '#F97316', color: '#0F0F0F', fontWeight: 600,
          fontSize: 14, cursor: 'pointer',
        }}
      >
        Перезагрузить
      </button>
    </div>
  )
}

const root = document.getElementById('root')
if (!root) throw new Error('Root element not found')
createRoot(root).render(
  <StrictMode>
    <Sentry.ErrorBoundary fallback={<ErrorFallback />} showDialog={false}>
      <App />
    </Sentry.ErrorBoundary>
  </StrictMode>
)
