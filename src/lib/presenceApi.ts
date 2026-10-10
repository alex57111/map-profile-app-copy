import { db } from './supabase'
import type { OnlineUser } from '../types/user'

// Заход 53: присутствие пользователей на карте (видит только админ).
// Работает только с Supabase (VITE_USE_SUPABASE=true); в mock-режиме — no-op.
// Сервер (SQL 0007): report_presence/remove_presence пишут только свою строку,
// get_online_users возвращает данные только админу (иначе пусто).
export const PRESENCE_ENABLED = import.meta.env.VITE_USE_SUPABASE === 'true'

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const rpc = (name: string, args?: Record<string, unknown>) => (db as any).rpc(name, args)

export async function reportPresence(lat: number, lng: number, heading: number, speed: number): Promise<void> {
  if (!PRESENCE_ENABLED) return
  const { error } = await rpc('report_presence', {
    p_lat: lat, p_lng: lng,
    p_heading: Number.isFinite(heading) ? heading : 0,
    p_speed: Number.isFinite(speed) ? speed : 0,
  })
  if (error) throw new Error(error.message)
}

export async function removePresenceRemote(): Promise<void> {
  if (!PRESENCE_ENABLED) return
  const { error } = await rpc('remove_presence')
  if (error) throw new Error(error.message)
}

interface OnlineRow {
  user_id: string; display_name: string | null
  lat: number; lng: number; heading: number; speed: number
  updated_at: string; is_self: boolean
}

/** Все онлайн (включая себя — для счётчика). Не-админу сервер вернёт []. */
export async function fetchOnlineUsers(): Promise<{ user: OnlineUser; isSelf: boolean }[]> {
  if (!PRESENCE_ENABLED) return []
  const { data, error } = await rpc('get_online_users')
  if (error) throw new Error(error.message)
  return ((data ?? []) as OnlineRow[]).map((r) => ({
    isSelf: r.is_self,
    user: {
      userId: r.user_id,
      displayName: r.display_name || 'Пользователь',
      lat: r.lat, lng: r.lng,
      heading: r.heading ?? 0, speed: r.speed ?? 0,
      status: (r.speed ?? 0) > 1 ? 'driving' : 'idle',
      updatedAt: Date.parse(r.updated_at) || Date.now(),
    },
  }))
}
