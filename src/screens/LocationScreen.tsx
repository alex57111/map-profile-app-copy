
import { useEffect, useCallback, useState, useRef } from "react"
import type { CSSProperties } from "react"
import L from "leaflet"
import { LeafletMap, RecenterButton, MAP_MIN_ZOOM, MAP_MAX_ZOOM, clampZoom } from "../components/map/LeafletMap"
import { AddEventSheet } from "../components/map/AddEventSheet"
import { EventDetailSheet } from "../components/map/EventDetailSheet"
import { EventAheadAlert } from "../components/map/EventAheadAlert"
import { MapHUD, AddEventFAB, ZoomControls } from "../components/map/MapHUD"
import { Speedometer } from "../components/map/Speedometer"
// Поиск адреса временно скрыт с фронтенда (заход 27, AGENT_LOG.md) — пока
// нет голосовой навигации по маршруту, он не нужен. Компонент и его логика
// не удалены, импорт закомментирован, чтобы легко вернуть одной строкой.
// import { MapSearch } from "../components/map/MapSearch"
import { NavigationPanel } from "../components/map/NavigationPanel"
import { CitySelectAlert } from "../components/map/CitySelectAlert"
import { HomeScreenGate } from "../components/map/HomeScreenGate"
import { useIdleTimer } from "../hooks/useIdleTimer"
import { COLORS, TAB_HEIGHT } from "../components/ui/tokens"
import { useGPS } from "../hooks/useGPS"
import { useMapEvents } from "../hooks/useMapEvents"
import { usePresence } from "../hooks/usePresence"
import { useNearbyEventCounts } from "../hooks/useNearbyEventCounts"
import { useEventsAhead } from "../hooks/useEventsAhead"
import { useProximityAlerts } from "../hooks/useProximityAlerts"
import { ProximityToast } from "../components/map/ProximityToast"
import { useSpeedLimit } from "../hooks/useSpeedLimit"
import { useRoute, type Route } from "../hooks/useRoute"
import { useAverageSpeedZone } from "../hooks/useAverageSpeedZone"
import { useWakeLock } from "../hooks/useWakeLock"
import { getTrackLocation, getKeepScreenOn, getZoomOffset } from "../lib/settings"
import { autoZoom } from "../engines/autoZoom"
import { useOsmCameras } from "../hooks/useOsmCameras"
import { useOsmSpeedZones } from "../hooks/useOsmSpeedZones"
import { LocationPermissionGate } from "../components/map/LocationPermissionGate"
import type { RoadEvent, EventType } from "../types/event"
import type { Coords } from "../types/geo"
import type { AuthState } from "../types/user"
import { Sentry } from "../lib/sentry"
import { isInsideTelegram, getTelegramWebApp, checkHomeScreenStatus, addToHomeScreen } from "../lib/telegram"

const DEFAULT_CENTER: Coords = { lat: 55.7558, lng: 37.6176 }
const NO_EVENTS: RoadEvent[] = []

// Состояние гейтов живёт на уровне модуля — на время сессии (до перезагрузки
// Mini App), НЕ в localStorage (заход 36). Карта размонтируется при смене
// вкладки, и без этого гейты показывались бы заново при каждом возврате.
let sessionLocationGate: 'granted' | null = null
let sessionHomePromptChecked = false

interface LocationScreenProps {
  // Статус анонимного входа из корневого AuthProvider (см. App.tsx) — пока
  // не 'authenticated', создание событий заблокировано на уровне UI, чтобы
  // не ловить "Not authenticated" от RPC в короткое окно до входа.
  authStatus: AuthState['status']
}

export function LocationScreen({ authStatus }: LocationScreenProps) {
  const gps = useGPS()
  const mapRef = useRef<L.Map | null>(null)

  // Гейт Да/Нет — только внутри Telegram Mini App (см. AGENT_LOG.md заход 25).
  // Вне Telegram (веб на Cloudflare Pages, Capacitor Android) поведение не
  // меняется: геолокация запускается автоматически, как было раньше.
  const [gateState, setGateState] = useState<'pending' | 'granted' | 'denied'>(
    () => sessionLocationGate ?? (isInsideTelegram() ? 'pending' : 'granted')
  )

  // Запрос "Добавить на главный экран?" (заход 34) — после гейта геолокации,
  // только в Telegram и только если ярлык ещё не добавлен / API поддерживается.
  // "Нет" — закрывает окно до следующего запуска, дальше всё как раньше.
  const [homePromptOpen, setHomePromptOpen] = useState(false)
  useEffect(() => {
    if (gateState !== 'granted' || !isInsideTelegram() || sessionHomePromptChecked) return
    sessionHomePromptChecked = true
    let alive = true
    checkHomeScreenStatus().then((status) => {
      if (alive && (status === 'missed' || status === 'unknown')) setHomePromptOpen(true)
    })
    return () => { alive = false }
  }, [gateState])
  const handleHomeAllow = useCallback(() => { setHomePromptOpen(false); addToHomeScreen() }, [])
  const handleHomeDeny = useCallback(() => setHomePromptOpen(false), [])

  // Переключатели из Профиля (заход 35). Вкладки Карта/Профиль взаимоисключающие
  // (App.tsx), поэтому значения читаются при открытии Карты.
  const [trackLocation] = useState(getTrackLocation)
  const [keepScreenOn] = useState(getKeepScreenOn)

  useEffect(() => {
    if (gateState !== 'granted' || !trackLocation) return
    gps.start()
    return () => gps.stop()
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [gateState, trackLocation])

  const handleAllowLocation = useCallback(() => { sessionLocationGate = 'granted'; setGateState('granted') }, [])
  const handleDenyLocation = useCallback(() => {
    setGateState('denied')
    try {
      getTelegramWebApp()?.close()
    } catch {
      // нет-op — если закрыть не удалось, пользователь остаётся на
      // блокирующем экране "денай" ниже, карту всё равно не увидит
    }
  }, [])

  const mapCenterRef = useRef<Coords>(DEFAULT_CENTER)
  const [mapCenter, setMapCenter] = useState<Coords>(DEFAULT_CENTER)
  const [zoom, setZoom] = useState(14)

  const { events, createEvent, voteOnEvent, confirmEventRelevant, creating } = useMapEvents(null)
  const { onlineUsers } = usePresence(gps.position)
  const osmZones = useOsmSpeedZones(mapCenter)
  const combinedEvents = [...events, ...osmZones]
  // Оповещения о событиях (заход 37). Основной — новый модуль
  // useProximityAlerts (срабатывание по пересечению радиуса). Старый
  // useEventsAhead остаётся подключённым, но получает пустой список событий,
  // пока новый здоров — иначе дублировались бы звук/вибро. Если новый упал
  // (proximity.failed), старому возвращаются события, и он работает как раньше.
  const proximity = useProximityAlerts(gps.position, combinedEvents)
  const legacy = useEventsAhead(gps.position, proximity.failed ? combinedEvents : NO_EVENTS)
  const alerts = proximity.failed ? legacy.alerts : proximity.alerts
  const dismiss = proximity.failed ? legacy.dismiss : proximity.dismiss
  const speedLimit = useSpeedLimit(gps.position)
  const osmCameras = useOsmCameras(mapCenter)
  // Счётчики событий по типам в радиусе 50 км от позиции (плашка MapHUD, заход 45).
  const eventCounts = useNearbyEventCounts(gps.position, events, osmCameras)
  const {
    routes, activeRoute, loading: routeLoading, selecting,
    buildRoute, selectRoute, clearRoute, checkDeviation, updateProgress,
  } = useRoute()

  useAverageSpeedZone(gps.position, combinedEvents)
  // Не гасить экран, пока открыта Карта (заход 35) — управляется переключателем
  // "Не выключать экран" в Профиле (по умолчанию вкл). Раньше держался только
  // при построенном маршруте.
  useWakeLock(keepScreenOn)

  // Затемнение второстепенных кнопок (зум/GPS) без тапа по экрану 7 сек (заход 35; было 30) —
  // карта остаётся чистой на весь экран (заход 27, AGENT_LOG.md).
  const idle = useIdleTimer(7_000)

  // Алерт выбора города (заход 28, исправление по правке Alex — заход 27
  // делал лишнее: кнопку на экране и перенос камеры на город, этого не
  // просили). Теперь строго по ТЗ: появляется один раз сам, через 5 сек
  // после открытия карты, сам закрывается через 5 сек, если нет ответа.
  // Камера НИКОГДА не переключается на город — всегда следует GPS, как и
  // раньше. Выбор только запоминает, какие города отмечены (на будущее —
  // под какие города "грузить" данные), саму карту не трогает.
  const [citySelectOpen, setCitySelectOpen] = useState(false)
  useEffect(() => {
    if (gateState !== 'granted') return
    if (localStorage.getItem('citySelection_v1') !== null) return
    const openTimer = setTimeout(() => setCitySelectOpen(true), 5_000)
    return () => clearTimeout(openTimer)
  }, [gateState])

  useEffect(() => {
    if (!citySelectOpen) return
    const closeTimer = setTimeout(() => setCitySelectOpen(false), 5_000)
    return () => clearTimeout(closeTimer)
  }, [citySelectOpen])

  const applyCitySelection = useCallback((cityIds: string[]) => {
    localStorage.setItem('citySelection_v1', JSON.stringify(cityIds))
    setCitySelectOpen(false)
  }, [])

  const closeCitySelect = useCallback(() => {
    setCitySelectOpen(false)
  }, [])

  const [autoCenter, setAutoCenter] = useState(true)
  const [pendingCoords, setPendingCoords] = useState<Coords | null>(null)
  // Раньше selectedEvent был "замороженным" снимком RoadEvent на момент
  // клика по маркеру — не связан с realtime-обновлениями events, поэтому
  // ни удаление события на сервере, ни чужие голоса сюда не долетали.
  // Теперь храним только id, сам объект — деривация из combinedEvents
  // (того же списка, что уже рисует маркеры и обновляется через
  // useMapEvents/postgres_changes), поэтому обе проблемы чинятся сами.
  const [selectedEventId, setSelectedEventId] = useState<string | null>(null)
  const selectedEvent = selectedEventId
    ? combinedEvents.find((e) => e.id === selectedEventId) ?? null
    : null
  const [addSheetOpen, setAddSheetOpen] = useState(false)
  const [destination, setDestination] = useState<Coords | null>(null)

  // Навигация — checkDeviation + updateProgress
  useEffect(() => {
    if (!gps.position || !activeRoute) return
    void checkDeviation(gps.position.lat, gps.position.lng)
    void updateProgress(gps.position.lat, gps.position.lng)
  }, [gps.position?.lat, gps.position?.lng]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleMapClick = useCallback((lat: number, lng: number) => {
    if (selectedEvent || selecting) return
    if (authStatus !== 'authenticated') return // идёт анонимный вход — пока нельзя
    setPendingCoords({ lat, lng })
    setAddSheetOpen(true)
    setAutoCenter(false)
  }, [selectedEvent, selecting, authStatus])

  const handleMapMove = useCallback((center: Coords) => {
    mapCenterRef.current = center
    setMapCenter(center)
    setAutoCenter(false)
  }, [])

  const handleEventClick = useCallback((ev: RoadEvent) => {
    if (selecting) return
    setSelectedEventId(ev.id); setAddSheetOpen(false)
  }, [selecting])

  const handleCreateEvent = useCallback(async (
    type: EventType,
    coords: Coords,
    options?: { description?: string; heading?: number; endLat?: number; endLng?: number; zoneLimitKmh?: number }
  ) => {
    try {
      await createEvent({
        type, lat: coords.lat, lng: coords.lng,
        description: options?.description,
        heading: options?.heading,
        endLat: options?.endLat,
        endLng: options?.endLng,
        zoneLimitKmh: options?.zoneLimitKmh,
      })
    } catch (e) {
      // useMapEvents.createEvent уже отправляет ошибку в Sentry и ре-бросает её —
      // здесь просто не даём sheet закрыться, чтобы пользователь видел, что
      // создание не удалось, и мог повторить попытку.
      return
    }
    setAddSheetOpen(false); setPendingCoords(null)
  }, [createEvent])

  const handleVote = useCallback(async (eventId: string, vote: "yes" | "no") => {
    try {
      await voteOnEvent(eventId, vote)
      // Раньше здесь вручную инкрементился счётчик в selectedEvent — больше
      // не нужно: selectedEvent теперь деривация от combinedEvents, и как
      // только useMapEvents перефетчит events по postgres_changes, актуальный
      // счётчик (или отсутствие события, если оно удалено) подтянется сам.
    } catch (e) {
      // useMapEvents.voteOnEvent уже отправляет ошибку в Sentry — здесь только
      // не даём необработанному rejection всплыть выше молча.
      Sentry.captureException(e, { tags: { op: 'handleVote' }, extra: { eventId, vote } })
    }
  }, [voteOnEvent])

  const handleConfirmRelevant = useCallback(async (eventId: string) => {
    try {
      await confirmEventRelevant(eventId)
    } catch (e) {
      // useMapEvents.confirmEventRelevant уже отправляет ошибку в Sentry —
      // здесь только не даём необработанному rejection всплыть выше молча.
      Sentry.captureException(e, { tags: { op: 'handleConfirmRelevant' }, extra: { eventId } })
    }
  }, [confirmEventRelevant])

  const handleFABPress = useCallback(() => {
    if (selecting) return
    if (authStatus !== 'authenticated') return // идёт анонимный вход — пока нельзя
    const center = gps.position
      ? { lat: gps.position.lat, lng: gps.position.lng }
      : mapCenterRef.current
    setPendingCoords(center); setAddSheetOpen(true)
  }, [gps.position, selecting, authStatus])

  const handleRecenter = useCallback(() => {
    const map = mapRef.current; if (!map) return
    if (gps.position) {
      // Зум как в навигаторе (заход 38): по текущей скорости + смещение пользователя.
      autoZoom.reset(gps.position.speed * 3.6)
      const z = clampZoom(autoZoom.targetZoom(map.getSize().x, gps.position.lat) + getZoomOffset())
      autoZoom.markProgrammatic()
      map.setView([gps.position.lat, gps.position.lng], z, { animate: true, duration: 0.6 })
    }
    setAutoCenter(true)
  }, [gps.position])

  // Авто-возврат камеры на позицию — как в навигаторе (заход 31,
  // AGENT_LOG.md): если пользователь увёл карту вручную (autoCenter стал
  // false — см. handleMapMove/handleMapClick) и 5 сек не трогает экран,
  // карта сама возвращается на GPS-позицию (handleRecenter). Пока открыта
  // форма создания события или карточка события — не дёргаем карту.
  const idleForRecenter = useIdleTimer(5_000)
  useEffect(() => {
    if (!idleForRecenter) return
    if (autoCenter) return
    if (addSheetOpen || selectedEventId) return
    handleRecenter()
  }, [idleForRecenter]) // eslint-disable-line react-hooks/exhaustive-deps

  const handleZoomIn = useCallback(() => mapRef.current?.zoomIn(), [])
  const handleZoomOut = useCallback(() => mapRef.current?.zoomOut(), [])

  const handleSearchSelect = useCallback(async (coords: Coords) => {
    setDestination(coords)
    const from = gps.position
      ? { lat: gps.position.lat, lng: gps.position.lng }
      : mapCenterRef.current
    await buildRoute(from, coords)
    setAutoCenter(false)
  }, [gps.position, buildRoute])

  const handleRouteClick = useCallback((route: Route) => {
    selectRoute(route)
  }, [selectRoute])

  const handleClearRoute = useCallback(() => {
    clearRoute(); setDestination(null)
  }, [clearRoute])

  const speedKmh = gps.position ? gps.position.speed * 3.6 : 0
  const alertVisible = alerts.length > 0 && !addSheetOpen && !selectedEvent && !selecting
  const navActive = !!activeRoute && !alertVisible && !selecting
  const showRouteTip = selecting && routes.length > 1

  const wrapStyle: CSSProperties = {
    position: "fixed", top: 0, left: 0, right: 0,
    bottom: TAB_HEIGHT, backgroundColor: COLORS.bg, overflow: "hidden",
  }

  if (gateState === 'pending') {
    return <LocationPermissionGate onAllow={handleAllowLocation} onDeny={handleDenyLocation} />
  }
  if (gateState === 'denied') {
    // Telegram.WebApp.close() обычно срабатывает мгновенно — этот экран
    // видно только в короткую долю секунды до закрытия, либо если close()
    // по какой-то причине не сработал (например, тестирование в обычном
    // браузере с вручную подставленным initData).
    return (
      <div style={{ ...wrapStyle, display: "flex", alignItems: "center", justifyContent: "center" }}>
        <div style={{ color: COLORS.textSecond, fontSize: 15 }}>Закрываем…</div>
      </div>
    )
  }

  return (
    <div style={wrapStyle}>
      <LeafletMap
        position={gps.position}
        events={combinedEvents}
        onlineUsers={onlineUsers}
        osmCameras={osmCameras}
        autoCenter={autoCenter}
        routes={routes}
        activeRoute={activeRoute}
        destination={destination}
        selecting={selecting}
        onMapClick={handleMapClick}
        onMapMove={handleMapMove}
        onZoomChange={setZoom}
        onEventClick={handleEventClick}
        onRouteClick={handleRouteClick}
        mapRef={mapRef}
      />

      {showRouteTip && (
        <div style={{
          position: "absolute", bottom: 100, left: "50%", transform: "translateX(-50%)",
          backgroundColor: "rgba(15,15,15,0.92)", borderRadius: 24,
          padding: "10px 20px", color: "#fff", fontSize: 14, fontWeight: 600,
          zIndex: 460, whiteSpace: "nowrap",
          backdropFilter: "blur(8px)", boxShadow: "0 4px 16px rgba(0,0,0,0.4)",
          display: "flex", alignItems: "center", gap: 8,
        }}>
          <span>👆</span>
          <span>Нажмите на маршрут для выбора</span>
          <button onClick={handleClearRoute} style={{ marginLeft: 8, background: "none", border: "none", color: "rgba(255,255,255,0.6)", fontSize: 16, cursor: "pointer", lineHeight: 1 }}>✕</button>
        </div>
      )}

      {navActive && (
        <NavigationPanel route={activeRoute} position={gps.position} onClear={handleClearRoute} />
      )}

      {/* Поиск адреса скрыт (заход 27) — см. комментарий у импорта выше.
      {!alertVisible && !navActive && !selecting && (
        <MapSearch onSelect={handleSearchSelect} />
      )}
      */}

      {homePromptOpen && <HomeScreenGate onAllow={handleHomeAllow} onDeny={handleHomeDeny} />}

      {citySelectOpen && (
        <CitySelectAlert onConfirm={applyCitySelection} onClose={closeCitySelect} />
      )}

      {alertVisible && (proximity.failed
        ? <EventAheadAlert alerts={alerts} onVote={handleVote} onDismiss={dismiss} />
        : <ProximityToast alerts={proximity.alerts} onVote={handleVote} onDismiss={dismiss} />
      )}

      {!alertVisible && !activeRoute && !selecting && (
        <MapHUD gps={gps} onlineCount={onlineUsers.length} counts={eventCounts} />
      )}

      {speedKmh > 2 && !alertVisible && (
        <Speedometer speedKmh={speedKmh} limitKmh={speedLimit} />
      )}

      {routeLoading && (
        <div style={{
          position: "absolute", top: "50%", left: "50%", transform: "translate(-50%,-50%)",
          backgroundColor: "rgba(15,15,15,0.92)", borderRadius: 16,
          padding: "16px 24px", color: "#fff", fontSize: 15, fontWeight: 600,
          zIndex: 600, backdropFilter: "blur(8px)",
          display: "flex", alignItems: "center", gap: 12,
        }}>
          <span style={{ fontSize: 24 }}>🗺️</span>
          <span>Строю маршрут...</span>
        </div>
      )}

      {/* Кнопки зума +/- убраны с экрана (заход 31, AGENT_LOG.md) — по
          просьбе Alex. ZoomControls не удалён — закомментирован, возврат
          одной строкой при необходимости. Пинч-зум на тач-экранах и так
          работает штатно через сам Leaflet, им управлять не требуется. */}
      {/*
      <div style={{ opacity: idle ? 0.25 : 1, transition: "opacity 0.5s ease" }}>
        <ZoomControls zoom={zoom} minZoom={MAP_MIN_ZOOM} maxZoom={MAP_MAX_ZOOM} onZoomIn={handleZoomIn} onZoomOut={handleZoomOut} />
      </div>
      */}
      {/* Кнопка GPS/recenter возвращена (заход 31) — затемняется без тапа
          30 сек, как и раньше (заход 27). */}
      <div style={{ opacity: idle ? 0.25 : 1, transition: "opacity 0.5s ease" }}>
        <RecenterButton active={autoCenter} onRecenter={handleRecenter} />
      </div>
      {!selecting && authStatus === 'authenticated' && <AddEventFAB onPress={handleFABPress} />}
      {!selecting && authStatus !== 'authenticated' && (
        // Вход ещё не завершён (или не удался) — показываем некликабельный
        // индикатор вместо активной кнопки создания события.
        <div style={{
          position: "absolute", bottom: 80, left: 16, width: 52, height: 52,
          borderRadius: "50%", backgroundColor: "rgba(120,120,120,0.55)",
          border: "1px solid rgba(120,120,120,0.4)", color: "#fff",
          display: "flex", alignItems: "center", justifyContent: "center",
          fontSize: 20, zIndex: 500, pointerEvents: "none",
        }}>
          {authStatus === 'loading' ? '⏳' : '🔒'}
        </div>
      )}

      <AddEventSheet
        coords={addSheetOpen ? pendingCoords : null}
        userHeading={gps.position?.heading}
        onCreate={handleCreateEvent}
        onClose={() => { setAddSheetOpen(false); setPendingCoords(null) }}
        creating={creating}
      />
      <EventDetailSheet
        event={selectedEvent}
        onVote={handleVote}
        onConfirmRelevant={handleConfirmRelevant}
        onClose={() => setSelectedEventId(null)}
      />
    </div>
  )
}
