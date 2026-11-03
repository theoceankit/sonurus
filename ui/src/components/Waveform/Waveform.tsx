import type { ComponentPropsWithRef } from 'react'
import { cx } from '../../styles/cx'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { WAVEFORM_HEIGHTS } from './bars'
import styles from './Waveform.module.css'

export type WaveformSize = 'small' | 'large'

// A bar's speaker colour, or null for a pause.
export type WaveformBar = SpeakerColor | null

type WaveformProps = Omit<ComponentPropsWithRef<'div'>, 'children'> & {
  size?: WaveformSize
  // How much has played, from 0 to 1.
  progress: number
  // Large only, one per bar. Without them all bars are pauses.
  bars?: readonly WaveformBar[]
  // Large only: the part of the audio to light up as played, from 0 to 1.
  highlight?: readonly [from: number, to: number] | null
  // Large only: the bars of one speaker, as speakerBars() gives them. These are in
  // the speaker's middle tone and the rest look like pauses, whatever has played.
  speakerBars?: readonly WaveformBar[] | null
  // One per bar, from 0 to 1 of the height. Defaults to the decorative ones.
  heights?: readonly number[]
}

function largeColor(bar: WaveformBar | undefined, played: boolean) {
  if (!bar) return 'var(--color-border-default)'
  return `var(--color-speaker-${bar}-${played ? 'mid' : 'bg'})`
}

export function Waveform({ size = 'large', progress, bars, highlight, speakerBars, heights, className, ...props }: WaveformProps) {
  const shown = heights ?? WAVEFORM_HEIGHTS[size]
  return (
    <div className={cx(styles.waveform, styles[size], className)} aria-hidden {...props}>
      {shown.map((height, i) => {
        const middle = (i + 0.5) / shown.length
        const played = middle <= progress
        const lit = played || (!!highlight && middle >= highlight[0] && middle < highlight[1])
        const background = size === 'large'
          ? speakerBars ? largeColor(speakerBars[i], true) : largeColor(bars?.[i], lit)
          : `var(--color-${played ? 'text-primary' : 'speaker-6-mid'})`
        return <span key={i} className={styles.bar} style={{ height: `${height * 100}%`, background }} />
      })}
    </div>
  )
}
