import { useState } from 'react'
import { cx } from '../../styles/cx'
import { ClipPlayer } from '../ClipPlayer/ClipPlayer'
import { Reveal } from '../Reveal/Reveal'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import styles from './VoiceClip.module.css'

export interface VoiceClipProps {
  duration: string
  // What is said in the clip, folded under the player. Empty: no button for it.
  text: string
  playing?: boolean
  progress: number
  // Nothing to play: the audio is gone or not there yet.
  disabled?: boolean
  // The levels of the clip's audio.
  heights?: readonly number[] | null
  onToggle?: () => void
  // For a story.
  initialTextExpanded?: boolean
  className?: string
}

// A voice to hear before choosing, with its words under it: the Review card of the
// inspector and a speaker's card show it alike.
export function VoiceClip({ duration, text, playing, progress, disabled, heights, onToggle, initialTextExpanded = false, className }: VoiceClipProps) {
  const [expanded, setExpanded] = useState(initialTextExpanded)
  const [box, setBox] = useState<HTMLElement | null>(null)
  const hasText = text.trim() !== ''
  return (
    <div className={cx(styles.voiceClip, className)}>
      <ClipPlayer
        playing={playing}
        progress={progress}
        duration={duration}
        disabled={disabled}
        heights={heights}
        onToggle={onToggle}
        textExpanded={expanded}
        onToggleText={hasText ? () => setExpanded(open => !open) : undefined}
      />
      {hasText && (
        <Reveal open={expanded} className={styles.textBox}>
          <div className={styles.textWrap}>
            <p ref={setBox} className={styles.text}>{text}</p>
            <ScrollBar area={box} />
          </div>
        </Reveal>
      )}
    </div>
  )
}
