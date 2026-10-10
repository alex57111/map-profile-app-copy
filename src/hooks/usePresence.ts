import { useEffect, useRef, useState } from 'react'
import type { OnlineUser } from '../types/user'
import type { GPSPosition } from '../types/geo'
import { useAuth } from './useAuth'
import { Sentry } from '../lib/sentry'
import { PRESENCE_ENABLED, reportPresence, removePresenceRemote, fetchOnlineUsers } from '../lib/presenceApi'

// Заход 53: настоящее присутствие вместо захардкоженных mock-пользователей.
// - Все: пока Карта открыта и приложение видно — раз в REPORT_MS шлют свою позицию.
//   Свернули / закрыли карту — позиция удаляется (на сервере и так «протухает» за 30 с).
// - Только админ (проверяет сервер): раз в POLL_MS получает список онлайн.
//   onlineUsers — без самого админа (его маркер рисуется отдельно); onlineCount —
//   всего онлайн, включая админа; null — не админ (плашка счётчик не показывает).
const REPORT_MS = 5_000
const POLL_MS = 5_000
const MAX_FIX_AGE_MS = 20_000 // позицию старше — не отправляем

const NO_USERS: OnlineUser[] = []

export function usePresence(position: GPSPosition | null) {
  const auth = useAuth()
  const authenticated = auth.status === 'authenticated'
  const [onlineUsers, setOnlineUsers] = useState<OnlineUser[]>(NO_USERS)
  const [onlineCount, setOnlineCount] = useState<number | null>(null)
  const [admin, setAdmin] = useState(false)

  const posRef = useRef<GPSPosition | null>(position)
  posRef.current = position
  const errorReported = useRef(false)
  const reportError = (e: unknown, op: string) => {
    if (errorReported.current) return // не засоряем Sentry повторами
    errorReported.current = true
    Sentry.captureException(e, { tags: { op } })
  }

  // Статус админа читаем из БД при открытии карты (карта размонтируется при смене вкладки).
  useEffect(() => {
    if (!PRESENCE_ENABLED || !authenticated) { setAdmin(false); return }
    let alive = true
    auth.isAdmin().then((v) => { if (alive) setAdmin(v) }).catch(() => { if (alive) setAdmin(false) })
    return () => { alive = false }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  // Отправка своей позиции.
  useEffect(() => {
    if (!PRESENCE_ENABLED || !authenticated) return
    let stopped = false
    const tick = () => {
      const p = posRef.current
      if (stopped || document.visibilityState !== 'visible' || !p) return
      if (Date.now() - p.timestamp > MAX_FIX_AGE_MS) return
      reportPresence(p.lat, p.lng, p.heading, p.speed).catch((e) => reportError(e, 'usePresence.report'))
    }
    const remove = () => { removePresenceRemote().catch(() => { /* сервер всё равно протухнет за 30 с */ }) }
    const onVisibility = () => { if (document.visibilityState === 'hidden') remove(); else tick() }
    tick()
    const id = setInterval(tick, REPORT_MS)
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', remove)
    return () => {
      stopped = true
      clearInterval(id)
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', remove)
      remove()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated])

  // Список онлайн — только админ.
  useEffect(() => {
    if (!PRESENCE_ENABLED || !authenticated || !admin) { setOnlineUsers(NO_USERS); setOnlineCount(null); return }
    let stopped = false
    const poll = () => {
      if (stopped || document.visibilityState !== 'visible') return
      fetchOnlineUsers().then((rows) => {
        if (stopped) return
        setOnlineUsers(rows.filter((r) => !r.isSelf).map((r) => r.user))
        setOnlineCount(rows.length)
      }).catch((e) => reportError(e, 'usePresence.poll'))
    }
    poll()
    const id = setInterval(poll, POLL_MS)
    return () => { stopped = true; clearInterval(id); setOnlineUsers(NO_USERS); setOnlineCount(null) }
  }, [authenticated, admin])

  const removePresence = async () => { try { await removePresenceRemote() } catch { /* ignore */ } }
  return { onlineUsers, onlineCount, removePresence }
}
