import { useCallback, useEffect, useState, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import styles from './ScrollFade.module.css'

interface ScrollFadeProps extends Omit<ComponentPropsWithRef<'div'>, 'children'> {
  edge: 'top' | 'bottom'
  // The background it fades into. Raised is for modals: in the dark theme it is
  // not the window's colour.
  surface?: 'window' | 'raised' | 'sunken'
  size?: 'md' | 'lg'
}

// A gradient over the edge of a scroll area, saying there is more content. It is
// a neighbour of the area inside a relative parent: as a child it would scroll away.
export function ScrollFade({ edge, surface = 'window', size = 'md', className, ...props }: ScrollFadeProps) {
  return <div aria-hidden className={cx(styles.scrollFade, styles[edge], styles[surface], styles[size], className)} {...props} />
}

// Rounding of fractional scroll positions leaves the end up to a pixel away.
const TOLERANCE = 1

// Whether there is more to scroll to in each direction. Put scrollRef on the area.
// The state changes only when an answer changes, so scrolling does not re-render.
export function useScrollEdges() {
  const [area, scrollRef] = useState<HTMLElement | null>(null)
  const [top, setTop] = useState(false)
  const [bottom, setBottom] = useState(false)

  const update = useCallback(() => {
    if (!area) return
    setTop(area.scrollTop > TOLERANCE)
    setBottom(area.scrollHeight - area.clientHeight - area.scrollTop > TOLERANCE)
  }, [area])

  useEffect(() => {
    if (!area) return
    update()
    const resized = new ResizeObserver(update)
    const observeAll = () => {
      resized.disconnect()
      resized.observe(area)
      for (const child of area.children) resized.observe(child)
    }
    observeAll()
    const changed = new MutationObserver(() => {
      observeAll()
      update()
    })
    changed.observe(area, { childList: true })
    area.addEventListener('scroll', update, { passive: true })
    return () => {
      resized.disconnect()
      changed.disconnect()
      area.removeEventListener('scroll', update)
    }
  }, [area, update])

  return { area, scrollRef, top, bottom }
}
