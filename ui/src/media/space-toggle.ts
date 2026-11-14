import { useEffect, useState } from 'react'
import { openModalCount } from '../components/Modal/open-modals'
import { createFocusOrigin, isTextField, OVERLAY } from '../keys'
import type { Playback } from './playback'

export type SpaceKey = Pick<KeyboardEvent, 'key' | 'repeat' | 'ctrlKey' | 'altKey' | 'shiftKey' | 'metaKey' | 'isComposing'>

// toggle: play or pause; swallow: a held space after the first, which does nothing
// at all; pass: the space does what it did before, untouched.
export type SpaceAction = 'toggle' | 'swallow' | 'pass'

// What the space presses by itself.
const PRESSED = [
  'button', 'summary', 'select', 'input[type="checkbox"]', 'input[type="radio"]', 'input[type="button"]',
  'input[type="submit"]', 'input[type="reset"]',
  ...['button', 'checkbox', 'switch', 'radio', 'tab', 'menuitem', 'menuitemcheckbox', 'menuitemradio', 'option', 'combobox']
    .map(role => `[role="${role}"]`),
].join(', ')

export interface SpaceContext {
  // A modal window is open.
  overlayOpen: boolean
  // The element that took the focus from a press of the pointer, if it still has it.
  pointerFocused: Element | null
}

// What the space does, from the key and the element in focus. A button the user
// tabbed to is pressed as before; one left in focus by a click would otherwise
// repeat its action, so there the space plays and pauses.
export function spaceAction(key: SpaceKey, target: Element | null, { overlayOpen, pointerFocused }: SpaceContext): SpaceAction {
  if (key.key !== ' ' || key.ctrlKey || key.altKey || key.shiftKey || key.metaKey || key.isComposing) return 'pass'
  if (overlayOpen) return 'pass'
  if (target) {
    if (target.closest(OVERLAY)) return 'pass'
    if (isTextField(target)) return 'pass'
    const pressed = target.closest(PRESSED)
    if (pressed && !(pointerFocused && pointerFocused.contains(target))) return 'pass'
  }
  return key.repeat ? 'swallow' : 'toggle'
}

// Space plays and pauses while enabled. Heard on the window on the way down,
// before React and Radix: a menu button opens on the keydown of the space. A
// focused button is pressed on the keyup, in Chromium even after a cancelled
// keydown, so the keyup of a space taken here is cancelled as well.
export function useSpaceToggle(playback: Playback, enabled: boolean) {
  // Followed from the start, so a button clicked while the audio loads still counts.
  const [origin] = useState(createFocusOrigin)
  useEffect(() => origin.listen(), [origin])
  useEffect(() => {
    if (!enabled) return
    let taken = false
    const onKeyDown = (event: KeyboardEvent) => {
      const target = event.target instanceof Element ? event.target : null
      const action = spaceAction(event, target, { overlayOpen: openModalCount() > 0, pointerFocused: origin.pointerFocused() })
      if (action === 'pass') return
      taken = true
      event.preventDefault()
      event.stopPropagation()
      if (action === 'toggle') playback.toggle()
    }
    const onKeyUp = (event: KeyboardEvent) => {
      if (event.key !== ' ' || !taken) return
      taken = false
      event.preventDefault()
      event.stopPropagation()
    }
    window.addEventListener('keydown', onKeyDown, true)
    window.addEventListener('keyup', onKeyUp, true)
    return () => {
      window.removeEventListener('keydown', onKeyDown, true)
      window.removeEventListener('keyup', onKeyUp, true)
    }
  }, [playback, enabled, origin])
}
