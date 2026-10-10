import { COLORS, RADIUS, FONT, SPACING } from '../ui/tokens'

interface LocationPermissionGateProps {
  onAllow: () => void
  onDeny: () => void
}

/**
 * Экран-гейт внутри Telegram Mini App: без явного Да/Нет пользователя не
 * показываем карту. "Да" — запускает запрос геолокации (это нажатие и есть
 * тот самый user gesture, без которого в WebView разрешение часто не
 * срабатывает). "Нет" — закрывает Mini App (см. LocationScreen.tsx).
 * Только для Telegram-канала — веб/Capacitor это не затрагивает.
 */
export function LocationPermissionGate({ onAllow, onDeny }: LocationPermissionGateProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: COLORS.bg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: SPACING.lg, textAlign: 'center', gap: SPACING.md,
    }}>
      <div style={{ fontSize: 48 }}>📍</div>
      <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary }}>
        Нужна геолокация
      </div>
      <div style={{ fontSize: FONT.base, color: COLORS.textSecond, maxWidth: 280 }}>
        Карта и оповещения о событиях на дороге работают только с доступом
        к вашему местоположению.
      </div>
      <div style={{ fontSize: FONT.base, color: COLORS.textPrimary, maxWidth: 280, fontWeight: 600 }}>
        Ваша позиция видна, если приложение открыто.
      </div>
      <div style={{ display: 'flex', gap: SPACING.md, marginTop: SPACING.sm, width: '100%', maxWidth: 280 }}>
        <button
          onClick={onDeny}
          style={{
            flex: 1, padding: '14px 0', borderRadius: RADIUS.md,
            border: `1px solid ${COLORS.border}`, backgroundColor: 'transparent',
            color: COLORS.textSecond, fontSize: FONT.base, fontWeight: 600,
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          Нет
        </button>
        <button
          onClick={onAllow}
          style={{
            flex: 1, padding: '14px 0', borderRadius: RADIUS.md,
            border: 'none', backgroundColor: COLORS.accent,
            color: '#0F0F0F', fontSize: FONT.base, fontWeight: 700,
            cursor: 'pointer', WebkitTapHighlightColor: 'transparent',
          }}
        >
          Да
        </button>
      </div>
    </div>
  )
}
