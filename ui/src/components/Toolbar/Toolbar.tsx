import * as RadixToolbar from '@radix-ui/react-toolbar'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import { cx } from '../../styles/cx'
import { IconButton, type IconButtonProps } from '../IconButton/IconButton'
import { Tooltip, TooltipGroup } from '../Tooltip/Tooltip'
import styles from './Toolbar.module.css'

interface ToolbarProps extends Omit<ComponentPropsWithRef<typeof RadixToolbar.Root>, 'asChild' | 'orientation' | 'aria-label'> {
  // There is no visible name, so this is what assistive technology reads.
  label: string
}

// A floating bar of actions. It is one stop for Tab, arrows move inside it; the
// screen decides where it stands and when it shows. Its buttons share a tooltip.
export function Toolbar({ label, className, ...props }: ToolbarProps) {
  return (
    <TooltipGroup>
      <RadixToolbar.Root aria-label={label} className={cx(styles.toolbar, className)} {...props} />
    </TooltipGroup>
  )
}

// Wraps one button, usually a Ghost Small IconButton or a Toolbar Button.
// Takes what a menu's trigger passes, so a menu can open from the bar.
export function ToolbarItem({ children, ...props }: { children: ReactElement } & ComponentPropsWithRef<'button'>) {
  return <RadixToolbar.Button asChild {...props}>{children}</RadixToolbar.Button>
}

// A button with only an icon, which names itself in a tooltip.
export function ToolbarAction({ label, ...props }: IconButtonProps) {
  return (
    <Tooltip text={label}>
      <ToolbarItem><IconButton label={label} {...props} /></ToolbarItem>
    </Tooltip>
  )
}

export function ToolbarDivider() {
  return <RadixToolbar.Separator className={styles.divider} />
}
