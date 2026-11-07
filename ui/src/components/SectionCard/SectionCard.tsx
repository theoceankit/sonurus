import { useId, type ComponentPropsWithRef, type ReactNode } from 'react'
import { cx } from '../../styles/cx'
import styles from './SectionCard.module.css'

interface SectionCardProps extends Omit<ComponentPropsWithRef<'section'>, 'title'> {
  title?: string
  description?: ReactNode
  // Next to the title: a status badge or a small button.
  action?: ReactNode
  // Under the rows, set apart: where something is kept, what it needs.
  footer?: ReactNode
  children?: ReactNode
}

// A card of settings that belong together; FieldRow and ModelRow rows are divided by lines.
export function SectionCard({ title, description, action, footer, children, className, ...props }: SectionCardProps) {
  const titleId = useId()
  return (
    <section aria-labelledby={title ? titleId : undefined} className={cx(styles.card, className)} {...props}>
      {(title || action) && (
        <header className={styles.header}>
          <div className={styles.heading}>
            {title && <h3 id={titleId} className={styles.title}>{title}</h3>}
            {description && <p className={styles.description}>{description}</p>}
          </div>
          {action}
        </header>
      )}
      {children && <div className={styles.rows}>{children}</div>}
      {footer && <div className={styles.footer}>{footer}</div>}
    </section>
  )
}
