import { useEffect, useState } from 'react'
import type { MicApp } from './electron-api'

// The apps that held a microphone long enough to suggest a recording, kept by the main
// process; read again on each mount. None without Electron.
export function useMicApps(): MicApp[] {
  const [apps, setApps] = useState<MicApp[]>([])
  useEffect(() => {
    let current = true
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
    bridge?.getMicApps?.().then(read => { if (current) setApps(read) }).catch(() => {})
    return () => { current = false }
  }, [])
  return apps
}
