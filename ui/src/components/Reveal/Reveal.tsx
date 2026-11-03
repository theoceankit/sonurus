import { useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import { prefersReducedMotion } from '../../presence'
import { cx } from '../../styles/cx'
import styles from './Reveal.module.css'

interface RevealProps {
  open: boolean
  // One element: what is shown. It may be squeezed by the layout, as a card in a low panel.
  children: ReactNode
  className?: string
}

const durationOf = (element: HTMLElement, token: string) => parseFloat(getComputedStyle(element).getPropertyValue(token)) || 0

// Opens in place to the height the layout gives it, which Collapse cannot: Radix
// measures the content on its own, so content the layout squeezes would grow past its
// place and jump back. On the way the content keeps the size it has at the end it
// comes from or goes to, and is cut at the bottom rather than squeezed.
export function Reveal({ open, children, className }: RevealProps) {
  const box = useRef<HTMLDivElement>(null)
  const [mounted, setMounted] = useState(open)
  const settle = useRef<ReturnType<typeof setTimeout>>(undefined)
  const first = useRef(true)
  if (open && !mounted) setMounted(true)

  useLayoutEffect(() => {
    const element = box.current
    if (first.current || !element) {
      first.current = false
      return undefined
    }
    const content = element.firstElementChild?.firstElementChild as HTMLElement | null
    clearTimeout(settle.current)
    if (content && !prefersReducedMotion()) {
      content.style.height = ''
      content.style.flex = ''
      let height: number
      if (open) {
        // The height at the end: laid out there once, then back to the start of the way.
        element.style.transition = 'none'
        element.style.gridTemplateRows = '1fr'
        height = content.offsetHeight
        element.style.gridTemplateRows = '0fr'
        void element.offsetHeight
        element.style.transition = ''
        element.style.gridTemplateRows = ''
      } else {
        height = content.offsetHeight
      }
      content.style.height = `${height}px`
      content.style.flex = 'none'
    }
    settle.current = setTimeout(() => {
      if (content) {
        content.style.height = ''
        content.style.flex = ''
      }
      if (!open) setMounted(false)
    }, durationOf(element, open ? '--duration-slow' : '--duration-base'))
    return undefined
  }, [open])

  useLayoutEffect(() => () => clearTimeout(settle.current), [])

  if (!mounted) return null
  return (
    <div ref={box} className={cx(styles.reveal, className)} data-open={open || undefined} inert={!open}>
      <div className={styles.inner}>{children}</div>
    </div>
  )
}
