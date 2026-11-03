import type { KeyStore } from '../../media/active-segment'
import { HOVER_DELAY, HOVER_SKIP } from '../../styles/motion'

export interface HoverIntent {
  enter(id: string): void
  // Without an id, whatever is lit or waiting goes.
  leave(id?: string): void
  focus(id: string): void
  cancel(): void
}

// A pointer on its way across the panel highlights nobody: a speaker lights up once
// the pointer has stayed on them. While one is lit, and just after, the next comes at
// once, as tooltips do. The focus and leaving act at once.
export function createHoverIntent(store: KeyStore<string | null>): HoverIntent {
  let pending: string | null = null
  let timer: ReturnType<typeof setTimeout> | undefined
  let wentOut = -Infinity

  const cancel = () => {
    clearTimeout(timer)
    pending = null
  }
  const light = (id: string) => {
    cancel()
    store.set(id)
  }

  return {
    enter(id) {
      if (store.get() !== null || Date.now() - wentOut < HOVER_SKIP) return light(id)
      cancel()
      pending = id
      timer = setTimeout(() => light(id), HOVER_DELAY)
    },
    leave(id) {
      if (id === undefined || pending === id) cancel()
      if (store.get() !== null && (id === undefined || store.get() === id)) {
        store.set(null)
        wentOut = Date.now()
      }
    },
    focus: light,
    cancel,
  }
}
