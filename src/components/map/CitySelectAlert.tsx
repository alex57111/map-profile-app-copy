import { useState } from 'react'
import { COLORS, RADIUS, FONT, SPACING } from '../ui/tokens'
import { CITY_OPTIONS } from '../../data/cities'

interface Props {
  onConfirm: (cityIds: string[]) => void
  onClose: () => void
}

/**
 * Алерт выбора города(ов) — появляется САМ, один раз, через 5 сек после
 * загрузки карты, и сам закрывается через 5 сек, если нет ответа (таймеры —
 * в LocationScreen.tsx). Никакого отдельного элемента на экране для
 * повторного вызова нет — это ТЗ Alex (заход 28, правка захода 27, где
 * агент самовольно добавил кнопку и переключение камеры на город, чего не
 * просили).
 *
 * ВАЖНО: выбор НЕ двигает камеру — карта как следовала GPS-позиции
 * пользователя, так и продолжает следовать. Выбор только запоминается
 * (localStorage) под будущую логику "каких городов данные держать
 * активными". События на карте и так загружаются по всей базе
 * (useMapEvents), поэтому сами маркеры появляются независимо от этого
 * выбора.
 *
 * Офлайн-скачивание тайлов карты сюда сознательно не добавлено: массовая
 * заранее загрузка тайлов OSM нарушает их Tile Usage Policy (запрет на bulk
 * download) и может привести к бану IP для всех пользователей приложения
 * (обсуждали с Alex, заход 27).
 */
export function CitySelectAlert({ onConfirm, onClose }: Props) {
  const [selected, setSelected] = useState<Set<string>>(new Set())

  const toggle = (id: string) => {
    setSelected((prev) => {
      const next = new Set(prev)
      if (next.has(id)) next.delete(id); else next.add(id)
      return next
    })
  }

  const toggleAll = () => {
    setSelected((prev) => (prev.size === CITY_OPTIONS.length ? new Set() : new Set(CITY_OPTIONS.map((c) => c.id))))
  }

  const allChecked = selected.size === CITY_OPTIONS.length

  return (
    <div style={{
      position: 'fixed', inset: 0, zIndex: 900,
      backgroundColor: 'rgba(0,0,0,0.55)',
      display: 'flex', alignItems: 'flex-end', justifyContent: 'center',
    }} onClick={onClose}>
      <div
        onClick={(e) => e.stopPropagation()}
        style={{
          width: '100%', maxWidth: 420,
          backgroundColor: COLORS.bgCard,
          borderRadius: `${RADIUS.lg}px ${RADIUS.lg}px 0 0`,
          padding: SPACING.lg,
          paddingBottom: `calc(${SPACING.lg}px + env(safe-area-inset-bottom, 0px))`,
          boxShadow: '0 -4px 24px rgba(0,0,0,0.4)',
        }}
      >
        <div style={{ fontSize: FONT.lg, fontWeight: 700, color: COLORS.textPrimary, marginBottom: SPACING.xs }}>
          Загрузить карты городов?
        </div>
        <div style={{ fontSize: FONT.sm, color: COLORS.textSecond, marginBottom: SPACING.md }}>
          Отметьте города — карта по-прежнему будет следовать вашей GPS-позиции,
          выбор ни на что не влияет на экране. Можно выбрать несколько.
        </div>

        <button
          onClick={toggleAll}
          style={{
            display: 'flex', alignItems: 'center', gap: SPACING.sm, width: '100%',
            padding: `${SPACING.sm}px 0`, background: 'none', border: 'none',
            borderBottom: `1px solid ${COLORS.border}`, marginBottom: SPACING.xs,
            color: COLORS.accent, fontSize: FONT.base, fontWeight: 600, cursor: 'pointer',
            textAlign: 'left',
          }}
        >
          <span>{allChecked ? '☑' : '☐'}</span> Выбрать все
        </button>

        <div style={{ display: 'flex', flexDirection: 'column', gap: 2, marginBottom: SPACING.md }}>
          {CITY_OPTIONS.map((city) => (
            <button
              key={city.id}
              onClick={() => toggle(city.id)}
              style={{
                display: 'flex', alignItems: 'center', gap: SPACING.sm, width: '100%',
                padding: `${SPACING.sm}px 0`, background: 'none', border: 'none',
                color: COLORS.textPrimary, fontSize: FONT.base, cursor: 'pointer',
                textAlign: 'left',
              }}
            >
              <span style={{ color: selected.has(city.id) ? COLORS.accent : COLORS.textDisabled }}>
                {selected.has(city.id) ? '☑' : '☐'}
              </span>
              {city.name}
            </button>
          ))}
        </div>

        <div style={{ display: 'flex', gap: SPACING.md }}>
          <button
            onClick={onClose}
            style={{
              flex: 1, padding: '14px 0', borderRadius: RADIUS.md,
              border: `1px solid ${COLORS.border}`, backgroundColor: 'transparent',
              color: COLORS.textSecond, fontSize: FONT.base, fontWeight: 600, cursor: 'pointer',
            }}
          >
            Не сейчас
          </button>
          <button
            onClick={() => onConfirm([...selected])}
            disabled={selected.size === 0}
            style={{
              flex: 1, padding: '14px 0', borderRadius: RADIUS.md, border: 'none',
              backgroundColor: selected.size === 0 ? 'rgba(249,115,22,0.35)' : COLORS.accent,
              color: '#0F0F0F', fontSize: FONT.base, fontWeight: 700,
              cursor: selected.size === 0 ? 'default' : 'pointer',
            }}
          >
            Показать
          </button>
        </div>
      </div>
    </div>
  )
}
