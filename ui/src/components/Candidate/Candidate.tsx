import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { Avatar, avatarOf, type LabelledSpeaker } from '../Avatar/Avatar'
import { Icon } from '../Icon/Icon'
import styles from './Candidate.module.css'

type Common = Omit<ComponentPropsWithRef<'button'>, 'children'> & {
  // Where the arrow keys have got to, as hover looks.
  active?: boolean
}

export type CandidateProps = Common & (
  | { kind?: 'speaker'; speaker: LabelledSpeaker; score?: number; suggested?: boolean; usage?: string; selected?: boolean; children?: never }
  | { kind: 'add'; children: ReactNode; speaker?: never; score?: never; suggested?: never; usage?: never; selected?: never }
)

const percent = (score: number) => `${Math.round(score * 100)}%`

// One answer to who this is: the card lists a few of them, the search all.
export function Candidate({ kind = 'speaker', speaker, score, suggested, usage, selected, active, children, type = 'button', className, ...props }: CandidateProps) {
  const classes = cx(styles.candidate, selected && styles.selected, active && styles.active, className)
  if (kind === 'add') {
    return (
      <button type={type} className={classes} {...props}>
        <span className={styles.plus}><Icon name="add" size={16} /></span>
        <span className={styles.addLabel}>{children}</span>
      </button>
    )
  }
  return (
    <button type={type} className={classes} {...props}>
      <Avatar {...avatarOf(speaker!)} size="small" />
      <span className={cx(styles.name, selected && styles.strong)}>{speaker!.name}</span>
      {suggested && <span role="img" aria-label="Suggested" className={styles.mark}><Icon name="sparkle" size={14} /></span>}
      {score !== undefined && <span className={cx(styles.meta, suggested && styles.mark)}>{percent(score)}</span>}
      {usage && <span className={styles.meta}>{usage}</span>}
    </button>
  )
}
