
import { useState } from 'react'
import type { CSSProperties } from 'react'
import { TopBar } from '../components/ui/TopBar'
import { ScreenWrapper } from '../components/ui/ScreenWrapper'
import { COLORS, FONT, SPACING, RADIUS } from '../components/ui/tokens'
import { useAuth } from '../hooks/useAuth'
import { useSettings } from '../hooks/useSettings'
import { setTheme, setLang, T, getTrackLocation, setTrackLocation, getKeepScreenOn, setKeepScreenOn } from '../lib/settings'

export function ProfileScreen() {
  const auth = useAuth()
  const { theme, lang } = useSettings()
  const [editing, setEditing] = useState(false)
  const [trackLocation, setTrackLocationState] = useState(getTrackLocation)
  const [keepScreenOn, setKeepScreenOnState] = useState(getKeepScreenOn)
  const [name, setName] = useState('')
  // Вход в админ-режим (Блок 6, become_admin RPC через AuthAdapter) —
  // простой локальный флаг, пароль нигде не сохраняется кроме самого
  // запроса (см. handleBecomeAdmin ниже).
  const [adminPassword, setAdminPassword] = useState('')
  const [isAdmin, setIsAdmin] = useState(false)
  const [adminError, setAdminError] = useState<string | null>(null)
  const [adminLoading, setAdminLoading] = useState(false)

  const user = auth.status === 'authenticated' ? auth.user : null
  const isDark = theme === 'dark'
  const cardBg = isDark ? COLORS.bgCard : '#FFFFFF'
  const bg = isDark ? COLORS.bg : '#F5F5F5'
  const border = isDark ? COLORS.border : '#D0D0D0'
  const textPrimary = isDark ? COLORS.textPrimary : '#111'
  const textSecond = isDark ? COLORS.textSecond : '#555'
  const t = (key: string) => T[key]?.[lang] ?? key

  async function saveName() {
    if (!name.trim()) return
    await auth.updateProfile({ displayName: name.trim() })
    setEditing(false)
  }

  async function handleBecomeAdmin() {
    if (!adminPassword || adminLoading) return
    setAdminLoading(true)
    setAdminError(null)
    // Пароль читаем в локальную переменную и сразу чистим поле/стейт —
    // нигде, кроме этого запроса, значение не сохраняется (ни в
    // localStorage, ни в контексте auth).
    const pwd = adminPassword
    setAdminPassword('')
    try {
      await auth.becomeAdmin(pwd)
      setIsAdmin(true)
    } catch (e) {
      // become_admin() намеренно бросает одну и ту же ошибку и на
      // "Not authenticated", и на неверный пароль (см. schema.sql) —
      // в норме детали не показываем, только общее сообщение.
      //
      // TEMP DIAG (2026-07-14): временно показываем реальный e.message,
      // чтобы Alex видел настоящий текст ошибки от RPC без DevTools —
      // ⚠️ ВРЕМЕННО, откатить на общий текст после диагностики (см.
      // AGENT_LOG.md). Fallback на прежний общий текст, если message пуст.
      const fallback = lang === "ru" ? "Не удалось войти как админ — проверьте пароль" : "Failed to log in as admin — check the password"
      const raw = e instanceof Error ? e.message : String(e)
      setAdminError(raw && raw.trim() ? `TEMP DIAG: ${raw}` : fallback)
    } finally {
      setAdminLoading(false)
    }
  }

  return (
    <>
      <TopBar title={t("profile")} />
      <ScreenWrapper style={{ backgroundColor: bg }}>
        <div style={{ padding: SPACING.md }}>

          <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: SPACING.md, display: "flex", alignItems: "center", gap: SPACING.md, marginBottom: SPACING.md }}>
            <div style={{ width: 60, height: 60, borderRadius: "50%", backgroundColor: COLORS.accent + "22", border: `2px solid ${COLORS.accent}`, display: "flex", alignItems: "center", justifyContent: "center", fontSize: 28, flexShrink: 0 }}>👤</div>
            <div style={{ flex: 1, minWidth: 0 }}>
              {editing ? (
                <div style={{ display: "flex", gap: SPACING.xs }}>
                  <input autoFocus value={name} onChange={(e) => setName(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void saveName() }}
                    placeholder={lang === "ru" ? "Ваше имя" : "Your name"}
                    style={{ flex: 1, padding: "8px 10px", backgroundColor: isDark ? COLORS.bgElevated : "#EBEBEB", border: `1px solid ${COLORS.accent}`, borderRadius: RADIUS.sm, color: textPrimary, fontSize: FONT.base, outline: "none" }} />
                  <button onClick={() => void saveName()} style={smallBtn(COLORS.accent)}>✓</button>
                  <button onClick={() => setEditing(false)} style={smallBtn(isDark ? COLORS.bgElevated : "#DDD")}>✕</button>
                </div>
              ) : (
                <>
                  <div style={{ fontSize: FONT.md, color: textPrimary, fontWeight: 700 }}>{user?.displayName ?? "Водитель"}</div>
                  <div style={{ fontSize: FONT.xs, color: textSecond, marginTop: 2 }}>{user?.isAnonymous ? t("anon") : user?.phone ?? ""}</div>
                </>
              )}
            </div>
            {!editing && (
              <button onClick={() => { setName(user?.displayName ?? ""); setEditing(true) }}
                style={{ padding: "8px 14px", backgroundColor: isDark ? COLORS.bgElevated : "#EBEBEB", color: textSecond, border: `1px solid ${border}`, borderRadius: RADIUS.md, fontSize: FONT.xs, cursor: "pointer" }}>
                {t("edit")}
              </button>
            )}
          </div>

          <p style={{ fontSize: FONT.xs, color: textSecond, marginBottom: SPACING.xs, letterSpacing: 0.6, fontWeight: 600 }}>{t("settings").toUpperCase()}</p>
          <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: RADIUS.lg, overflow: "hidden" }}>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACING.sm}px ${SPACING.md}px`, borderBottom: `1px solid ${border}` }}>
              <span style={{ fontSize: FONT.base, color: textPrimary }}>{lang === "ru" ? "Тема" : "Theme"}</span>
              <button onClick={() => setTheme(isDark ? "light" : "dark")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", backgroundColor: isDark ? "#333" : "#E0E0E0", border: `1px solid ${border}`, borderRadius: RADIUS.full, color: textPrimary, fontSize: FONT.sm, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <span>{isDark ? "🌙" : "☀️"}</span><span>{isDark ? t("theme_dark") : t("theme_light")}</span>
              </button>
            </div>

            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACING.sm}px ${SPACING.md}px`, borderBottom: `1px solid ${border}` }}>
              <span style={{ fontSize: FONT.base, color: textPrimary }}>{lang === "ru" ? "Язык" : "Language"}</span>
              <button onClick={() => setLang(lang === "ru" ? "en" : "ru")} style={{ display: "flex", alignItems: "center", gap: 6, padding: "6px 14px", backgroundColor: isDark ? "#333" : "#E0E0E0", border: `1px solid ${border}`, borderRadius: RADIUS.full, color: textPrimary, fontSize: FONT.sm, fontWeight: 600, cursor: "pointer", WebkitTapHighlightColor: "transparent" }}>
                <span>{lang === "ru" ? "🇷🇺" : "🇬🇧"}</span><span>{lang === "ru" ? "Русский" : "English"}</span>
              </button>
            </div>

            <ToggleRow
              label={lang === "ru" ? "Отслеживать местоположение" : "Track location"}
              checked={trackLocation}
              onChange={(v) => { setTrackLocation(v); setTrackLocationState(v) }}
              textPrimary={textPrimary} border={border}
            />
            <ToggleRow
              label={lang === "ru" ? "Не выключать экран" : "Keep screen on"}
              checked={keepScreenOn}
              onChange={(v) => { setKeepScreenOn(v); setKeepScreenOnState(v) }}
              textPrimary={textPrimary} border={border}
            />

            <Row label={t("notif")} value={t("on")} textPrimary={textPrimary} textSecond={textSecond} border={border} />
            <Row label={t("voice")} value={t("on")} textPrimary={textPrimary} textSecond={textSecond} border={border} last />
          </div>

          <p style={{ fontSize: FONT.xs, color: textSecond, marginBottom: SPACING.xs, marginTop: SPACING.md, letterSpacing: 0.6, fontWeight: 600 }}>{lang === "ru" ? "АДМИН-РЕЖИМ" : "ADMIN MODE"}</p>
          <div style={{ backgroundColor: cardBg, border: `1px solid ${border}`, borderRadius: RADIUS.lg, padding: SPACING.md }}>
            {isAdmin ? (
              <div style={{ display: "flex", alignItems: "center", gap: SPACING.xs, fontSize: FONT.base, color: textPrimary }}>
                <span>🛡️</span>
                <span>{lang === "ru" ? "Вы вошли как админ" : "Logged in as admin"}</span>
              </div>
            ) : (
              <>
                <div style={{ display: "flex", gap: SPACING.xs }}>
                  <input
                    type="password"
                    autoComplete="off"
                    value={adminPassword}
                    onChange={(e) => setAdminPassword(e.target.value)}
                    onKeyDown={(e) => { if (e.key === "Enter") void handleBecomeAdmin() }}
                    placeholder={lang === "ru" ? "Пароль админа" : "Admin password"}
                    style={{ flex: 1, padding: "8px 10px", backgroundColor: isDark ? COLORS.bgElevated : "#EBEBEB", border: `1px solid ${border}`, borderRadius: RADIUS.sm, color: textPrimary, fontSize: FONT.base, outline: "none" }}
                  />
                  <button
                    onClick={() => void handleBecomeAdmin()}
                    disabled={adminLoading || !adminPassword}
                    style={{ padding: "8px 14px", backgroundColor: COLORS.accent, color: "#F0F0F0", border: "none", borderRadius: RADIUS.sm, fontSize: FONT.xs, fontWeight: 600, cursor: adminLoading || !adminPassword ? "default" : "pointer", opacity: adminLoading || !adminPassword ? 0.6 : 1, whiteSpace: "nowrap" }}
                  >
                    {adminLoading ? (lang === "ru" ? "..." : "...") : (lang === "ru" ? "Войти как админ" : "Log in as admin")}
                  </button>
                </div>
                {adminError && <div style={{ fontSize: FONT.xs, color: "#EF4444", marginTop: SPACING.xs }}>{adminError}</div>}
              </>
            )}
          </div>
        </div>
      </ScreenWrapper>
    </>
  )
}

function Row({ label, value, textPrimary, textSecond, border, last }: { label: string; value: string; textPrimary: string; textSecond: string; border: string; last?: boolean }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACING.sm}px ${SPACING.md}px`, borderBottom: last ? "none" : `1px solid ${border}` }}>
      <span style={{ fontSize: FONT.base, color: textPrimary }}>{label}</span>
      <span style={{ fontSize: FONT.sm, color: textSecond }}>{value}</span>
    </div>
  )
}

function ToggleRow({ label, checked, onChange, textPrimary, border }: { label: string; checked: boolean; onChange: (v: boolean) => void; textPrimary: string; border: string }) {
  return (
    <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", padding: `${SPACING.sm}px ${SPACING.md}px`, borderBottom: `1px solid ${border}` }}>
      <span style={{ fontSize: FONT.base, color: textPrimary }}>{label}</span>
      <button
        role="switch"
        aria-checked={checked}
        onClick={() => onChange(!checked)}
        style={{ width: 46, height: 26, borderRadius: 13, border: "none", padding: 0, position: "relative", cursor: "pointer", backgroundColor: checked ? COLORS.accent : "#555", transition: "background-color 0.2s", WebkitTapHighlightColor: "transparent", flexShrink: 0 }}
      >
        <span style={{ position: "absolute", top: 3, left: checked ? 23 : 3, width: 20, height: 20, borderRadius: "50%", backgroundColor: "#fff", transition: "left 0.2s" }} />
      </button>
    </div>
  )
}

function smallBtn(bg: string): CSSProperties {
  return { padding: "8px 12px", backgroundColor: bg, color: "#F0F0F0", border: "none", borderRadius: RADIUS.sm, cursor: "pointer" }
}
