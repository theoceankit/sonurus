import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import styles from './Tabs.module.css'

interface TabsProps extends Omit<ComponentPropsWithRef<typeof RadixTabs.Root>, 'asChild' | 'orientation'> {
  // Tab elements. Name the row with aria-label.
  tabs: ReactNode
  'aria-label'?: string
  // TabPanel elements.
  children?: ReactNode
}

// A row of section tabs. Arrow keys move between them and select as they go.
export function Tabs({ tabs, 'aria-label': label, children, ...props }: TabsProps) {
  return (
    <RadixTabs.Root {...props}>
      <RadixTabs.List className={styles.list} aria-label={label}>{tabs}</RadixTabs.List>
      {children}
    </RadixTabs.Root>
  )
}

export const TabPanel = RadixTabs.Content
