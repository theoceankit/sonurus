import { useEffect, useState, type RefObject } from 'react'

export interface SelectionPoint {
  // The middle of the selection's top edge, in the content's own coordinates.
  x: number
  y: number
}

// Too narrow to be meant.
const MIN_WIDTH = 4

// Where the text selected in the transcript is, or null. It appears once the press
// is over, not while the selection is still growing.
export function useTextSelection(content: RefObject<HTMLElement | null>, blocked: () => boolean): SelectionPoint | null {
  const [point, setPoint] = useState<SelectionPoint | null>(null)

  useEffect(() => {
    const update = () => {
      const selection = window.getSelection()
      const node = content.current
      const anchor = selection?.anchorNode
      if (!selection || !node || !anchor || selection.isCollapsed || selection.rangeCount === 0 || blocked()) return setPoint(null)
      const element = anchor.nodeType === Node.ELEMENT_NODE ? anchor as Element : anchor.parentElement
      if (!element?.closest('[data-transcript-list]') || !node.contains(element)) return setPoint(null)
      const rect = selection.getRangeAt(0).getBoundingClientRect()
      if (rect.width < MIN_WIDTH) return setPoint(null)
      const base = node.getBoundingClientRect()
      setPoint({ x: rect.left + rect.width / 2 - base.left, y: rect.top - base.top })
    }
    const clear = () => { if (window.getSelection()?.isCollapsed !== false) setPoint(null) }

    document.addEventListener('mouseup', update)
    document.addEventListener('keyup', update)
    document.addEventListener('selectionchange', clear)
    return () => {
      document.removeEventListener('mouseup', update)
      document.removeEventListener('keyup', update)
      document.removeEventListener('selectionchange', clear)
    }
  }, [content, blocked])

  return point
}
