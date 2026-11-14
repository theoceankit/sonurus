import { useEffect, useRef } from 'react'
import { openModalCount } from '../../components/Modal/open-modals'
import { isTextField, OVERLAY } from '../../keys'

export type EscapeKey = Pick<KeyboardEvent, 'key' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'>

// close: Escape closes what the centre shows; pass: it does what it did before.
export type EscapeAction = 'close' | 'pass'

// A layer that Escape closes first. A tooltip is one too: Radix closes it on Escape.
const LAYER = `${OVERLAY}, [role="tooltip"]`

export interface EscapeContext {
  // A modal window is open.
  overlayOpen: boolean
  // A menu, a select list, a popover or a tooltip is on the screen, wherever the focus is.
  layerShown: boolean
}

// What Escape does, from the key, the element in focus and what is on the screen.
export function escapeAction(key: EscapeKey, target: Element | null, { overlayOpen, layerShown }: EscapeContext): EscapeAction {
  if (key.key !== 'Escape' || key.ctrlKey || key.altKey || key.shiftKey || key.metaKey || key.isComposing) return 'pass'
  if (overlayOpen || layerShown) return 'pass'
  if (target && (target.closest(OVERLAY) || isTextField(target))) return 'pass'
  return 'close'
}

// Escape closes the open recording while enabled. Heard on the window on the way
// down, before Radix, which closes its layers on an Escape it hears on the
// document: a toast is one, and it stays when Escape closes the recording.
export function useEscapeClose(onClose: () => void, enabled: boolean) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!enabled) return
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const layerShown = document.querySelector(LAYER) !== null
      if (escapeAction(event, target, { overlayOpen: openModalCount() > 0, layerShown }) === 'pass') return
      event.preventDefault()
      event.stopPropagation()
      close.current()
    }
    window.addEventListener('keydown', onKeyDown, true)
    return () => window.removeEventListener('keydown', onKeyDown, true)
  }, [enabled])
}
