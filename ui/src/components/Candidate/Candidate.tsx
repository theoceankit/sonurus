import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { Avatar, avatarOf, type LabelledSpeaker } from '../Avatar/Avatar'
import { Badge } from '../Badge/Badge'
import { Icon } from '../Icon/Icon'
import type { IconName } from '../Icon/icon-names'
import styles from './Candidate.module.css'

type Common = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  // Where the arrow keys have got to, as hover looks.
  active?: boolean
}

export type CandidateProps = Common & (
  // badge tells apart speakers with the same name; handle, under the name, says who
  // exactly; time is how long they talk, after usage.
  | { kind?: 'speaker'; speaker: LabelledSpeaker; handle?: string | null; score?: number; suggested?: boolean; usage?: string; time?: string; badge?: string; selected?: boolean; children?: never; icon?: never }
  | { kind: 'add'; children: ReactNode; icon?: IconName; speaker?: never; handle?: never; score?: never; suggested?: never; usage?: never; time?: never; badge?: never; selected?: never }
)

const percent = (score: number) => `${Math.round(score * 100)}%`

// One answer to who this is: the card lists a few of them, the search all.
export function Candidate({ kind = 'speaker', speaker, handle, score, suggested, usage, time, badge, selected, active, icon = 'add', children, type = 'button', className, ...props }: CandidateProps) {
  const classes = cx(styles.candidate, selected && styles.selected, active && styles.active, className)
  if (kind === 'add') {
    return (
      <button type={type} className={classes} {...props}>
        <span className={styles.plus}><Icon name={icon} size={16} /></span>
        <span className={styles.addLabel}>{children}</span>
      </button>
    )
  }
  return (
    <button type={type} className={classes} {...props}>
      <Avatar {...avatarOf(speaker!)} size="small" />
      {handle ? (
        <span className={styles.who}>
          <span className={styles.nameLine}>
            <span className={cx(styles.name, selected && styles.strong)}>{speaker!.name}</span>
            {badge && <Badge className={styles.badge}>{badge}</Badge>}
          </span>
          <span className={styles.handle}>@{handle}</span>
        </span>
      ) : (
        <>
          <span className={cx(styles.name, selected && styles.strong)}>{speaker!.name}</span>
          {badge && <Badge className={styles.badge}>{badge}</Badge>}
        </>
      )}
      {suggested && <span role="img" aria-label="Suggested" className={styles.mark}><Icon name="sparkle" size={14} /></span>}
      {score !== undefined && <span className={cx(styles.meta, suggested && styles.mark)}>{percent(score)}</span>}
      {usage && <span className={styles.meta}>{usage}</span>}
      {time && <span className={cx(styles.meta, styles.time)}>{time}</span>}
    </button>
  )
}
