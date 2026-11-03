import { useEffect, useRef, useState, type PointerEvent } from 'react'
import styles from './ScrollBar.module.css'

const MIN_THUMB = 24
const SCROLLING_MS = 800

interface ScrollBarProps {
  // The scrolling element. The bar is its next sibling, in the same positioned parent.
  area: HTMLElement | null
}

// Shown while the pointer is over the parent, while the area scrolls and while dragged.
// Scrolling changes the styles directly, so it does not re-render.
export function ScrollBar({ area }: ScrollBarProps) {
  const [overflows, setOverflows] = useState(false)
  const bar = useRef<HTMLDivElement>(null)
  const thumb = useRef<HTMLDivElement>(null)
  const drag = useRef<{ y: number; scrollTop: number } | null>(null)

  const travel = () => {
    const thumbHeight = Math.max(MIN_THUMB, area!.clientHeight ** 2 / area!.scrollHeight)
    return { thumbHeight, room: area!.clientHeight - thumbHeight, scrollable: area!.scrollHeight - area!.clientHeight }
  }

  useEffect(() => {
    if (!area) return
    let timer: ReturnType<typeof setTimeout>
    const place = () => {
      setOverflows(area.scrollHeight > area.clientHeight)
      if (!bar.current || !thumb.current) return
      const { thumbHeight, room, scrollable } = travel()
      bar.current.style.top = `${area.offsetTop}px`
      bar.current.style.left = `${area.offsetLeft + area.offsetWidth - bar.current.offsetWidth}px`
      bar.current.style.height = `${area.offsetHeight}px`
      thumb.current.style.height = `${thumbHeight}px`
      thumb.current.style.transform = `translateY(${scrollable > 0 ? area.scrollTop / scrollable * room : 0}px)`
    }
    const onScroll = () => {
      place()
      if (!bar.current) return
      bar.current.dataset.scrolling = ''
      clearTimeout(timer)
      timer = setTimeout(() => { if (bar.current) delete bar.current.dataset.scrolling }, SCROLLING_MS)
    }
    place()
    const resized = new ResizeObserver(place)
    const observeAll = () => {
      resized.disconnect()
      resized.observe(area)
      for (const child of area.children) resized.observe(child)
    }
    observeAll()
    const changed = new MutationObserver(() => { observeAll(); place() })
    changed.observe(area, { childList: true })
    area.addEventListener('scroll', onScroll, { passive: true })
    return () => {
      clearTimeout(timer)
      resized.disconnect()
      changed.disconnect()
      area.removeEventListener('scroll', onScroll)
    }
  }, [area, overflows])

  if (!area || !overflows) return null

  const onPointerDown = (event: PointerEvent<HTMLDivElement>) => {
    event.preventDefault()
    event.currentTarget.setPointerCapture?.(event.pointerId)
    drag.current = { y: event.clientY, scrollTop: area.scrollTop }
  }
  const onPointerMove = (event: PointerEvent<HTMLDivElement>) => {
    if (!drag.current) return
    const { room, scrollable } = travel()
    area.scrollTop = drag.current.scrollTop + (event.clientY - drag.current.y) * scrollable / room
  }
  const onPointerUp = () => { drag.current = null }

  return (
    <div ref={bar} aria-hidden className={styles.scrollBar}>
      <div
        ref={thumb}
        data-testid="scroll-thumb"
        className={styles.thumb}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
      />
    </div>
  )
}
