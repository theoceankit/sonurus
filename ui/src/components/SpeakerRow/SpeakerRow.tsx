import type { ComponentPropsWithRef, ReactNode } from 'react'
import { cx } from '../../styles/cx'
import { Avatar, avatarOf, type LabelledSpeaker } from '../Avatar/Avatar'
import { Icon } from '../Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import styles from './SpeakerRow.module.css'

type Common = Omit<ComponentPropsWithRef<'div'>, 'children' | 'onSelect'> & {
  // Looks hovered, for a speaker under the pointer elsewhere, with no buttons. Once
  // passed, a speaker row looks hovered and shows its buttons under the pointer only
  // while it is highlighted, so the highlight may wait for the pointer to stay.
  highlighted?: boolean
}

type SpeakerProps = Common & {
  kind?: 'speaker'
  speaker: LabelledSpeaker
  time: string
  selected?: boolean
  // A row that opens something; otherwise it only shows.
  onSelect?: () => void
  // Each makes a button in place of the time on hover and focus.
  onPlay?: () => void
  playing?: boolean
  playDisabled?: boolean
  onAssign?: () => void
}

type ShowMoreProps = Common & {
  kind: 'show-more'
  count: number
  expanded?: boolean
  onToggle: () => void
  // The speakers it hides.
  stack?: ReactNode
}

export type SpeakerRowProps = SpeakerProps | ShowMoreProps

export function SpeakerRow(props: SpeakerRowProps) {
  if (props.kind === 'show-more') {
    const { kind: _, count, expanded, onToggle, stack, highlighted, className, ...rest } = props
    return (
      <div className={cx(styles.speakerRow, className)} data-highlighted={highlighted ? '' : undefined} {...rest}>
        <button type="button" className={styles.main} aria-expanded={Boolean(expanded)} onClick={onToggle}>
          <span className={styles.leading}>
            <Icon name="chevron-down" size={12} className={cx(styles.chevron, expanded && styles.up)} />
          </span>
          <span className={styles.more}>{expanded ? 'Show less' : `Show ${count} more`}</span>
          {!expanded && stack}
        </button>
      </div>
    )
  }

  const { kind: _, speaker, time, selected, onSelect, onPlay, playing, playDisabled, onAssign, highlighted, className, ...rest } = props
  const content = (
    <>
      <span className={styles.leading}><Avatar {...avatarOf(speaker)} size="small" /></span>
      <span className={cx(styles.name, selected && styles.selectedName)}>{speaker.name}</span>
      <span className={styles.time}>{time}</span>
    </>
  )
  const hasActions = Boolean(onPlay || onAssign)
  return (
    <div className={cx(styles.speakerRow, selected && styles.selected, hasActions && styles.hasActions, highlighted !== undefined && styles.followsHighlight, className)} data-highlighted={highlighted ? '' : undefined} {...rest}>
      {onSelect
        ? <button type="button" className={styles.main} aria-current={selected ? 'true' : undefined} onClick={onSelect}>{content}</button>
        : <div className={styles.main}>{content}</div>}
      {hasActions && (
        <span className={styles.actions}>
          {onPlay && (
            <IconButton
              size="xs"
              icon={playing ? 'pause' : 'play-outline'}
              label={`${playing ? 'Pause' : 'Play'} ${speaker.name}`}
              disabled={playDisabled}
              onClick={onPlay}
            />
          )}
          {onAssign && <IconButton size="xs" icon="change-speaker" label={`Assign ${speaker.name}`} onClick={onAssign} />}
        </span>
      )}
    </div>
  )
}
