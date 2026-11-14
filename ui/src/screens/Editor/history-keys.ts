import { useEffect, useRef } from 'react'
import { openModalCount } from '../../components/Modal/open-modals'
import { isTextField, OVERLAY } from '../../keys'
import { currentOs, type Os } from '../../platform/os'

export type HistoryKey = Pick<KeyboardEvent, 'key' | 'code' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'>

export type HistoryAction = 'back' | 'forward' | 'pass'

export interface HistoryContext {
  // A modal window is open.
  overlayOpen: boolean
  // A menu, a select list or a popover is on the screen, wherever the focus is.
  layerShown: boolean
}

// Alt with an arrow on Linux and Windows, ⌘ with a bracket on macOS, by the key's
// place, so the layout does not matter.
function chord(key: HistoryKey, os: Os): HistoryAction {
  if (key.ctrlKey || key.shiftKey) return 'pass'
  if (os === 'mac') {
    if (!key.metaKey || key.altKey) return 'pass'
    return key.code === 'BracketLeft' ? 'back' : key.code === 'BracketRight' ? 'forward' : 'pass'
  }
  if (!key.altKey || key.metaKey) return 'pass'
  return key.key === 'ArrowLeft' ? 'back' : key.key === 'ArrowRight' ? 'forward' : 'pass'
}

// What a key does to the history, from the key, the element in focus and what is on
// the screen. In a text field the arrows move the caret; a window, a menu, a select
// list or a popover keeps its keys.
export function historyKey(key: HistoryKey, target: Element | null, { overlayOpen, layerShown }: HistoryContext, os: Os): HistoryAction {
  if (key.isComposing) return 'pass'
  const action = chord(key, os)
  if (action === 'pass' || overlayOpen || layerShown) return 'pass'
  if (target && (target.closest(OVERLAY) || isTextField(target))) return 'pass'
  return action
}

// The side buttons of a mouse, as Chromium numbers them on Linux and Windows. A text
// field does not stop them: they move no caret.
export function historyButton(button: number, { overlayOpen, layerShown }: HistoryContext): HistoryAction {
  if (overlayOpen || layerShown) return 'pass'
  return button === 3 ? 'back' : button === 4 ? 'forward' : 'pass'
}

const context = (): HistoryContext => ({ overlayOpen: openModalCount() > 0, layerShown: document.querySelector(OVERLAY) !== null })

// Back and Forward from the keyboard and the mouse. Heard on the window on the way
// down and taken there, so Alt with an arrow on the waveform of the player goes back
// rather than seeks.
export function useHistoryKeys(onBack: () => void, onForward: () => void) {
  const handlers = useRef({ onBack, onForward })
  handlers.current = { onBack, onForward }
  useEffect(() => {
    const os = currentOs()
    const run = (action: HistoryAction) => (action === 'back' ? handlers.current.onBack() : handlers.current.onForward())
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const action = historyKey(event, target, context(), os)
      if (action === 'pass') return
      event.preventDefault()
      event.stopPropagation()
      run(action)
    }
    // The press too, so nothing else takes the button.
    const onMouseDown = (event: MouseEvent) => {
      if (historyButton(event.button, context()) !== 'pass') event.preventDefault()
    }
    const onMouseUp = (event: MouseEvent) => {
      const action = historyButton(event.button, context())
      if (action === 'pass') return
      event.preventDefault()
      event.stopPropagation()
      run(action)
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('mousedown', onMouseDown, true)
    window.addEventListener('mouseup', onMouseUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('mousedown', onMouseDown, true)
      window.removeEventListener('mouseup', onMouseUp, true)
    }
  }, [])
}
