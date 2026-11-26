// The input that came last, for the focus a window starts with (Modal). Chromium takes
// focus given by a script for a keyboard one when nothing had focus before, and files
// dragged over the window are no pointer input to it: the control would show its ring
// with nothing pressed. Taken on the way down, before a window opens from the same event.
// Outside is input the page never sees (inputOutsidePage).
export type InputKind = 'keyboard' | 'pointer' | 'outside'

let last: InputKind = 'keyboard'
if (typeof window !== 'undefined') {
  window.addEventListener('keydown', () => { last = 'keyboard' }, true)
  for (const type of ['pointerdown', 'dragenter', 'drop']) window.addEventListener(type, () => { last = 'pointer' }, true)
}

export const lastInput = (): InputKind => last

// Input the page never sees, such as an item of the tray menu or a click on a
// notification, picked by the mouse or the keyboard alike. The window it opens shows
// the ring on what it starts on, as one opened from the keyboard or in a window just
// made, whatever came last in the page. Any input in the page after it counts again.
export function inputOutsidePage() {
  last = 'outside'
}
