
import { useState } from 'react'
import { AdaptersProvider } from './hooks/useAdapters'
import { AuthProvider, useAuth } from './hooks/useAuth'
import { LocationScreen } from './screens/LocationScreen'
import { ProfileScreen } from './screens/ProfileScreen'
import { useSettings } from './hooks/useSettings'
import { FONT, SAFE_BOTTOM, TAB_HEIGHT } from './components/ui/tokens'
import { getTelegramWebApp } from './lib/telegram'

type TabId = 'map' | 'chat' | 'profile'

const CHAT_URL = 'https://t.me/+xgDlkNKGa39mMjUy'

// «Чат» — не экран: клик открывает группу в Telegram, активная вкладка не меняется.
function openChat() {
  const wa = getTelegramWebApp()
  try {
    if (wa?.openTelegramLink) { wa.openTelegramLink(CHAT_URL); return }
  } catch { /* падаем в window.open */ }
  window.open(CHAT_URL, '_blank', 'noopener')
}

function AppContent() {
  const [tab, setTab] = useState<TabId>('map')
  const { theme } = useSettings()
  // Единственная точка входа в auth-стейт на уровне корневого компонента —
  // AuthProvider (см. export default App() ниже) стартует анонимный вход
  // сразу при монтировании, независимо от того, какая вкладка открыта первой.
  // Статус прокидывается вниз пропом, чтобы LocationScreen мог заблокировать
  // создание события, пока идёт вход (status: 'loading').
  const authStatus = useAuth().status
  const isDark = theme === 'dark'
  const bg = isDark ? '#0F0F0F' : '#F5F5F5'
  const cardBg = isDark ? '#1A1A1A' : '#FFFFFF'
  const border = isDark ? '#2E2E2E' : '#D0D0D0'

  return (
    <div style={{
      position: 'fixed', inset: 0, backgroundColor: bg,
      fontFamily: '-apple-system, BlinkMacSystemFont, "Segoe UI", sans-serif',
      WebkitFontSmoothing: 'antialiased',
      transition: 'background-color 0.3s',
    }}>
      {tab === 'map'     && <LocationScreen authStatus={authStatus} />}
      {tab === 'profile' && <ProfileScreen />}

      <nav style={{
        position: 'fixed', bottom: 0, left: 0, right: 0,
        height: TAB_HEIGHT, paddingBottom: SAFE_BOTTOM,
        backgroundColor: cardBg, borderTop: `1px solid ${border}`,
        display: 'flex', alignItems: 'stretch', zIndex: 100,
        backdropFilter: 'blur(12px)', WebkitBackdropFilter: 'blur(12px)',
      }}>
        {([
          { id: 'map' as TabId,     icon: '🗺️', label: isDark || true ? 'Карта' : 'Map' },
          { id: 'chat' as TabId,    icon: '💬', label: 'ЧАТ' },
          { id: 'profile' as TabId, icon: '👤', label: isDark || true ? 'Профиль' : 'Profile' },
        ]).map((t) => (
          <button key={t.id} onClick={() => (t.id === 'chat' ? openChat() : setTab(t.id))} style={{
            flex: 1, display: 'flex', flexDirection: 'column',
            alignItems: 'center', justifyContent: 'center', gap: 2,
            background: 'none', border: 'none', cursor: 'pointer', padding: '6px 0',
            color: tab === t.id ? '#F97316' : (isDark ? '#4A4A4A' : '#AAAAAA'),
            transition: 'color 0.15s', WebkitTapHighlightColor: 'transparent', minHeight: 44,
          }}>
            <span style={{ fontSize: 22, lineHeight: 1 }}>{t.icon}</span>
            <span style={{ fontSize: FONT.xs, lineHeight: 1.2, fontWeight: tab === t.id ? 600 : 400 }}>
              {t.label}
            </span>
          </button>
        ))}
      </nav>
    </div>
  )
}

export default function App() {
  return (
    <AdaptersProvider>
      <AuthProvider>
        <AppContent />
      </AuthProvider>
    </AdaptersProvider>
  )
}
