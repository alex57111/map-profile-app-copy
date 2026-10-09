import { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { GridIndex, ProximityEngine, DEFAULT_CFG, type Hit } from '../engines/proximity'
import { haversineMetres } from '../engines/haversine'
import { EVENT_TYPE_CONFIG, type RoadEvent } from '../types/event'
import type { GPSPosition } from '../types/geo'
import type { EventAlert } from './useEventsAhead'
import { getProximityRadius } from '../lib/settings'
import { installAudioUnlock, notifyProximity } from '../lib/alertFeedback'
import { Sentry } from '../lib/sentry'
import { getTelegramWebApp } from '../lib/telegram'

// Новый модуль оповещений (заход 37). Работает РЯДОМ с useEventsAhead:
// любая ошибка здесь → failed=true, и LocationScreen возвращается на старый
// хук (см. LocationScreen.tsx). Сам старый хук не менялся.

export interface ProximityAlert extends EventAlert {
  dir: 'ahead' | 'near'
  /** Сколько однотипных событий (≤50 м друг от друга) схлопнуто в это. */
  count: number
}

interface Active { event: RoadEvent; dir: 'ahead' | 'near'; count: number }

const AUTO_DISMISS_MS = 8_000
const CLUSTER_M = 50
const MAX_ALERTS = 3

function cluster(hits: Hit<RoadEvent>[]): Active[] {
  const out: Active[] = []
  for (const h of hits) {
    const twin = out.find(
      (a) => a.event.type === h.event.type &&
        haversineMetres(a.event.lat, a.event.lng, h.event.lat, h.event.lng) <= CLUSTER_M
    )
    if (twin) twin.count += 1
    else out.push({ event: h.event, dir: h.dir, count: 1 })
  }
  return out
}

export function useProximityAlerts(
  position: GPSPosition | null,
  events: RoadEvent[]
): { alerts: ProximityAlert[]; dismiss: () => void; failed: boolean } {
  const [active, setActive] = useState<Active[]>([])
  const [failed, setFailed] = useState(false)
  const failedRef = useRef(false)
  const coreRef = useRef<{ index: GridIndex<RoadEvent>; engine: ProximityEngine<RoadEvent> } | null>(null)
  const knownRef = useRef(new Map<string, RoadEvent>())
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  const fail = useCallback((op: string, e: unknown) => {
    if (failedRef.current) return
    failedRef.current = true
    setFailed(true)
    setActive([])
    Sentry.captureException(e, { tags: { op: `useProximityAlerts.${op}` } })
  }, [])

  const dismiss = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    setActive([])
  }, [])

  // Звук: разблокировка по тапу пользователя.
  useEffect(() => installAudioUnlock(), [])

  // Возврат в приложение (Telegram activated / видимая вкладка): история трека
  // устарела — тихая ресинхронизация, без алертов по "уже внутренним" событиям.
  useEffect(() => {
    const resync = () => { try { coreRef.current?.engine.resync() } catch { /* ignore */ } }
    const onVisible = () => { if (document.visibilityState === 'visible') resync() }
    document.addEventListener('visibilitychange', onVisible)
    const wa = getTelegramWebApp()
    wa?.onEvent('activated', resync)
    return () => {
      document.removeEventListener('visibilitychange', onVisible)
      wa?.offEvent('activated', resync)
    }
  }, [])

  // Синхронизация индекса с событиями (speed_zone — отдельный механизм, как и в старом хуке).
  useEffect(() => {
    if (failedRef.current) return
    try {
      if (!coreRef.current) {
        const R = getProximityRadius()
        const index = new GridIndex<RoadEvent>()
        const engine = new ProximityEngine<RoadEvent>(index, {
          ...DEFAULT_CFG, radiusM: R, hysteresisM: Math.max(100, R * 0.2),
        })
        coreRef.current = { index, engine }
      }
      const { index } = coreRef.current
      const next = new Map<string, RoadEvent>()
      for (const e of events) {
        if (e.type === 'speed_zone') continue
        next.set(e.id, e)
        if (knownRef.current.get(e.id) !== e) index.upsert(e)
      }
      for (const id of knownRef.current.keys()) if (!next.has(id)) index.remove(id)
      knownRef.current = next
    } catch (e) {
      fail('syncEvents', e)
    }
  }, [events, fail])

  // Обработка каждого фикса.
  useEffect(() => {
    if (failedRef.current || !position || !coreRef.current) return
    try {
      const hits = coreRef.current.engine.update({
        lat: position.lat, lng: position.lng, heading: position.heading,
        speed: position.speed, accuracy: position.accuracy, ts: position.timestamp,
      })
      if (hits.length === 0) return
      const batch = cluster(hits)
      setActive((prev) => {
        const ids = new Set(batch.map((b) => b.event.id))
        return [...batch, ...prev.filter((p) => !ids.has(p.event.id))].slice(0, MAX_ALERTS)
      })
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setActive([]), AUTO_DISMISS_MS)
      const first = batch[0]!
      const label = EVENT_TYPE_CONFIG[first.event.type].label
      const dist = Math.round(hits[0]!.distanceM / 10) * 10
      notifyProximity(`${first.dir === 'ahead' ? 'Впереди' : 'Рядом'} ${label}, ${dist} метров`)
    } catch (e) {
      fail('update', e)
    }
  }, [position, fail])

  useEffect(() => () => { if (timerRef.current) clearTimeout(timerRef.current) }, [])

  // Живая дистанция — от текущей позиции, без повторных срабатываний.
  const alerts = useMemo<ProximityAlert[]>(() => {
    if (failed) return []
    return active
      .map((a) => ({
        event: a.event, dir: a.dir, count: a.count,
        distanceM: position
          ? haversineMetres(position.lat, position.lng, a.event.lat, a.event.lng)
          : 0,
      }))
      .sort((x, y) => x.distanceM - y.distanceM)
  }, [active, position, failed])

  return { alerts, dismiss, failed }
}
