import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './MetaItem.module.css'

interface MetaItemProps extends ComponentPropsWithRef<'span'> {
  icon: IconName
}

export function MetaItem({ icon, children, className, ...props }: MetaItemProps) {
  return (
    <span className={cx(styles.metaItem, className)} {...props}>
      <Icon name={icon} />
      {children}
    </span>
  )
}
