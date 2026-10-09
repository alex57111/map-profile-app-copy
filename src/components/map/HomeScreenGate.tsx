import { COLORS, RADIUS, FONT, SPACING } from '../ui/tokens'

interface HomeScreenGateProps {
  onAllow: () => void
  onDeny: () => void
}

/**
 * Запрос Да/Нет при загрузке внутри Telegram Mini App (заход 34), по образцу
 * LocationPermissionGate. "Да" — вызывает системный запрос Telegram на ярлык
 * (addToHomeScreen), "Нет" — просто закрывает окно, дальше всё как раньше.
 */
export function HomeScreenGate({ onAllow, onDeny }: HomeScreenGateProps) {
  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 1000,
      backgroundColor: COLORS.bg,
      display: 'flex', flexDirection: 'column',
      alignItems: 'center', justifyContent: 'center',
      padding: SPACING.lg, textAlign: 'center', gap: SPACING.md,
    }}>
      <div style={{ fontSize: 48 }}>📲</div>
      <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary }}>
        Добавить на главный экран?
      </div>
      <div style={{ fontSize: FONT.base, color: COLORS.textSecond, maxWidth: 280 }}>
        Приложение будет открываться с иконки, как обычное.
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
