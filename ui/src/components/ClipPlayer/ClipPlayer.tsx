import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import { Waveform } from '../Waveform/Waveform'
import styles from './ClipPlayer.module.css'

type ClipPlayerProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  playing?: boolean
  // How much has played, from 0 to 1.
  progress: number
  // 0:04
  duration: string
  // Nothing to play: the audio is gone or not ready.
  disabled?: boolean
  // The levels of the clip's audio, flat until they are there.
  heights?: readonly number[] | null
  onToggle?: () => void
  // With no onToggleText there is no button for the text.
  textExpanded?: boolean
  onToggleText?: () => void
}

export function ClipPlayer({ playing, progress, duration, disabled, heights, onToggle, textExpanded, onToggleText, className, ...props }: ClipPlayerProps) {
  return (
    <div className={cx(styles.clipPlayer, className)} {...props}>
      <button type="button" className={styles.play} aria-label={playing ? 'Pause clip' : 'Play clip'} disabled={disabled} onClick={onToggle}>
        <Icon name={playing ? 'pause' : 'play'} size={12} />
      </button>
      <Waveform size="small" progress={progress} heights={heights ?? undefined} className={styles.waveform} />
      <span className={styles.duration}>{duration}</span>
      {onToggleText && (
        <IconButton
          size="xs"
          icon="chevron-down"
          label={textExpanded ? 'Hide text' : 'Show text'}
          aria-expanded={Boolean(textExpanded)}
          className={cx(textExpanded && styles.up)}
          onClick={onToggleText}
        />
      )}
    </div>
  )
}
