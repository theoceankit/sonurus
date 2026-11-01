import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import styles from './SectionHeader.module.css'

type SectionHeaderProps = Omit<ComponentPropsWithRef<'div'>, 'title' | 'children'> & { title: string } & (
  // The trailing slot holds a short text or a Ghost Small IconButton, never both.
  | { meta?: string; action?: never }
  | { meta?: never; action?: ReactNode }
)

export function SectionHeader({ title, meta, action, className, ...props }: SectionHeaderProps) {
  return (
    <div className={cx(styles.sectionHeader, className)} {...props}>
      <span className={styles.title}>{title}</span>
      {meta !== undefined && <span>{meta}</span>}
      {action}
    </div>
  )
}
