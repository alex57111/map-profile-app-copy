import { useEffect, useState } from 'react'
import { COLORS, FONT, SPACING, RADIUS, SAFE_TOP } from '../ui/tokens'
import { EVENT_TYPE_CONFIG } from '../../types/event'
import type { ProximityAlert } from '../../hooks/useProximityAlerts'

interface Props {
  alerts: ProximityAlert[]
  onVote: (eventId: string, vote: 'yes' | 'no') => Promise<void>
  onDismiss: () => void
}

// Неблокирующий тост (заход 37): без затемнения карты, тапы проходят сквозь
// всё, кроме самой карточки. Заменяет EventAheadAlert, пока новый модуль
// работает; при сбое LocationScreen показывает старый EventAheadAlert.
export function ProximityToast({ alerts, onVote, onDismiss }: Props) {
  const [voted, setVoted] = useState(false)
  const first = alerts[0]
  const firstId = first?.event.id
  useEffect(() => { setVoted(false) }, [firstId])

  if (!first) return null
  const cfg = EVENT_TYPE_CONFIG[first.event.type]
  const d = first.distanceM
  const dist = d < 50 ? `${Math.round(d)} м`
    : d < 1000 ? `${Math.round(d / 10) * 10} м`
    : `${(d / 1000).toFixed(1)} км`
  const distColor = d < 100 ? COLORS.error : d < 200 ? COLORS.warning : COLORS.textPrimary

  const vote = async (v: 'yes' | 'no') => {
    if (voted) return
    setVoted(true)
    await onVote(first.event.id, v)
    setTimeout(onDismiss, 500)
  }

  return (
    <div
      role="status"
      aria-live="polite"
      style={{
        position: 'absolute',
        top: `calc(${SAFE_TOP} + var(--tg-safe-area-inset-top, 0px) + var(--tg-content-safe-area-inset-top, 0px) + 12px)`,
        left: SPACING.md, right: SPACING.md,
        zIndex: 450, pointerEvents: 'none',
        display: 'flex', justifyContent: 'center',
      }}
    >
      <div style={{
        pointerEvents: 'auto',
        display: 'flex', alignItems: 'center', gap: SPACING.sm,
        maxWidth: 420, width: '100%',
        padding: `${SPACING.sm}px ${SPACING.md}px`,
        backgroundColor: COLORS.mapOverlayHd,
        border: `2px solid ${cfg.color}`,
        borderRadius: RADIUS.lg,
        boxShadow: '0 4px 16px rgba(0,0,0,0.5)',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
      }}>
        <span style={{ fontSize: 30, lineHeight: 1 }}>{cfg.icon}</span>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div style={{ fontSize: FONT.xs, fontWeight: 800, letterSpacing: 1.5, color: cfg.color }}>
            {first.dir === 'ahead' ? 'ВПЕРЕДИ' : 'РЯДОМ'}
          </div>
          <div style={{ fontSize: FONT.md, fontWeight: 700, color: COLORS.textPrimary, whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>
            {cfg.label}{first.count > 1 ? ` ×${first.count}` : ''}
            {alerts.length > 1 ? ` · +${alerts.length - 1}` : ''}
          </div>
        </div>
        <div style={{ fontSize: FONT.xl, fontWeight: 800, color: distColor, fontVariantNumeric: 'tabular-nums' }}>
          {dist}
        </div>
        <button onClick={() => void vote('yes')} disabled={voted} aria-label="Подтвердить"
          style={{ ...btn, opacity: voted ? 0.4 : 1 }}>👍</button>
        <button onClick={() => void vote('no')} disabled={voted} aria-label="Не подтвердилось"
          style={{ ...btn, opacity: voted ? 0.4 : 1 }}>👎</button>
        <button onClick={onDismiss} aria-label="Закрыть"
          style={{ ...btn, color: COLORS.textSecond }}>✕</button>
      </div>
    </div>
  )
}

const btn = {
  background: 'none', border: 'none', fontSize: 20, padding: 6,
  cursor: 'pointer', WebkitTapHighlightColor: 'transparent', color: COLORS.textPrimary,
} as const
