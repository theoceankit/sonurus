import * as RadixToolbar from '@radix-ui/react-toolbar'
import type { ComponentPropsWithRef, ReactElement } from 'react'
import { cx } from '../../styles/cx'
import styles from './Toolbar.module.css'

interface ToolbarProps extends Omit<ComponentPropsWithRef<typeof RadixToolbar.Root>, 'asChild' | 'orientation' | 'aria-label'> {
  // There is no visible name, so this is what assistive technology reads.
  label: string
}

// A floating bar of actions. It is one stop for Tab, arrows move inside it; the
// screen decides where it stands and when it shows.
export function Toolbar({ label, className, ...props }: ToolbarProps) {
  return <RadixToolbar.Root aria-label={label} className={cx(styles.toolbar, className)} {...props} />
}

// Wraps one button, usually a Ghost Small IconButton or a Toolbar Button.
// Takes what a menu's trigger passes, so a menu can open from the bar.
export function ToolbarItem({ children, ...props }: { children: ReactElement } & ComponentPropsWithRef<'button'>) {
  return <RadixToolbar.Button asChild {...props}>{children}</RadixToolbar.Button>
}

export function ToolbarDivider() {
  return <RadixToolbar.Separator className={styles.divider} />
}
