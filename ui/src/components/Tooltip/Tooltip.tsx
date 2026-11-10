import * as RadixTooltip from '@radix-ui/react-tooltip'
import {
  cloneElement, createContext, useContext, useEffect, useId, useRef, useState,
  type ComponentPropsWithRef, type FocusEvent, type PointerEvent, type ReactElement,
} from 'react'
import styles from './Tooltip.module.css'

export type TooltipPlacement = 'above' | 'below' | 'none'

interface Shown {
  owner: string
  element: HTMLElement
  plate: HTMLElement
  trigger: Element | null
  setOpen: (open: boolean) => void
}

interface Group {
  id: string
  // The tooltip of the group last shown; it may be on its way out.
  last: { current: Shown | null }
  // One of the group is open: the next comes at once, however long it was shown.
  active: boolean
  setActive: (update: (owner: string | null) => string | null) => void
}

const GroupContext = createContext<Group | null>(null)

type GroupArea = ReactElement<{ onPointerLeave?: (event: PointerEvent<HTMLElement>) => void }>

// Neighbouring controls share one tooltip: moving from one to the next, it changes
// its text and width and points at the next one instead of going away and coming
// again. The child is the area of the group: the tooltip stays over the gaps
// between the controls and goes once the pointer leaves the area.
export function TooltipGroup({ children }: { children: GroupArea }) {
  const id = useId()
  const last = useRef<Shown | null>(null)
  const [active, setActive] = useState<string | null>(null)
  const area = cloneElement(children, {
    'data-tooltip-group': id,
    onPointerLeave: (event: PointerEvent<HTMLElement>) => {
      children.props.onPointerLeave?.(event)
      last.current?.setOpen(false)
    },
  } as object)
  return <GroupContext.Provider value={{ id, last, active: active !== null, setActive }}>{area}</GroupContext.Provider>
}

interface From {
  rect: DOMRect
  arrow: number | null
  side: string | undefined
  // Where it hangs from, and how far it stands off its place on the way there.
  trigger: DOMRect | undefined
  lift: number
}

// Radix names the tooltip in the trigger's aria-describedby while it is open.
const triggerOf = (element: HTMLElement) => element.id ? document.querySelector(`[aria-describedby~="${element.id}"]`) : null

function liftOf(element: HTMLElement): number {
  const [, y] = getComputedStyle(element).translate.split(' ')
  return y ? parseFloat(y) : 0
}

// A neighbour of another size hangs its tooltip higher or lower: the tooltip comes
// from the height the last one stood at.
function lift(start: From, element: HTMLElement, trigger: Element | null): number {
  if (!start.trigger || !trigger) return 0
  const to = trigger.getBoundingClientRect()
  const edge = element.dataset.side === 'bottom' ? 'bottom' : 'top'
  return start.lift + start.trigger[edge] - to[edge]
}

function arrowCentre(element: HTMLElement): number | null {
  const arrow = element.querySelector('svg')?.getBoundingClientRect()
  return arrow ? arrow.left + arrow.width / 2 : null
}

const clamp = (value: number, min: number, max: number) => Math.min(Math.max(value, min), max)

// The one shown stays open, even on its way from another one, until the next is
// in place: Radix closes it as the next one opens.
function holdLast(group: Group, owner: string): Shown | null {
  const shown = group.last.current
  // Already on its way out, it is left to fade.
  if (!shown || shown.owner === owner || !shown.element.isConnected || shown.element.dataset.state === 'closed') return null
  shown.setOpen(true)
  return shown
}

// Where it stands now, then gone at once; its way out runs unseen.
function replace(shown: Shown): From {
  const { element, plate } = shown
  const from = {
    rect: plate.getBoundingClientRect(),
    arrow: arrowCentre(element),
    side: element.dataset.side,
    trigger: shown.trigger?.getBoundingClientRect(),
    lift: liftOf(element),
  }
  element.dataset.handoff = 'out'
  shown.setOpen(false)
  return from
}

let returning: Element | null = null

// Focus given back to a control, as a window does on closing, shows no tooltip: the
// person did not come to the control, and the tooltip would stay with no pointer on
// it until focus moves on. Coming to it from the keyboard again shows it as always.
export function returnFocus(element: HTMLElement) {
  returning = element
  try {
    element.focus()
  } finally {
    returning = null
  }
}

// What is left goes to the trigger, so a menu can open from a control with a tooltip.
interface TooltipProps extends Omit<ComponentPropsWithRef<typeof RadixTooltip.Trigger>, 'asChild' | 'children'> {
  text: string
  // None has no arrow and shows above, as on the Penpot board. Without room on the
  // chosen side the tooltip takes the other one.
  placement?: TooltipPlacement
  // One element that takes a ref and pointer handlers.
  children: ReactElement
  open?: boolean
}

// The distance from the control, the arrow comes on top of it.
const OFFSET = 4

export function Tooltip({ text, placement = 'above', children, open, onPointerLeave, onFocus, ...props }: TooltipProps) {
  const group = useContext(GroupContext)
  const owner = useId()
  const [shown, setShown] = useState(false)
  const content = useRef<HTMLDivElement>(null)
  const plate = useRef<HTMLSpanElement>(null)
  const replacing = useRef<Shown | null>(null)
  const overGap = useRef(false)

  useEffect(() => {
    group?.setActive(current => shown ? owner : current === owner ? null : current)
  }, [group?.setActive, shown, owner])

  const handleOpenChange = (next: boolean) => {
    if (!next && overGap.current) {
      overGap.current = false
      return
    }
    setShown(next)
    if (next && group) replacing.current = holdLast(group, owner)
  }

  // Within the group the pointer only crosses a gap to the next control: Radix
  // closes on leaving, which then does not count.
  const handlePointerLeave = (event: PointerEvent<HTMLButtonElement>) => {
    onPointerLeave?.(event)
    const to = event.relatedTarget
    overGap.current = Boolean(group && shown && to instanceof Element && to.closest(`[data-tooltip-group="${group.id}"]`))
  }

  // Radix opens on focus unless the handler before it prevents that.
  const handleFocus = (event: FocusEvent<HTMLButtonElement>) => {
    onFocus?.(event)
    if (returning && event.currentTarget.contains(returning)) event.preventDefault()
  }

  // Radix has placed it: it starts where the one it replaces stood. Its height is
  // taken from the controls: Radix places it once more, lower by the height of the
  // arrow, before it is seen.
  const handlePlaced = () => {
    const element = content.current
    if (!group || !element || !plate.current) return
    const trigger = triggerOf(element)
    group.last.current = { owner, element, plate: plate.current, trigger, setOpen: setShown }
    const last = replacing.current
    replacing.current = null
    delete element.dataset.handoff
    if (!last) return
    const start = replace(last)
    if (start.side !== element.dataset.side) return
    stayAndPoint(element, plate.current, start, lift(start, element, trigger))
  }

  return (
    <RadixTooltip.Root
      open={open ?? (group ? shown : undefined)}
      onOpenChange={handleOpenChange}
      delayDuration={group?.active ? 0 : undefined}
      disableHoverableContent={group ? true : undefined}
    >
      <RadixTooltip.Trigger asChild onPointerLeave={handlePointerLeave} onFocus={handleFocus} {...props}>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content
          ref={content}
          side={placement === 'below' ? 'bottom' : 'top'}
          sideOffset={OFFSET}
          className={styles.tooltip}
          {...{ onPlaced: handlePlaced } as object}
          onAnimationEnd={event => {
            // Settled, it does not come in again as Radix's opening.
            if (event.target === event.currentTarget && event.animationName.includes('handoffMove')) event.currentTarget.dataset.handoff = 'settled'
          }}
        >
          <span ref={plate} className={styles.plate} aria-hidden />
          <span className={styles.text}>{text}</span>
          {placement !== 'none' && <RadixTooltip.Arrow className={styles.arrow} />}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}

// The block keeps its place and grows or shrinks about its middle, moving only as
// far as it must to keep the arrow under it; the arrow travels to the new control.
function stayAndPoint(element: HTMLElement, plate: HTMLElement, start: From, dy: number) {
  const rect = element.getBoundingClientRect()
  const arrow = element.querySelector('svg')
  const pointsAt = arrowCentre(element)
  const middle = rect.left + rect.width / 2
  const from = start.rect.left + start.rect.width / 2
  // The arrow stays clear of the rounded corners.
  const margin = (arrow?.getBoundingClientRect().width ?? 0) / 2 + parseFloat(getComputedStyle(plate).borderTopLeftRadius)
  const half = rect.width / 2 - margin
  const under = pointsAt === null ? middle : clamp(from, pointsAt - half, pointsAt + half)
  // Nor does it leave the window, as Radix keeps it in.
  const to = clamp(under, Math.min(middle, rect.width / 2), Math.max(middle, innerWidth - rect.width / 2))
  const offset = to - middle
  element.style.translate = `${offset}px 0`
  element.style.setProperty('--handoff-shift', `${from - middle}px ${dy}px`)
  // The plate starts at the width of the one it replaces, and the text, which is
  // already the new one, shows only over it.
  const inset = (rect.width - start.rect.width) / 2
  element.style.setProperty('--handoff-inset', `${inset}px`)
  element.style.setProperty('--handoff-clip', `${Math.max(0, inset - parseFloat(getComputedStyle(element).paddingLeft))}px`)
  if (arrow && pointsAt !== null) {
    // Turned over below the control, the arrow counts x the other way.
    const sign = element.dataset.side === 'bottom' ? -1 : 1
    arrow.style.translate = `${-offset * sign}px 0`
    const arrowFrom = (start.arrow ?? pointsAt) - pointsAt - (from - middle)
    arrow.style.setProperty('--handoff-arrow', `${arrowFrom * sign}px 0`)
  }
  element.dataset.handoff = 'in'
}
