import type { CSSProperties } from 'react'
import { COLORS, FONT, SPACING, RADIUS, SAFE_TOP } from '../ui/tokens'
import type { GPSState } from '../../types/geo'
import { useDraggable } from '../../hooks/useDraggable'

interface Props { gps: GPSState; onlineCount: number; eventsCount: number }

const GPS_COLOR: Record<string, string> = {
  idle: COLORS.textDisabled, acquiring: COLORS.warning, active: COLORS.success,
  lost: COLORS.error, denied: COLORS.error, error: COLORS.error,
}

export function MapHUD({ gps, onlineCount, eventsCount }: Props) {
  const { pos, onPointerDown, onPointerMove, onPointerUp } = useDraggable({ x: 0, y: 0 })
  const speed = gps.position ? Math.round(gps.position.speed * 3.6) : null

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        top: `calc(${SAFE_TOP} + 12px)`,
        left: '50%',
        transform: `translate(calc(-50% + ${pos.x}px), ${pos.y}px)`,
        backgroundColor: 'rgba(15,15,15,0.75)',
        borderRadius: RADIUS.full,
        padding: '6px 14px',
        display: 'flex', alignItems: 'center', gap: SPACING.sm,
        fontSize: FONT.xs, color: COLORS.textPrimary,
        zIndex: 400, whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none',
        touchAction: 'none',
      }}
    >
      <span style={{ width: 7, height: 7, borderRadius: '50%', backgroundColor: GPS_COLOR[gps.status] ?? COLORS.textDisabled, flexShrink: 0, display: 'inline-block' }} />
      {gps.status === 'active' && gps.position ? (
        <>
          <span style={{ color: COLORS.success, fontWeight: 600 }}>{speed} км/ч</span>
          <span style={{ color: COLORS.border }}>|</span>
          <span>±{Math.round(gps.position.accuracy)}м</span>
        </>
      ) : (
        <span style={{ color: GPS_COLOR[gps.status] }}>
          {gps.status === 'acquiring' ? 'GPS...'
            : gps.status === 'denied' ? 'GPS запрещён'
            : gps.status === 'lost' ? 'Сигнал потерян'
            : 'GPS'}
        </span>
      )}
      <span style={{ color: COLORS.border }}>|</span>
      <span>👤 {onlineCount}</span>
      <span style={{ color: COLORS.border }}>|</span>
      <span>⚠️ {eventsCount}</span>
    </div>
  )
}

// FAB — перетаскиваемый, полупрозрачный
interface FABProps { onPress: () => void }

export function AddEventFAB({ onPress }: FABProps) {
  const { pos, onPointerDown, onPointerMove, onPointerUp, wasTap } = useDraggable({ x: 0, y: 0 })

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={(e) => { onPointerUp(); if (wasTap()) onPress() }}
      style={{
        position: 'absolute',
        bottom: 80 - pos.y,
        left: 16 + pos.x,
        width: 46.8, height: 46.8, borderRadius: '50%',
        opacity: 0.7,
        backgroundColor: 'rgba(249,115,22,0.75)',
        border: '1px solid rgba(249,115,22,0.5)',
        color: '#fff', fontSize: 23.4,
        display: 'flex', alignItems: 'center', justifyContent: 'center',
        cursor: 'grab', zIndex: 500,
        boxShadow: '0 4px 12px rgba(0,0,0,0.3)',
        WebkitTapHighlightColor: 'transparent',
        userSelect: 'none', WebkitUserSelect: 'none',
        touchAction: 'none',
        backdropFilter: 'blur(4px)',
      }}
    >
      ➕
    </div>
  )
}

// Зум — перетаскиваемый блок
interface ZoomProps {
  zoom: number; minZoom: number; maxZoom: number
  onZoomIn: () => void; onZoomOut: () => void
}

export function ZoomControls({ zoom, minZoom, maxZoom, onZoomIn, onZoomOut }: ZoomProps) {
  const { pos, onPointerDown, onPointerMove, onPointerUp } = useDraggable({ x: 0, y: 0 })
  const atMax = zoom >= maxZoom
  const atMin = zoom <= minZoom

  const btnStyle = (disabled: boolean): CSSProperties => ({
    width: 40, height: 40,
    backgroundColor: disabled ? 'rgba(30,30,30,0.6)' : 'rgba(26,26,26,0.88)',
    border: `1px solid ${disabled ? '#333' : '#444'}`,
    color: disabled ? COLORS.textDisabled : COLORS.textPrimary,
    fontSize: 22, fontWeight: 300,
    display: 'flex', alignItems: 'center', justifyContent: 'center',
    cursor: disabled ? 'default' : 'pointer',
    opacity: disabled ? 0.4 : 1,
    transition: 'all 0.2s',
    WebkitTapHighlightColor: 'transparent',
    userSelect: 'none',
  })

  return (
    <div
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      style={{
        position: 'absolute',
        top: 80 + pos.y,
        right: 12 - pos.x,
        display: 'flex', flexDirection: 'column', gap: 2,
        zIndex: 450, cursor: 'grab', touchAction: 'none',
        userSelect: 'none',
      }}
    >
      <button
        onClick={atMax ? undefined : onZoomIn}
        style={{ ...btnStyle(atMax), borderRadius: `${RADIUS.md}px ${RADIUS.md}px 0 0` }}
      >+</button>
      <button
        onClick={atMin ? undefined : onZoomOut}
        style={{ ...btnStyle(atMin), borderRadius: `0 0 ${RADIUS.md}px ${RADIUS.md}px` }}
      >−</button>
    </div>
  )
}
