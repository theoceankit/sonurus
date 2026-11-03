import { useCallback, useEffect, useRef, useState } from 'react'

// A window or menu shown for a value of state: the value goes, and the window still
// has its way out to play. This keeps the last value until onExited, and `open` says
// which way it is going. A new value starts over, with a new `key`.
export function useLingering<T>(value: T | null) {
  const [kept, setKept] = useState<{ value: T; key: number } | null>(null)
  const counter = useRef(0)
  const closed = useRef(value === null)
  closed.current = value === null
  const drop = useCallback(() => setKept(null), [])
  // A window can also go because another one takes its place, which is no way out.
  const exited = useCallback(() => { if (closed.current) setKept(null) }, [])

  let current = kept
  if (value !== null && value !== kept?.value) {
    current = { value, key: counter.current++ }
    setKept(current)
  }
  return { value: current?.value ?? null, key: current?.key ?? 0, open: value !== null, exited, drop }
}

// Stands inside what Radix keeps until its way out has played. StrictMode runs the
// cleanup once on mounting too, so the check waits to see whether it came back.
export function ExitSignal({ onExited }: { onExited?: () => void }) {
  const latest = useRef(onExited)
  latest.current = onExited
  const alive = useRef(false)
  useEffect(() => {
    alive.current = true
    return () => {
      alive.current = false
      queueMicrotask(() => { if (!alive.current) latest.current?.() })
    }
  }, [])
  return null
}
