import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Badge } from '../Badge/Badge'
import styles from './Tab.module.css'

interface TabProps extends Omit<ComponentPropsWithRef<typeof RadixTabs.Trigger>, 'asChild'> {
  // A counter next to the label, shown also for 0.
  count?: number
}

// One section tab; lives inside Tabs, where Radix handles selection and keys.
export function Tab({ count, children, className, ...props }: TabProps) {
  return (
    <RadixTabs.Trigger className={cx(styles.tab, className)} {...props}>
      <span className={styles.content}>
        {children}
        {count !== undefined && <Badge variant="count">{count}</Badge>}
      </span>
      <span className={styles.indicator} />
    </RadixTabs.Trigger>
  )
}
