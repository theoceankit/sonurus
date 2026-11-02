import type { ComponentPropsWithRef, ReactNode } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { cx } from '../../styles/cx'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Tab } from '../Tab/Tab'
import { TabPanel, Tabs } from '../Tabs/Tabs'
import styles from './Inspector.module.css'

export type InspectorReview =
  | { mode: 'off' }
  | { mode: 'on'; counter: string; card: ReactNode }
  | { mode: 'collapsed'; left: number; onResume?: () => void }

type InspectorProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  // Talk time and the speakers; this part scrolls.
  children?: ReactNode
  review?: InspectorReview
  onClose?: () => void
}

const TITLE = 'Review speakers'

// The right panel: its tabs, and the review docked at the bottom.
export function Inspector({ children, review = { mode: 'off' }, onClose, className, ...props }: InspectorProps) {
  return (
    <div className={cx(styles.inspector, className)} {...props}>
      <Tabs
        defaultValue="speakers"
        aria-label="Inspector"
        className={styles.tabs}
        tabs={(
          <>
            <Tab value="speakers">Speakers</Tab>
            <Tab value="chapters" {...markNotImplemented('inspector.chapters')}>Chapters</Tab>
            <Tab value="notes" {...markNotImplemented('inspector.notes')}>Notes</Tab>
          </>
        )}
      >
        <IconButton icon="inspector" size="small" label="Close inspector" className={styles.close} onClick={onClose} />
        <TabPanel value="speakers" className={styles.panel}>
          <div className={styles.scroll}>{children}</div>
          {review.mode === 'on' && (
            <section aria-label={TITLE} className={styles.dock}>
              <div className={styles.dockHead}>
                <span className={styles.title}>{TITLE}</span>
                <span className={styles.counter}>{review.counter}</span>
              </div>
              {review.card}
            </section>
          )}
          {review.mode === 'collapsed' && (
            <section aria-label={TITLE} className={cx(styles.dock, styles.dockCollapsed)}>
              <span className={styles.title}>{TITLE}</span>
              <span className={styles.counter}>{review.left} left</span>
              <span className={styles.spacer} />
              <Button variant="secondary" size="small" onClick={review.onResume}>Resume</Button>
            </section>
          )}
        </TabPanel>
      </Tabs>
    </div>
  )
}
