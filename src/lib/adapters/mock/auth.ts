import type { AuthAdapter } from '../interface'
import type { UserProfile } from '../../../types/user'

const STORAGE_KEY = 'mock_user_profile'

function makeAnonUser(): UserProfile {
  return {
    id: `anon_${Math.random().toString(36).slice(2, 10)}`,
    displayName: 'Водитель',
    avatarUrl: null,
    phone: null,
    isAnonymous: true,
    createdAt: new Date().toISOString(),
  }
}

function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms))
}

// Мок-пароль для локальной разработки (npm run dev без Supabase) — НЕ
// секрет и никак не связан с боевым паролём в admin_config (см.
// supabase/schema.sql). Нужен только чтобы кнопка "Войти как админ" в
// ProfileScreen была тестируема локально (успех/ошибка) без реальной БД.
const MOCK_ADMIN_PASSWORD = 'admin'
const MOCK_ADMIN_KEY = 'mock_is_admin'

export const mockAuthAdapter: AuthAdapter = {
  async signInAnonymous(): Promise<UserProfile> {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (stored) return JSON.parse(stored) as UserProfile
    const user = makeAnonUser()
    localStorage.setItem(STORAGE_KEY, JSON.stringify(user))
    return user
  },
  async getCurrentUser(): Promise<UserProfile | null> {
    const stored = localStorage.getItem(STORAGE_KEY)
    if (!stored) return null
    return JSON.parse(stored) as UserProfile
  },
  async signOut(): Promise<void> {
    localStorage.removeItem(STORAGE_KEY)
  },
  async updateProfile(data): Promise<UserProfile> {
    const stored = localStorage.getItem(STORAGE_KEY)
    const base: UserProfile = stored ? JSON.parse(stored) : makeAnonUser()
    const updated: UserProfile = { ...base, ...data }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(updated))
    return updated
  },
  async becomeAdmin(password: string): Promise<void> {
    await delay(150)
    if (password !== MOCK_ADMIN_PASSWORD) {
      throw new Error('Invalid request')
    }
    localStorage.setItem(MOCK_ADMIN_KEY, '1')
  },
  async isAdmin(): Promise<boolean> {
    return localStorage.getItem(MOCK_ADMIN_KEY) === '1'
  },
  async leaveAdmin(): Promise<void> {
    localStorage.removeItem(MOCK_ADMIN_KEY)
  },
}
