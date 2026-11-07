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
  // Playing its way out: it stays on the screen and no longer counts.
  closing?: boolean
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

const closing = (list: ToastEntry[], ids: Set<number>) => list.map(entry => (ids.has(entry.id) ? { ...entry, closing: true } : entry))

export const dismissToast = (id: number) => publish(closing(entries, new Set([id])))
export const removeToast = (id: number) => publish(entries.filter(entry => entry.id !== id))
export const dismissAllToasts = () => publish([])

// A plain function, so code outside React can show a toast too. Needs one
// Toaster mounted; returns a function that takes the toast away.
export function toast(options: ToastOptions): () => void {
  const id = nextId++
  const duration = options.duration ?? (options.action ? DURATION_WITH_ACTION : DURATION)
  const next = [...entries, { ...options, duration, id }]
  const showing = next.filter(entry => !entry.closing)
  const oldest = showing.slice(0, Math.max(0, showing.length - MAX_VISIBLE)).map(entry => entry.id)
  publish(closing(next, new Set(oldest)))
  return () => dismissToast(id)
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const useToasts = () => useSyncExternalStore(subscribe, () => entries)
