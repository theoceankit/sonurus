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
