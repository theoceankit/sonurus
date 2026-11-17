import { useEffect, useRef } from 'react'
import type { WindowIntent } from './electron-api'

// The dialog a click on a notification asked for (electron/recording-prompts.js). The
// main process keeps it until the window takes it: on load, for a window it made for
// the click, and whenever it says one waits, for a window already open.
export function useWindowIntent(handle: (intent: WindowIntent) => void) {
  const latest = useRef(handle)
  latest.current = handle
  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
    if (!bridge?.takeWindowIntent) return
    let current = true
    const take = () => {
      bridge.takeWindowIntent().then(intent => { if (current && intent) latest.current(intent) }).catch(() => {})
    }
    take()
    const stop = bridge.onWindowIntent?.(take)
    return () => {
      current = false
      stop?.()
    }
  }, [])
}
