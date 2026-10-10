
import { supabase, db } from "../../supabase"
import type { AuthAdapter } from "../interface"
import type { UserProfile } from "../../../types/user"

// eslint-disable-next-line @typescript-eslint/no-explicit-any
function toProfile(id: string, row: any): UserProfile {
  return { id, displayName: row.display_name, avatarUrl: row.avatar_url, phone: row.phone, isAnonymous: row.is_anonymous, createdAt: row.created_at }
}

export const supabaseAuthAdapter: AuthAdapter = {
  async signInAnonymous(): Promise<UserProfile> {
    const { data, error } = await supabase.auth.signInAnonymously()
    if (error || !data.user) throw new Error(error?.message ?? "Anonymous sign-in failed")
    let profile = null
    for (let i = 0; i < 3; i++) {
      const { data: p } = await db.from("profiles").select("*").eq("id", data.user.id).single()
      if (p) { profile = p; break }
      await new Promise((r) => setTimeout(r, 300))
    }
    if (!profile) throw new Error("Profile not created")
    return toProfile(data.user.id, profile)
  },
  async getCurrentUser(): Promise<UserProfile | null> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return null
    const { data } = await db.from("profiles").select("*").eq("id", user.id).single()
    if (!data) return null
    return toProfile(user.id, data)
  },
  async signOut(): Promise<void> { await supabase.auth.signOut() },
  async updateProfile(patch): Promise<UserProfile> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) throw new Error("Not authenticated")
    const update: Record<string, string> = {}
    if (patch.displayName !== undefined) update["display_name"] = patch.displayName
    if (patch.phone != null) update["phone"] = patch.phone
    const { data, error } = await db.from("profiles").update(update).eq("id", user.id).select("*").single()
    if (error || !data) throw new Error(error?.message ?? "Update failed")
    return toProfile(user.id, data)
  },
  async becomeAdmin(password: string): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).rpc("become_admin", { p_password: password })
    if (error) throw new Error(error.message)
  },
  async isAdmin(): Promise<boolean> {
    const { data: { user } } = await supabase.auth.getUser()
    if (!user) return false
    const { data } = await db.from("profiles").select("is_admin").eq("id", user.id).single()
    return !!(data as { is_admin?: boolean } | null)?.is_admin
  },
  async leaveAdmin(): Promise<void> {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const { error } = await (db as any).rpc("leave_admin")
    if (error) throw new Error(error.message)
  },
}
