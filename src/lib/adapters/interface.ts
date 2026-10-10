
import type { UserProfile } from '../../types/user'
import type { RoadEvent, CreateEventPayload, VoteValue } from '../../types/event'

export interface AuthAdapter {
  signInAnonymous(): Promise<UserProfile>
  getCurrentUser(): Promise<UserProfile | null>
  signOut(): Promise<void>
  updateProfile(data: Partial<Pick<UserProfile, 'displayName' | 'phone'>>): Promise<UserProfile>
  // Блок 6, п.4: вход в админ-режим (ProfileScreen) — вызывает RPC
  // become_admin(p_password). Бросает исключение при неверном пароле или
  // отсутствии сессии — UI показывает общее сообщение об ошибке.
  becomeAdmin(password: string): Promise<void>
  // Заход 43: текущий статус админа (profiles.is_admin) и выход (RPC leave_admin).
  isAdmin(): Promise<boolean>
  leaveAdmin(): Promise<void>
}

export interface EventsAdapter {
  getEventsInBounds(minLat: number, maxLat: number, minLng: number, maxLng: number): Promise<RoadEvent[]>
  createEvent(payload: CreateEventPayload): Promise<RoadEvent>
  voteOnEvent(eventId: string, vote: VoteValue): Promise<void>
  // Блок 6: «Подтвердить, что событие всё ещё актуально» — продлевает TTL.
  confirmEventRelevant(eventId: string): Promise<void>
  subscribeToEvents(onUpdate: (events: RoadEvent[]) => void): () => void
}

export interface AppAdapters { auth: AuthAdapter; events: EventsAdapter }
