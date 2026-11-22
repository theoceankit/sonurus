import { useRef, type PointerEvent } from 'react'
import { cx } from '../../styles/cx'
import styles from './PanelResizer.module.css'

interface PanelResizerProps {
  label: string
  className?: string
  // How far the mouse has gone from where it was pressed, to the right.
  onResize: (travel: number) => void
  // Only after the mouse has moved: a click changes nothing.
  onResizeEnd: () => void
  onResizeCancel: () => void
}

// The gap between two panels, dragged with the mouse. The screen decides what the
// travel does to the width.
export function PanelResizer({ label, className, onResize, onResizeEnd, onResizeCancel }: PanelResizerProps) {
  const drag = useRef<{ pointer: number; x: number; moved: boolean } | null>(null)

  const down = (event: PointerEvent<HTMLDivElement>) => {
    if (event.button !== 0) return
    // No text gets selected on the way.
    event.preventDefault()
    event.currentTarget.setPointerCapture(event.pointerId)
    drag.current = { pointer: event.pointerId, x: event.clientX, moved: false }
  }
  const move = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.pointer !== event.pointerId || event.clientX === current.x && !current.moved) return
    current.moved = true
    onResize(event.clientX - current.x)
  }
  const up = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.pointer !== event.pointerId) return
    drag.current = null
    if (current.moved) onResizeEnd()
  }
  const cancel = (event: PointerEvent<HTMLDivElement>) => {
    const current = drag.current
    if (current?.pointer !== event.pointerId) return
    drag.current = null
    if (current.moved) onResizeCancel()
  }

  return (
    <div
      role="separator"
      aria-orientation="vertical"
      aria-label={label}
      className={cx(styles.resizer, className)}
      onPointerDown={down}
      onPointerMove={move}
      onPointerUp={up}
      onPointerCancel={cancel}
    />
  )
}
