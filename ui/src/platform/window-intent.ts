import { useEffect, useRef } from 'react'
import type { WindowIntent } from './electron-api'
import { inputOutsidePage } from './last-input'

// The dialog a click on a notification or an item of the tray menu asked for
// (electron/recording-prompts.js, electron/tray.js). The main process keeps it until the
// window takes it: on load, for a window it made for the click, and whenever it says one
// waits, for a window already open. The window it opens starts as after a key: the last
// input in the page is not what asked for it.
export function useWindowIntent(handle: (intent: WindowIntent) => void) {
  const latest = useRef(handle)
  latest.current = handle
  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
    if (!bridge?.takeWindowIntent) return
    let current = true
    const take = () => {
      bridge.takeWindowIntent().then(intent => {
        if (!current || !intent) return
        inputOutsidePage()
        latest.current(intent)
      }).catch(() => {})
    }
    take()
    const stop = bridge.onWindowIntent?.(take)
    return () => {
      current = false
      stop?.()
    }
  }, [])
}
