import { useEffect, useRef, useState } from 'react'

const DEFAULT_IDLE_MS = 30_000

/**
 * true, если пользователь не касался экрана дольше timeoutMs — используется,
 * чтобы прятать (затемнять) второстепенные элементы управления (зум, GPS),
 * оставляя карту чистой. Сбрасывается на любой тап/скролл где угодно на
 * экране (заход 27, AGENT_LOG.md).
 */
export function useIdleTimer(timeoutMs: number = DEFAULT_IDLE_MS): boolean {
  const [idle, setIdle] = useState(false)
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null)

  useEffect(() => {
    const reset = () => {
      setIdle(false)
      if (timerRef.current) clearTimeout(timerRef.current)
      timerRef.current = setTimeout(() => setIdle(true), timeoutMs)
    }
    reset()
    const events: Array<keyof WindowEventMap> = ['pointerdown', 'touchstart', 'wheel']
    events.forEach((ev) => window.addEventListener(ev, reset, { passive: true }))
    return () => {
      events.forEach((ev) => window.removeEventListener(ev, reset))
      if (timerRef.current) clearTimeout(timerRef.current)
    }
  }, [timeoutMs])

  return idle
}
