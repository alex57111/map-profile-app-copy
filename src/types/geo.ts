export interface Coords { lat: number; lng: number }
export interface GPSPosition extends Coords {
  heading: number; speed: number; accuracy: number; timestamp: number
}
export type GPSStatus = 'idle' | 'acquiring' | 'active' | 'lost' | 'denied' | 'error'
export interface GPSState {
  position: GPSPosition | null; status: GPSStatus; error: string | null
  // Заход 46: для индикатора качества связи. lastFixAt/lastAccuracy обновляются
  // на каждый валидный сырой фикс (даже если position не менялась).
  startedAt?: number; lastFixAt?: number; lastAccuracy?: number
}
