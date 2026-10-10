import { useEffect, useRef, useState } from 'react'
import type { CSSProperties } from 'react'
import { COLORS, FONT, SPACING, RADIUS, SAFE_TOP } from '../ui/tokens'
import type { GPSState } from '../../types/geo'
import { useDraggable } from '../../hooks/useDraggable'
import { EVENT_TYPE_CONFIG } from '../../types/event'
import { COUNTED_TYPES, type EventCounts } from '../../hooks/useNearbyEventCounts'
import { gpsQuality, type GpsQuality } from '../../engines/gpsQuality'

// Заход 53: onlineCount — число пользователей онлайн; передаётся только админу
// (у остальных undefined/null — счётчик не показывается).
interface Props { gps: GPSState; counts: EventCounts | null; onlineCount?: number | null }

// Заход 46: цвет всей плашки = качество связи GPS (gpsQuality): зелёный —
// уверенная, жёлтый — плохая, красный — нет связи / очень плохая (+ надпись).
const QUALITY_BG: Record<GpsQuality, string> = {
  good: 'rgba(22,163,74,0.88)',
  poor: 'rgba(202,138,4,0.92)',
  none: 'rgba(220,38,38,0.92)',
}

// Заход 45: плашка перетаскивается в любое место; у левого/правого края
// экрана перестраивается в вертикальную колонку. Положение хранится на уровне
// модуля — плашка размонтируется при показе алерта/маршрута, и без этого
// каждый раз возвращалась бы наверх по центру.
const EDGE_PX = 48 // палец ближе этого расстояния к краю → край
const MARGIN = 4
type Dock = 'left' | 'right' | null
interface HudPlace { x: number; y: number; dock: Dock }
let hudPlace: HudPlace | null = null // null = стандартное место: вверху по центру

export function MapHUD({ gps, counts, onlineCount }: Props) {
  const ref = useRef<HTMLDivElement>(null)
  const [place, setPlaceState] = useState<HudPlace | null>(hudPlace)
  const setPlace = (p: HudPlace | null) => { hudPlace = p; setPlaceState(p) }
  const drag = useRef<{ dx: number; dy: number } | null>(null)
  const vertical = place?.dock != null

  // Качество зависит от времени (фикс «стареет»), поэтому раз в секунду пересчитываем.
  const [now, setNow] = useState(() => Date.now())
  useEffect(() => {
    const id = setInterval(() => setNow(Date.now()), 1_000)
    return () => clearInterval(id)
  }, [])
  const quality = gpsQuality(gps, now)

  const onPointerDown = (e: React.PointerEvent) => {
    const r = ref.current?.getBoundingClientRect()
    if (!r) return
    drag.current = { dx: e.clientX - r.left, dy: e.clientY - r.top }
    e.currentTarget.setPointerCapture(e.pointerId); e.stopPropagation()
  }
  const onPointerMove = (e: React.PointerEvent) => {
    if (!drag.current) return
    const w = window.innerWidth
    const dock: Dock = e.clientX <= EDGE_PX ? 'left' : e.clientX >= w - EDGE_PX ? 'right' : null
    const h = ref.current?.offsetHeight ?? 0
    const y = Math.max(MARGIN, Math.min(window.innerHeight - h - MARGIN, e.clientY - drag.current.dy))
    setPlace({ x: e.clientX - drag.current.dx, y, dock })
  }
  const onPointerUp = () => { drag.current = null }

  const pos: CSSProperties = !place
    ? { top: `calc(${SAFE_TOP} + 12px)`, left: '50%', transform: 'translateX(-50%)' }
    : place.dock === 'left' ? { top: place.y, left: MARGIN }
    : place.dock === 'right' ? { top: place.y, right: MARGIN }
    : { top: place.y, left: Math.max(MARGIN, place.x) }

  return (
    <div
      ref={ref}
      onPointerDown={onPointerDown}
      onPointerMove={onPointerMove}
      onPointerUp={onPointerUp}
      onPointerCancel={onPointerUp}
      style={{
        position: 'absolute',
        ...pos,
        backgroundColor: QUALITY_BG[quality],
        borderRadius: vertical ? RADIUS.lg : RADIUS.xl,
        padding: vertical ? '8px 8px' : '6px 14px',
        display: 'flex', flexDirection: vertical ? 'column' : 'row', alignItems: 'center', gap: SPACING.sm,
        fontSize: FONT.xs, color: '#fff', fontWeight: 600,
        zIndex: 400, whiteSpace: 'nowrap',
        backdropFilter: 'blur(8px)', WebkitBackdropFilter: 'blur(8px)',
        boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
        transition: 'background-color 0.4s',
        cursor: 'grab', userSelect: 'none', WebkitUserSelect: 'none',
        touchAction: 'none',
      }}
    >
      {COUNTED_TYPES.map((t) => (
        <span key={t} title="События в радиусе 50 км">{EVENT_TYPE_CONFIG[t].icon} {counts ? counts[t] : '–'}</span>
      ))}
      {typeof onlineCount === 'number' && <span title="Пользователи онлайн">👥 {onlineCount}</span>}
      {quality === 'none' && <span style={{ fontWeight: 800 }}>нет связи</span>}
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
