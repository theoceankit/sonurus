import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import styles from './Tabs.module.css'

interface TabsProps extends Omit<ComponentPropsWithRef<typeof RadixTabs.Root>, 'asChild' | 'orientation'> {
  // Tab elements in a row, or NavTab elements in a column. Name the list with aria-label.
  tabs: ReactNode
  // Vertical: a column of NavTab at the side, its panels next to it; up and down move.
  orientation?: 'horizontal' | 'vertical'
  // Over the column: a search of the sections.
  header?: ReactNode
  // Under the column, apart from the tabs: a footnote such as the version.
  footer?: ReactNode
  'aria-label'?: string
  // TabPanel elements.
  children?: ReactNode
}

// Section tabs. Arrow keys move between them and select as they go.
export function Tabs({ tabs, 'aria-label': label, orientation = 'horizontal', header, footer, children, className, ...props }: TabsProps) {
  const list = <RadixTabs.List className={cx(styles.list, styles[orientation])} aria-label={label}>{tabs}</RadixTabs.List>
  return (
    <RadixTabs.Root orientation={orientation} className={cx(orientation === 'vertical' && styles.columns, className)} {...props}>
      {orientation === 'vertical'
        ? <div className={styles.side}><div className={styles.top}>{header}{list}</div>{footer}</div>
        : list}
      {children}
    </RadixTabs.Root>
  )
}

export const TabPanel = RadixTabs.Content
