import * as RadixTooltip from '@radix-ui/react-tooltip'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import styles from './Tooltip.module.css'

export type TooltipPlacement = 'above' | 'below' | 'none'

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

export function Tooltip({ text, placement = 'above', children, open, ...props }: TooltipProps) {
  return (
    <RadixTooltip.Root open={open}>
      <RadixTooltip.Trigger asChild {...props}>{children}</RadixTooltip.Trigger>
      <RadixTooltip.Portal>
        <RadixTooltip.Content side={placement === 'below' ? 'bottom' : 'top'} sideOffset={OFFSET} className={styles.tooltip}>
          {text}
          {placement !== 'none' && <RadixTooltip.Arrow className={styles.arrow} />}
        </RadixTooltip.Content>
      </RadixTooltip.Portal>
    </RadixTooltip.Root>
  )
}
