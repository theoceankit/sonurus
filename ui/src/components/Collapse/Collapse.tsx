import * as Collapsible from '@radix-ui/react-collapsible'
import type { ReactNode } from 'react'
import styles from './Collapse.module.css'

interface CollapseProps {
  open: boolean
  children: ReactNode
}

// Content that opens in place and pushes down what is under it. The control that
// opens it is somewhere else; with the control next to it, there is Disclosure.
export function Collapse({ open, children }: CollapseProps) {
  return (
    <Collapsible.Root open={open} className={styles.root}>
      <Collapsible.Content className={styles.collapse}>{children}</Collapsible.Content>
    </Collapsible.Root>
  )
}
