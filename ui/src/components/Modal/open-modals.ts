import { useSyncExternalStore } from 'react'

// How many modal windows are open, counted from when one opens to when it is told
// to close (its way out does not count). Whatever opens a window by itself, such as
// a drag of files or a failed job, asks first whether one is open already.
let open = 0
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())

// Counts a window as open until the returned function is called.
export function holdOpenModal(): () => void {
  open += 1
  notify()
  let held = true
  return () => {
    if (!held) return
    held = false
    open -= 1
    notify()
  }
}

export const openModalCount = () => open

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const useOpenModalCount = () => useSyncExternalStore(subscribe, openModalCount)
