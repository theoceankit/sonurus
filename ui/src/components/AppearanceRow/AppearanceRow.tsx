import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { IconButton } from '../IconButton/IconButton'
import { Tooltip } from '../Tooltip/Tooltip'
import styles from './AppearanceRow.module.css'

type AppearanceRowProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  title: string
  // 4 Oct 2026
  date: string
  // Opens the recording.
  onOpen: () => void
  onPlay: () => void
  playing?: boolean
  // The recording's file is gone: Play stays off and says why.
  audioMissing?: boolean
}

// A recording a speaker talks in. Play stands where the date is, on hover and focus.
export function AppearanceRow({ title, date, onOpen, onPlay, playing, audioMissing, className, ...props }: AppearanceRowProps) {
  const play = (
    <IconButton
      size="xs"
      icon={playing ? 'pause' : 'play-outline'}
      label={audioMissing ? 'Audio unavailable' : `${playing ? 'Pause' : 'Play'} a sample from ${title}`}
      disabled={audioMissing}
      onClick={onPlay}
    />
  )
  return (
    <div className={cx(styles.appearanceRow, playing && styles.playing, className)} {...props}>
      <button type="button" className={styles.main} onClick={onOpen}>
        <span className={styles.title}>{title}</span>
        <span className={styles.meta}>{date}</span>
      </button>
      <span className={styles.actions}>
        {audioMissing
          // A disabled button gets no pointer events: the tooltip hangs on a wrapper.
          ? <Tooltip text="Audio unavailable"><span className={styles.blocked} tabIndex={0} aria-label={`${title}: audio unavailable`}>{play}</span></Tooltip>
          : play}
      </span>
    </div>
  )
}
