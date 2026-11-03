import { useRef, type ComponentPropsWithRef, type ReactNode } from 'react'
import { markNotImplemented } from '../../not-implemented'
import { cx } from '../../styles/cx'
import { Button } from '../Button/Button'
import { Reveal } from '../Reveal/Reveal'
import { IconButton } from '../IconButton/IconButton'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
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
  const { area, scrollRef, bottom } = useScrollEdges()
  // What the dock showed last, for its way out after the review has moved on.
  const last = useRef<{ counter?: string; card?: ReactNode; left?: number; onResume?: () => void }>({})
  if (review.mode === 'on') last.current = { ...last.current, counter: review.counter, card: review.card }
  if (review.mode === 'collapsed') last.current = { ...last.current, left: review.left, onResume: review.onResume }
  const shown = last.current
  return (
    <div className={cx(styles.inspector, className)} {...props}>
      <Tabs
        defaultValue="speakers"
        aria-label="Inspector tabs"
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
          <div className={styles.scrollArea}>
            <div ref={scrollRef} className={styles.scroll}>{children}</div>
            <ScrollBar area={area} />
            {bottom && <ScrollFade edge="bottom" />}
          </div>
          {(shown.card !== undefined || shown.left !== undefined) && (
            <Reveal open={review.mode !== 'off'} travel="long" className={styles.dockBox}>
              <section aria-label={TITLE} className={styles.dock}>
                <Reveal open={review.mode === 'on'} travel="long" className={styles.dockPart}>
                  <div className={styles.dockBody}>
                    <div className={styles.dockHead}>
                      <span className={styles.title}>{TITLE}</span>
                      <span className={styles.counter}>{shown.counter}</span>
                    </div>
                    {shown.card}
                  </div>
                </Reveal>
                <Reveal open={review.mode === 'collapsed'} travel="long" className={styles.dockPart}>
                  <div className={styles.dockRow}>
                    <span className={styles.title}>{TITLE}</span>
                    <span className={styles.counter}>{shown.left} left</span>
                    <span className={styles.spacer} />
                    <Button variant="secondary" size="small" onClick={shown.onResume}>Resume</Button>
                  </div>
                </Reveal>
              </section>
            </Reveal>
          )}
        </TabPanel>
      </Tabs>
    </div>
  )
}
