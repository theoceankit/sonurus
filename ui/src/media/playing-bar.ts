import { useEffect, useRef } from 'react'
import { prefersReducedMotion } from '../presence'
import type { Playback } from './playback'

export interface SegmentTiming {
  playback: Playback
  start: number
  end: number
}

// The audio tells the time about four times a second, too seldom to draw from, so
// the bar runs by itself and is corrected when it has drifted this far.
const DRIFT_MS = 250

export const barShare = (currentTime: number, start: number, end: number) =>
  end > start ? Math.min(1, Math.max(0, (currentTime - start) / (end - start))) : 1

const fill = (share: number) => `scaleY(${share})`

// Fills the element top to bottom along the segment playing, at the speed of the
// playback and on the compositor. Only the one row playing has this running.
export function usePlayingBar<T extends HTMLElement>(timing?: SegmentTiming) {
  const ref = useRef<T>(null)
  const { playback, start, end } = timing ?? {}

  useEffect(() => {
    const element = ref.current
    if (!element || !playback || start === undefined || end === undefined) return undefined
    if (prefersReducedMotion()) return undefined

    const duration = (end - start) * 1000
    const shareNow = () => barShare(playback.getState().currentTime, start, end)
    if (!element.animate || duration <= 0) {
      const draw = () => { element.style.transform = fill(shareNow()) }
      draw()
      return playback.subscribe(draw)
    }

    const animation = element.animate([{ transform: fill(0) }, { transform: fill(1) }], { duration, easing: 'linear', fill: 'both' })
    const sync = () => {
      const { currentTime, paused, rate } = playback.getState()
      const target = (currentTime - start) * 1000
      if (animation.playbackRate !== rate) animation.playbackRate = rate
      if (paused) animation.pause()
      else if (animation.playState !== 'running' && target < duration) animation.play()
      if (paused || Math.abs(Number(animation.currentTime) - target) > DRIFT_MS) animation.currentTime = target
    }
    sync()
    const unsubscribe = playback.subscribe(sync)
    return () => {
      unsubscribe()
      animation.cancel()
    }
  }, [playback, start, end])

  return ref
}
