import { useEffect, useState } from 'react'

// Whether the system has a tray for the app to stay in when its window closes: null
// until the main process has said. Without Electron (Storybook, tests) there is one.
export function useTrayAvailable(): boolean | null {
  const [available, setAvailable] = useState<boolean | null>(null)
  useEffect(() => {
    let current = true
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
    const answer = bridge?.getTrayAvailable ? bridge.getTrayAvailable() : Promise.resolve(true)
    answer.catch(() => false).then(value => { if (current) setAvailable(value) })
    return () => { current = false }
  }, [])
  return available
}
