// What the keys the screen listens for on the window, Space and Escape, leave alone.

// Inside these a key has its own job: a window, a menu, a select list, a popover.
export const OVERLAY = '[role="dialog"], [role="alertdialog"], [role="menu"], [role="listbox"]'

const NOT_TEXT = new Set(['button', 'checkbox', 'color', 'file', 'hidden', 'image', 'radio', 'range', 'reset', 'submit'])

// A field that takes typing, where Space and Escape belong to it.
export const isTextField = (element: Element) =>
  (element instanceof HTMLInputElement && !NOT_TEXT.has(element.type))
  || element instanceof HTMLTextAreaElement
  || (element instanceof HTMLElement && element.isContentEditable)
  || element.closest('[contenteditable=""], [contenteditable="true"]') !== null

// How the element in focus got it. :focus-visible cannot tell: Chromium turns it
// on for the focused element at the keydown of any key, Space and Escape included.
// Focus given by code counts as from the last input, as in the browser.
export function createFocusOrigin() {
  let lastInput: 'pointer' | 'keyboard' = 'keyboard'
  let pointerFocused: Element | null = null
  const onPointerDown = (event: Event) => {
    lastInput = 'pointer'
    // A press on the element that has the focus already does not move it.
    const active = document.activeElement
    if (active && event.target instanceof Node && active.contains(event.target)) pointerFocused = active
  }
  const onKeyDown = (event: KeyboardEvent) => { if (event.key !== ' ') lastInput = 'keyboard' }
  const onFocusIn = (event: FocusEvent) => {
    pointerFocused = lastInput === 'pointer' && event.target instanceof Element ? event.target : null
  }
  return {
    pointerFocused: () => (pointerFocused && document.activeElement === pointerFocused ? pointerFocused : null),
    listen() {
      window.addEventListener('pointerdown', onPointerDown, true)
      window.addEventListener('keydown', onKeyDown, true)
      window.addEventListener('focusin', onFocusIn, true)
      return () => {
        window.removeEventListener('pointerdown', onPointerDown, true)
        window.removeEventListener('keydown', onKeyDown, true)
        window.removeEventListener('focusin', onFocusIn, true)
      }
    },
  }
}
