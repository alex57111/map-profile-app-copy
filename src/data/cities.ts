// Список городов для быстрого перехода (заход 27, AGENT_LOG.md).
// Координаты — центр города, zoom подобран, чтобы в экран попадала
// городская застройка целиком.

export interface CityOption {
  id: string
  name: string
  lat: number
  lng: number
  zoom: number
}

export const CITY_OPTIONS: CityOption[] = [
  { id: 'bryansk', name: 'Брянск', lat: 53.2521, lng: 34.3717, zoom: 12 },
  { id: 'kursk', name: 'Курск', lat: 51.7304, lng: 36.1926, zoom: 12 },
  { id: 'kaluga', name: 'Калуга', lat: 54.5293, lng: 36.2754, zoom: 12 },
  { id: 'orel', name: 'Орёл', lat: 52.9651, lng: 36.0785, zoom: 12 },
  { id: 'tula', name: 'Тула', lat: 54.1931, lng: 37.6177, zoom: 12 },
]
