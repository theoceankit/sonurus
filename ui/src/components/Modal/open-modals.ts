import { useSyncExternalStore } from 'react'

// The modal windows open now, in the order they opened, each counted from when it
// opens to when it is told to close (its way out does not count). Whatever opens a
// window by itself, such as a drag of files or a failed job, asks first whether one
// is open already. A toast hands Escape to the one on top: Radix makes a toast a
// dismissable layer too, and one shown over a modal would take Escape from it.
const open: { close?: () => void }[] = []
const listeners = new Set<() => void>()
const notify = () => listeners.forEach(listener => listener())

// Counts a window as open until the returned function is called. close: how Escape
// handed on by a toast closes it.
export function holdOpenModal(close?: () => void): () => void {
  const entry = { close }
  open.push(entry)
  notify()
  let held = true
  return () => {
    if (!held) return
    held = false
    open.splice(open.indexOf(entry), 1)
    notify()
  }
}

export const openModalCount = () => open.length

// Closes the window on top; false when none is open.
export function closeTopModal(): boolean {
  const top = open.at(-1)
  if (!top) return false
  top.close?.()
  return true
}

const subscribe = (listener: () => void) => {
  listeners.add(listener)
  return () => { listeners.delete(listener) }
}

export const useOpenModalCount = () => useSyncExternalStore(subscribe, openModalCount)
