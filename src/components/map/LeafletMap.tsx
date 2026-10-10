
import { useEffect, useRef } from "react"
import { getMapZoomPref, setMapZoomPref, getZoomOffset, setZoomOffset } from "../../lib/settings"
import { autoZoom } from "../../engines/autoZoom"
import type { CSSProperties } from "react"
import L from "leaflet"
import "leaflet/dist/leaflet.css"
import type { RoadEvent } from "../../types/event"
import type { OnlineUser } from "../../types/user"
import type { GPSPosition, Coords } from "../../types/geo"
import { EVENT_TYPE_CONFIG, isCameraStale } from "../../types/event"
import { useDraggable } from "../../hooks/useDraggable"
import type { Route } from "../../hooks/useRoute"
import type { OsmCamera } from "../../hooks/useOsmCameras"

import iconUrl from "leaflet/dist/images/marker-icon.png"
import iconRetinaUrl from "leaflet/dist/images/marker-icon-2x.png"
import shadowUrl from "leaflet/dist/images/marker-shadow.png"

delete (L.Icon.Default.prototype as unknown as Record<string, unknown>)._getIconUrl
L.Icon.Default.mergeOptions({ iconUrl, iconRetinaUrl, shadowUrl })

function arrowSvg(heading: number, color = "#F97316"): L.DivIcon {
  const svg = `<svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
    <g transform="rotate(${heading}, 20, 20)">
      <polygon points="20,4 28,32 20,26 12,32" fill="${color}" stroke="white" stroke-width="1.5"/>
    </g>
    <circle cx="20" cy="20" r="5" fill="${color}" stroke="white" stroke-width="2"/>
  </svg>`
  return L.divIcon({ html: svg, className: "", iconSize: [40, 40], iconAnchor: [20, 20] })
}

// Пункт 4 топ-5: событие целиком передаётся вместо type, чтобы можно было
// проверить isCameraStale() и приглушить/пометить давно не подтверждённую
// камеру — само по себе на голоса/TTL не влияет, только визуальная подсказка.
function eventIcon(event: RoadEvent): L.DivIcon {
  const cfg = EVENT_TYPE_CONFIG[event.type]
  const stale = isCameraStale(event)
  const badge = stale
    ? `<div style="position:absolute;top:-4px;right:-4px;width:16px;height:16px;border-radius:50%;background:#EF4444;display:flex;align-items:center;justify-content:center;font-size:11px;font-weight:800;color:#fff;border:1.5px solid #fff;">?</div>`
    : ""
  return L.divIcon({
    html: `<div style="position:relative;width:36px;height:36px;border-radius:50%;background:${cfg.color};display:flex;align-items:center;justify-content:center;font-size:18px;box-shadow:0 2px 6px rgba(0,0,0,0.4);border:2px solid rgba(255,255,255,0.8);opacity:${stale ? 0.55 : 1};">${cfg.icon}${badge}</div>`,
    className: "", iconSize: [36, 36], iconAnchor: [18, 18],
  })
}

// Иконка OSM камеры — отличается от пользовательских событий
function osmCameraIcon(camera: OsmCamera): L.DivIcon {
  const isAvg = camera.type === "average_speed"
  const bg = isAvg ? "#EC4899" : "#1D4ED8"  // розовый для средней, синий для обычной
  const icon = isAvg ? "📏" : "📷"
  const speedLabel = camera.maxspeed ? `<div style="font-size:9px;font-weight:800;color:white;line-height:1;margin-top:1px">${camera.maxspeed}</div>` : ""

  return L.divIcon({
    html: `<div style="
      width:32px;height:32px;border-radius:6px;
      background:${bg};
      display:flex;flex-direction:column;align-items:center;justify-content:center;
      font-size:14px;
      box-shadow:0 2px 6px rgba(0,0,0,0.5);
      border:2px solid rgba(255,255,255,0.9);
      position:relative;
    ">
      ${icon}
      ${speedLabel}
    </div>`,
    className: "", iconSize: [32, 32], iconAnchor: [16, 16],
  })
}

function destIcon(): L.DivIcon {
  return L.divIcon({
    html: `<div style="font-size:32px;line-height:1;filter:drop-shadow(0 2px 4px rgba(0,0,0,0.5))">🏁</div>`,
    className: "", iconSize: [32, 32], iconAnchor: [16, 32],
  })
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
type MCGroup = any

// Границы зума (заходы 39–42, по просьбе Alex): 8 — крупный регион (≈145 км в
// ширину экрана), 19 — максимум детализации. Дальше карта не реагирует на щипок.
// autoZoom.ts держит те же значения (MIN_Z/MAX_Z) — менять синхронно.
export const MAP_MIN_ZOOM = 8
export const MAP_MAX_ZOOM = 19
export const clampZoom = (z: number) => Math.min(MAP_MAX_ZOOM, Math.max(MAP_MIN_ZOOM, z))

interface Props {
  position: GPSPosition | null
  events: RoadEvent[]
  onlineUsers: OnlineUser[]
  osmCameras?: OsmCamera[]   // статичные камеры из OSM
  autoCenter: boolean
  routes?: Route[]
  activeRoute?: Route | null
  destination?: Coords | null
  selecting?: boolean
  onMapClick: (lat: number, lng: number) => void
  onMapMove?: (center: Coords) => void
  onZoomChange?: (zoom: number) => void
  onEventClick: (event: RoadEvent) => void
  onRouteClick?: (route: Route) => void
  mapRef?: React.MutableRefObject<L.Map | null>
}

const DEFAULT_CENTER: [number, number] = [55.7558, 37.6176]

export function LeafletMap({
  position, events, onlineUsers, osmCameras = [],
  autoCenter, routes, activeRoute, destination, selecting,
  onMapClick, onMapMove, onZoomChange, onEventClick, onRouteClick, mapRef: externalMapRef,
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null)
  const internalMapRef = useRef<L.Map | null>(null)
  const mapRef = externalMapRef ?? internalMapRef
  const ownMarkerRef = useRef<L.Marker | null>(null)
  const clusterGroupRef = useRef<MCGroup>(null)
  const eventMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const osmMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const userMarkersRef = useRef<Map<string, L.Marker>>(new Map())
  const routeLinesRef = useRef<Map<string, L.Polyline>>(new Map())
  const destMarkerRef = useRef<L.Marker | null>(null)
  const autoCenterRef = useRef(autoCenter)
  autoCenterRef.current = autoCenter
  // Первый фикс GPS после открытия приложения — центрируем и приближаем
  // карту сразу на позицию пользователя (как в навигаторе), а не просто
  // панорамируем с дефолтного зума (заход 29, AGENT_LOG.md). Дальше, пока
  // autoCenter включён, обычное panTo без смены зума — не дёргаем зум на
  // каждый GPS-тик.
  const hasAutoCenteredRef = useRef(false)
  const prevPosRef = useRef<{ lat: number; lng: number; ts: number } | null>(null)
  const onEventClickRef = useRef(onEventClick)
  onEventClickRef.current = onEventClick
  const onRouteClickRef = useRef(onRouteClick)
  onRouteClickRef.current = onRouteClick
  // Баг: map.on("click", ...) подключается один раз при инициализации карты
  // и захватывал onMapClick в замыкании на тот момент — навсегда запоминал
  // старую версию (например, authStatus === 'loading' до завершения
  // анонимного входа), из-за чего тап по карте переставал работать после
  // логина. Тот же паттерн ref, что уже использовался для onEventClick/
  // onRouteClick.
  const onMapClickRef = useRef(onMapClick)
  onMapClickRef.current = onMapClick

  // Инициализация карты
  useEffect(() => {
    if (!containerRef.current || mapRef.current) return
    const map = L.map(containerRef.current, {
      center: DEFAULT_CENTER, zoom: clampZoom(getMapZoomPref() ?? 14),
      zoomControl: false, attributionControl: false,
      minZoom: MAP_MIN_ZOOM, maxZoom: MAP_MAX_ZOOM,
    })
    // Единый хост без a/b/c — так требует политика тайлов OSM (заход 41); HTTP/2 и
    // кэш по Cache-Control обеспечивает сам браузер.
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: MAP_MAX_ZOOM, attribution: "© OpenStreetMap",
    }).addTo(map)
    L.control.attribution({ position: "bottomright", prefix: false }).addTo(map)

    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    const LG = window.L as any
    if (LG?.markerClusterGroup) {
      const cluster = LG.markerClusterGroup({ maxClusterRadius: 60, showCoverageOnHover: false })
      cluster.addTo(map)
      clusterGroupRef.current = cluster
    }

    map.on("click", (e) => onMapClickRef.current(e.latlng.lat, e.latlng.lng))
    map.on("moveend", () => { const c = map.getCenter(); onMapMove?.({ lat: c.lat, lng: c.lng }) })
    map.on("zoomend", () => {
      onZoomChange?.(map.getZoom())
      // Зум пользователя (щипок) запоминаем (заходы 36, 38): абсолютный — для
      // стартового вида карты, и смещение от автозума по скорости — для
      // следования за GPS. Программный зум (автозум, fitBounds) не считается.
      if (!autoZoom.isProgrammatic()) {
        setMapZoomPref(map.getZoom())
        if (autoZoom.currentBase !== null) setZoomOffset(map.getZoom() - autoZoom.currentBase)
      }
    })
    mapRef.current = map

    return () => {
      map.remove(); mapRef.current = null; clusterGroupRef.current = null
      ownMarkerRef.current = null
      eventMarkersRef.current.clear()
      osmMarkersRef.current.clear()
      userMarkersRef.current.clear()
      routeLinesRef.current.clear()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // Позиция пользователя
  useEffect(() => {
    const map = mapRef.current
    if (!map || !position) return
    const latlng = L.latLng(position.lat, position.lng)
    if (!ownMarkerRef.current) {
      ownMarkerRef.current = L.marker(latlng, {
        icon: arrowSvg(position.heading), zIndexOffset: 1000, interactive: false,
      }).addTo(map)
    } else {
      ownMarkerRef.current.setLatLng(latlng)
      ownMarkerRef.current.setIcon(arrowSvg(position.heading))
    }
    // Скорость для автозума: берём большую из заявленной и вычисленной по
    // смещению между фиксами (Telegram LocationManager может отдавать speed=0).
    const prev = prevPosRef.current
    let derivedKmh = 0
    if (prev) {
      const dt = (position.timestamp - prev.ts) / 1000
      if (dt > 0.5 && dt < 10) derivedKmh = (latlng.distanceTo(L.latLng(prev.lat, prev.lng)) / dt) * 3.6
    }
    prevPosRef.current = { lat: position.lat, lng: position.lng, ts: position.timestamp }
    const speedKmh = Math.max(position.speed * 3.6, derivedKmh)

    if (autoCenterRef.current) {
      const followZoom = () =>
        clampZoom(autoZoom.targetZoom(map.getSize().x, position.lat) + getZoomOffset())
      if (!hasAutoCenteredRef.current) {
        hasAutoCenteredRef.current = true
        autoZoom.reset(speedKmh)
        autoZoom.markProgrammatic()
        map.setView(latlng, followZoom(), { animate: true, duration: 0.8 })
      } else if (autoZoom.update(speedKmh, Date.now())) {
        // Уровень скорости сменился (город ↔ трасса) — плавно меняем зум.
        autoZoom.markProgrammatic()
        map.setView(latlng, followZoom(), { animate: true, duration: 0.6 })
      } else {
        map.panTo(latlng, { animate: true, duration: 0.5 })
      }
    }
  }, [position]) // eslint-disable-line react-hooks/exhaustive-deps

  // Маршруты
  useEffect(() => {
    const map = mapRef.current
    if (!map) return
    for (const line of routeLinesRef.current.values()) line.remove()
    routeLinesRef.current.clear()
    if (destMarkerRef.current) { destMarkerRef.current.remove(); destMarkerRef.current = null }

    const routesToDraw = selecting ? (routes ?? []) : (activeRoute ? [activeRoute] : [])
    if (routesToDraw.length === 0) return

    const bounds: L.LatLngBounds[] = []
    routesToDraw.forEach((route, idx) => {
      const latlngs = route.coords.map((c) => [c.lat, c.lng] as [number, number])
      const line = L.polyline(latlngs, {
        color: route.color,
        weight: selecting ? (idx === 0 ? 7 : 5) : 6,
        opacity: selecting ? (idx === 0 ? 0.95 : 0.65) : 0.9,
        dashArray: selecting && idx > 0 ? "10, 6" : undefined,
      })

      if (selecting && onRouteClickRef.current) {
        line.on("click", (e) => { L.DomEvent.stopPropagation(e); onRouteClickRef.current?.(route) })
        line.on("mouseover", () => map.getContainer().style.cursor = "pointer")
        line.on("mouseout",  () => map.getContainer().style.cursor = "")
      }

      if (selecting) {
        const midIdx = Math.floor(latlngs.length / 2)
        const mid = latlngs[midIdx]
        if (mid) {
          const labelMarker = L.marker(mid as [number, number], {
            icon: L.divIcon({
              html: `<div style="background:${route.color};color:white;padding:3px 8px;border-radius:10px;font-size:12px;font-weight:700;white-space:nowrap;box-shadow:0 2px 6px rgba(0,0,0,0.4);cursor:pointer">${route.label}</div>`,
              className: "", iconAnchor: [40, 12],
            }),
            interactive: true, zIndexOffset: 100 + idx,
          })
          labelMarker.on("click", (e) => { L.DomEvent.stopPropagation(e); onRouteClickRef.current?.(route) })
          labelMarker.addTo(map)
          routeLinesRef.current.set(`label-${route.id}`, labelMarker as unknown as L.Polyline)
        }
      }

      line.addTo(map)
      routeLinesRef.current.set(route.id, line)
      bounds.push(line.getBounds())
    })

    if (routesToDraw[0] && destination) {
      destMarkerRef.current = L.marker([destination.lat, destination.lng], {
        icon: destIcon(), zIndexOffset: 900,
      }).addTo(map)
    }

    if (bounds.length > 0) {
      const combined = bounds.reduce((acc, b) => acc.extend(b), bounds[0]!)
      autoZoom.markProgrammatic()
      map.fitBounds(combined, { padding: [50, 50] })
    }
  }, [routes, activeRoute, selecting, destination]) // eslint-disable-line react-hooks/exhaustive-deps

  // Пользовательские события
  useEffect(() => {
    const map = mapRef.current; const cluster = clusterGroupRef.current
    if (!map) return
    const currentIds = new Set(events.map((e) => e.id))
    for (const [id, marker] of eventMarkersRef.current) {
      if (!currentIds.has(id)) {
        if (cluster) cluster.removeLayer(marker); else marker.remove()
        eventMarkersRef.current.delete(id)
      }
    }
    for (const ev of events) {
      if (eventMarkersRef.current.has(ev.id)) continue
      const marker = L.marker([ev.lat, ev.lng], { icon: eventIcon(ev) })
      marker.on("click", (e) => { L.DomEvent.stopPropagation(e); onEventClickRef.current(ev) })
      if (cluster) cluster.addLayer(marker); else marker.addTo(map)
      eventMarkersRef.current.set(ev.id, marker)
    }
  }, [events]) // eslint-disable-line react-hooks/exhaustive-deps

  // OSM камеры — статичный слой, не кластеризуются
  useEffect(() => {
    const map = mapRef.current
    if (!map) return

    const currentIds = new Set(osmCameras.map((c) => c.id))

    // Удаляем устаревшие
    for (const [id, marker] of osmMarkersRef.current) {
      if (!currentIds.has(id)) { marker.remove(); osmMarkersRef.current.delete(id) }
    }

    // Добавляем новые
    for (const camera of osmCameras) {
      if (osmMarkersRef.current.has(camera.id)) continue
      const marker = L.marker([camera.lat, camera.lng], {
        icon: osmCameraIcon(camera),
        zIndexOffset: 200,
      })

      // Тултип с информацией
      const tooltipLines = [
        camera.type === "average_speed" ? "📏 Средняя скорость" : "📷 Камера скорости",
        camera.maxspeed ? `Лимит: ${camera.maxspeed} км/ч` : "",
        camera.direction !== undefined ? `Направление: ${Math.round(camera.direction)}°` : "",
        camera.name ? camera.name : "",
        "<small style='color:#888'>из OpenStreetMap</small>",
      ].filter(Boolean).join("<br>")

      marker.bindTooltip(tooltipLines, {
        permanent: false, direction: "top", offset: [0, -18],
        className: "leaflet-tooltip-dark",
      })
      marker.addTo(map)
      osmMarkersRef.current.set(camera.id, marker)
    }
  }, [osmCameras]) // eslint-disable-line react-hooks/exhaustive-deps

  // Водители
  useEffect(() => {
    const map = mapRef.current; if (!map) return
    const currentIds = new Set(onlineUsers.map((u) => u.userId))
    for (const [id, marker] of userMarkersRef.current) {
      if (!currentIds.has(id)) { marker.remove(); userMarkersRef.current.delete(id) }
    }
    for (const user of onlineUsers) {
      const existing = userMarkersRef.current.get(user.userId)
      if (existing) {
        existing.setLatLng([user.lat, user.lng])
        existing.setIcon(arrowSvg(user.heading, "#3B82F6"))
      } else {
        const marker = L.marker([user.lat, user.lng], { icon: arrowSvg(user.heading, "#3B82F6") })
        marker.bindTooltip(user.displayName, { permanent: false, direction: "top", offset: [0, -20], className: "leaflet-tooltip-dark" })
        marker.addTo(map)
        userMarkersRef.current.set(user.userId, marker)
      }
    }
  }, [onlineUsers]) // eslint-disable-line react-hooks/exhaustive-deps

  return <div ref={containerRef} style={{ width: "100%", height: "100%", position: "relative" } as CSSProperties} />
}

export function RecenterButton({ onRecenter, active }: { onRecenter: () => void; active: boolean }) {
  const { pos, onPointerDown, onPointerMove, onPointerUp, wasTap } = useDraggable({ x: 0, y: 0 })
  // Видимая кнопка 48.4px (+10% к 44), зона нажатия +30% (62.92px) — тап мимо
  // кружка в пределах зоны тоже срабатывает (заход 36). Внешний div держит
  // обработчики, внутренний кружок — только рисунок.
  const VISIBLE = 48.4
  const HIT = VISIBLE * 1.3
  const OFFSET = (HIT - VISIBLE) / 2
  return (
    <div
      onPointerDown={onPointerDown} onPointerMove={onPointerMove}
      onPointerUp={() => { onPointerUp(); if (wasTap()) onRecenter() }}
      style={{
        position: "absolute", bottom: 80 - pos.y - OFFSET, right: 12 - pos.x - OFFSET,
        width: HIT, height: HIT,
        display: "flex", alignItems: "center", justifyContent: "center",
        cursor: "grab", zIndex: 500, touchAction: "none", userSelect: "none",
        WebkitTapHighlightColor: "transparent",
      }}
    >
      <div style={{
        width: VISIBLE, height: VISIBLE, borderRadius: "50%",
        backgroundColor: active ? "rgba(249,115,22,0.8)" : "rgba(26,26,26,0.7)",
        border: `1px solid ${active ? "rgba(249,115,22,0.6)" : "rgba(255,255,255,0.15)"}`,
        color: "#fff", fontSize: 22,
        display: "flex", alignItems: "center", justifyContent: "center",
        boxShadow: "0 2px 8px rgba(0,0,0,0.3)",
        backdropFilter: "blur(4px)", pointerEvents: "none",
        transition: "background-color 0.2s",
      }}>📍</div>
    </div>
  )
}
