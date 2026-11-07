import { useLayoutEffect, useState, type ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import { Icon } from '../Icon/Icon'
import { IconButton } from '../IconButton/IconButton'
import { Waveform } from '../Waveform/Waveform'
import { flatHeights, smallBarCount } from '../Waveform/bars'
import styles from './ClipPlayer.module.css'

type ClipPlayerProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  playing?: boolean
  // How much has played, from 0 to 1.
  progress: number
  // 0:04
  duration: string
  // Nothing to play: the audio is gone or not ready.
  disabled?: boolean
  // The levels of the clip's audio, flat until they are there. The bars stay as wide
  // as the token whatever their number; onBarCount says how many fit.
  heights?: readonly number[] | null
  onToggle?: () => void
  // With no onToggleText there is no button for the text.
  textExpanded?: boolean
  onToggleText?: () => void
  // How many bars the waveform has room for, to ask for the levels of that many.
  onBarCount?: (count: number) => void
}

// The bars that fit the waveform, measured before paint and again on resize.
function useBarCount(waveform: HTMLElement | null, onBarCount?: (count: number) => void) {
  const [count, setCount] = useState(() => smallBarCount(0, 0, 0))
  useLayoutEffect(() => {
    if (!waveform) return
    const measure = () => {
      const style = getComputedStyle(waveform)
      const bar = parseFloat(style.getPropertyValue('--size-waveform-bar-small'))
      setCount(smallBarCount(waveform.clientWidth, bar, parseFloat(style.columnGap) || 0))
    }
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(waveform)
    return () => resized.disconnect()
  }, [waveform])
  useLayoutEffect(() => { onBarCount?.(count) }, [count, onBarCount])
  return count
}

export function ClipPlayer({ playing, progress, duration, disabled, heights, onToggle, textExpanded, onToggleText, onBarCount, className, ...props }: ClipPlayerProps) {
  const [waveform, setWaveform] = useState<HTMLDivElement | null>(null)
  const count = useBarCount(waveform, onBarCount)
  return (
    <div className={cx(styles.clipPlayer, className)} {...props}>
      <button type="button" className={styles.play} aria-label={playing ? 'Pause clip' : 'Play clip'} disabled={disabled} onClick={onToggle}>
        <Icon name={playing ? 'pause' : 'play'} size={12} />
      </button>
      <Waveform ref={setWaveform} size="small" progress={progress} heights={heights ?? flatHeights(count)} className={styles.waveform} />
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
