import { useEffect, useState } from 'react'
import type { NotificationRefusal } from './electron-api'

// The last notification the system did not show, kept by the main process; read again
// when it says it changed. None without Electron.
export function useNotificationRefusal(): NotificationRefusal | null {
  const [refusal, setRefusal] = useState<NotificationRefusal | null>(null)
  useEffect(() => {
    let current = true
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
    const read = () => {
      bridge?.getNotificationRefusal?.().then(value => { if (current) setRefusal(value) }).catch(() => {})
    }
    read()
    const stop = bridge?.onNotificationRefusal?.(read)
    return () => {
      current = false
      stop?.()
    }
  }, [])
  return refusal
}
