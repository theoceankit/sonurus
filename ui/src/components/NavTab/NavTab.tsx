import * as RadixTabs from '@radix-ui/react-tabs'
import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './NavTab.module.css'

interface NavTabProps extends Omit<ComponentPropsWithRef<typeof RadixTabs.Trigger>, 'asChild'> {
  icon: IconName
}

// One section in the column of a vertical Tabs, as a row of the sidebar looks.
export function NavTab({ icon, children, className, ...props }: NavTabProps) {
  return (
    <RadixTabs.Trigger className={cx(styles.navTab, className)} {...props}>
      <Icon name={icon} />
      <span className={styles.label}>{children}</span>
    </RadixTabs.Trigger>
  )
}
