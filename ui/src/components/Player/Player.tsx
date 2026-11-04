import { useMemo, useRef, useState, type KeyboardEvent, type PointerEvent } from 'react'
import {
  barTurns, formatClock, nextSpeakerTime, playerClock, previousSpeakerTime, remainingClock, skipTime, speakerBars, timelineDuration, turnAt, type Turn,
} from '../../media/timeline'
import { Button } from '../Button/Button'
import { IconButton, type IconButtonProps } from '../IconButton/IconButton'
import { Inline } from '../Inline/Inline'
import { Menu, MenuOption, MenuOptions } from '../Menu/Menu'
import { Playhead } from '../Playhead/Playhead'
import { Tooltip, TooltipGroup } from '../Tooltip/Tooltip'
import { BAR_COUNT as BAR_COUNTS } from '../Waveform/bars'
import { Waveform } from '../Waveform/Waveform'
import { POPUP_OFFSET, VolumeControl } from './VolumeControl'
import styles from './Player.module.css'

export const PLAYER_SPEEDS = [0.5, 1, 1.2, 1.5, 2]

const SKIP_SECONDS = 15
const KEY_SECONDS = 5
export const BAR_COUNT = BAR_COUNTS.large

export interface PlayerState {
  currentTime: number
  duration: number
  paused: boolean
  rate: number
  volume: number
}

export interface PlayerProps {
  state: PlayerState
  turns: readonly Turn[]
  disabled?: boolean
  // A line over the waveform, such as why there is nothing to play.
  notice?: string
  onToggle?: () => void
  onSeek?: (seconds: number) => void
  onRateChange?: (rate: number) => void
  onVolumeChange?: (volume: number) => void
  // The speaker of a row or bar of talk time under the pointer elsewhere: only
  // their bars keep a colour.
  highlightedSpeaker?: string | null
  // The levels of the audio, one per bar over the length of the waveform. Flat
  // until they are there.
  heights?: readonly number[] | null
  // For a story: the cursor over the waveform at this time, pressed or not.
  initialCursor?: { at: number; dragging?: boolean }
}

function ControlButton({ label, ...props }: IconButtonProps) {
  return <Tooltip text={label}><IconButton label={label} {...props} /></Tooltip>
}

export function Player({
  state, turns, disabled, notice, onToggle, onSeek, onRateChange, onVolumeChange, highlightedSpeaker, heights, initialCursor,
}: PlayerProps) {
  const { currentTime, rate, volume } = state
  const { elapsed, playing } = playerClock(state)
  const duration = timelineDuration(state.duration, turns)
  const total = formatClock(duration)
  const remaining = remainingClock(currentTime, duration)
  const track = useRef<HTMLDivElement>(null)
  const [cursor, setCursor] = useState<number | null>(initialCursor?.at ?? null)
  const [dragging, setDragging] = useState(initialCursor?.dragging ?? false)

  const bars = useMemo(() => barTurns(turns, BAR_COUNT, duration).map(turn => turn?.color ?? null), [turns, duration])
  const ownBars = useMemo(
    () => (highlightedSpeaker ? speakerBars(turns, highlightedSpeaker, BAR_COUNT, duration) : null),
    [turns, highlightedSpeaker, duration],
  )

  const timeAt = (event: PointerEvent) => {
    const { left, width } = track.current!.getBoundingClientRect()
    return (width ? Math.max(0, Math.min(1, (event.clientX - left) / width)) : 0) * duration
  }
  const seek = (seconds: number | null) => {
    if (seconds !== null) onSeek?.(seconds)
  }

  const handlePointerDown = (event: PointerEvent<HTMLDivElement>) => {
    if (disabled || event.button !== 0) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    const at = timeAt(event)
    setDragging(true)
    setCursor(at)
    seek(at)
  }
  const handlePointerMove = (event: PointerEvent) => {
    if (disabled) return
    const at = timeAt(event)
    setCursor(at)
    if (dragging) seek(at)
  }
  const handleKeyDown = (event: KeyboardEvent) => {
    const target = {
      ArrowLeft: skipTime(currentTime, -KEY_SECONDS, duration),
      ArrowDown: skipTime(currentTime, -KEY_SECONDS, duration),
      ArrowRight: skipTime(currentTime, KEY_SECONDS, duration),
      ArrowUp: skipTime(currentTime, KEY_SECONDS, duration),
      Home: 0,
      End: duration,
    }[event.key]
    if (disabled || target === undefined) return
    event.preventDefault()
    seek(target)
  }

  const share = (seconds: number) => (duration > 0 ? Math.min(1, seconds / duration) : 0)
  const hovered = cursor === null || disabled ? null : turnAt(turns, cursor)

  return (
    <Inline gap={4} paddingX={4} className={styles.player}>
      <TooltipGroup>
        <Inline gap={2} className={styles.fixed}>
          <ControlButton
            icon="skip-back"
            label="Previous speaker"
            disabled={disabled}
            onClick={() => seek(previousSpeakerTime(turns, currentTime))}
          />
          <ControlButton
            icon="rewind"
            label="Rewind 15 seconds"
            disabled={disabled}
            onClick={() => seek(skipTime(currentTime, -SKIP_SECONDS, duration))}
          />
          <ControlButton
            variant="inverse"
            size="large"
            icon={playing ? 'pause' : 'play'}
            label={playing ? 'Pause' : 'Play'}
            disabled={disabled}
            onClick={onToggle}
          />
          <ControlButton
            icon="forward"
            label="Forward 15 seconds"
            disabled={disabled}
            onClick={() => seek(skipTime(currentTime, SKIP_SECONDS, duration))}
          />
          <ControlButton
            icon="skip-forward"
            label="Next speaker"
            disabled={disabled}
            onClick={() => seek(nextSpeakerTime(turns, currentTime))}
          />
        </Inline>
      </TooltipGroup>
      <span className={disabled ? styles.currentDisabled : styles.current}>{elapsed}</span>
      <div className={styles.area}>
        <div
          ref={track}
          className={disabled ? styles.trackDisabled : styles.track}
          role="slider"
          tabIndex={disabled ? undefined : 0}
          aria-label="Position"
          aria-disabled={disabled}
          aria-valuemin={0}
          aria-valuemax={duration}
          aria-valuenow={currentTime}
          aria-valuetext={`${elapsed} of ${total}`}
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={() => setDragging(false)}
          onPointerCancel={() => setDragging(false)}
          onPointerLeave={() => { if (!dragging) setCursor(null) }}
          onKeyDown={handleKeyDown}
        >
          <Waveform
            progress={share(currentTime)}
            bars={bars}
            highlight={hovered && [share(hovered.start), share(hovered.end)]}
            speakerBars={ownBars}
            heights={heights ?? undefined}
          />
          {!disabled && !dragging && <Playhead position={share(currentTime)} />}
          {!disabled && cursor !== null && (
            <Playhead look="hover" position={share(cursor)} time={formatClock(cursor)} name={hovered?.name} />
          )}
        </div>
        {notice && <span className={styles.notice}>{notice}</span>}
      </div>
      <span className={disabled ? styles.remainingDisabled : styles.remaining}>{remaining}</span>
      <TooltipGroup>
        <Inline gap={4}>
          <Menu
            side="top"
            align="center"
            offset={POPUP_OFFSET}
            size="narrow"
            trigger={(
              <Tooltip text="Playback speed">
                <Button size="small" className={styles.speed} aria-label={`Playback speed ${rate}×`} disabled={disabled}>{`${rate}×`}</Button>
              </Tooltip>
            )}
          >
            <MenuOptions value={String(rate)} onValueChange={next => onRateChange?.(Number(next))}>
              {PLAYER_SPEEDS.map(speed => <MenuOption key={speed} value={String(speed)}>{`${speed}×`}</MenuOption>)}
            </MenuOptions>
          </Menu>
          <VolumeControl volume={volume} disabled={disabled} onChange={next => onVolumeChange?.(next)} />
        </Inline>
      </TooltipGroup>
    </Inline>
  )
}
