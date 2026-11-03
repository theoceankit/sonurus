import * as Collapsible from '@radix-ui/react-collapsible'
import type { ReactNode } from 'react'
import { cx } from '../../styles/cx'
import styles from './Collapse.module.css'

interface CollapseProps {
  open: boolean
  children: ReactNode
  // For the content: how it lays out what is inside.
  className?: string
}

// Content that opens in place and pushes down what is under it. The control that
// opens it is somewhere else; with the control next to it, there is Disclosure.
export function Collapse({ open, children, className }: CollapseProps) {
  return (
    <Collapsible.Root open={open} className={styles.root}>
      <Collapsible.Content className={cx(styles.collapse, className)}>{children}</Collapsible.Content>
    </Collapsible.Root>
  )
}
