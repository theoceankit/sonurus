import { useSyncExternalStore } from 'react'

export type ToastType = 'default' | 'error'

export interface ToastOptions {
  message: string
  type?: ToastType
  action?: { label: string; onClick: () => void }
  // In milliseconds. An action needs time to be read and reached.
  duration?: number
}

export interface ToastEntry extends ToastOptions {
  id: number
}

const DURATION = 3200
const DURATION_WITH_ACTION = 6000
const MAX_VISIBLE = 3

let entries: ToastEntry[] = []
let nextId = 0
const listeners = new Set<() => void>()

const publish = (next: ToastEntry[]) => {
  entries = next
  listeners.forEach(listener => listener())
}

export const dismissToast = (id: number) => publish(entries.filter(entry => entry.id !== id))
export const dismissAllToasts = () => publish([])

// A plain function, so code outside React can show a toast too. Needs one
// Toaster mounted; returns a function that takes the toast away.
export function toast(options: ToastOptions): () => void {
  const id = nextId++
  const duration = options.duration ?? (options.action ? DURATION_WITH_ACTION : DURATION)
  publish([...entries, { ...options, duration, id }].slice(-MAX_VISIBLE))
  return () => dismissToast(id)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const useToasts = () => useSyncExternalStore(subscribe, () => entries)
