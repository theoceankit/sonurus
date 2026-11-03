import { act, render } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import type { Playback, PlaybackState } from './playback'
import { barShare, usePlayingBar, type SegmentTiming } from './playing-bar'

function fakePlayback(initial: Partial<PlaybackState>) {
  let state = { currentTime: 0, duration: 100, paused: false, rate: 1, volume: 1, status: 'ready', ...initial } as PlaybackState
  const listeners = new Set<() => void>()
  return {
    getState: () => state,
    subscribe: (listener: () => void) => {
      listeners.add(listener)
      return () => { listeners.delete(listener) }
    },
    change(next: Partial<PlaybackState>) {
      state = { ...state, ...next }
      listeners.forEach(listener => listener())
    },
  } as unknown as Playback & { change: (next: Partial<PlaybackState>) => void }
}

function fakeAnimation() {
  return { currentTime: 0, playbackRate: 1, playState: 'running', play: vi.fn(), pause: vi.fn(), cancel: vi.fn() }
}

function Bar({ timing }: { timing?: SegmentTiming }) {
  const ref = usePlayingBar<HTMLSpanElement>(timing)
  return <span ref={ref} data-testid="bar" />
}

afterEach(() => {
  vi.unstubAllGlobals()
  delete (Element.prototype as Partial<Element>).animate
})

function setup(state: Partial<PlaybackState>) {
  const animation = fakeAnimation()
  const animate = vi.fn(() => animation)
  Element.prototype.animate = animate as unknown as Element['animate']
  const playback = fakePlayback(state)
  const view = render(<Bar timing={{ playback, start: 10, end: 14 }} />)
  return { animation, animate, playback, view }
}

test('the share of the segment stays between nothing and all of it', () => {
  expect(barShare(12, 10, 14)).toBe(0.5)
  expect(barShare(5, 10, 14)).toBe(0)
  expect(barShare(20, 10, 14)).toBe(1)
  expect(barShare(10, 10, 10)).toBe(1)
})

test('runs along the segment, from where the time is', () => {
  const { animate, animation } = setup({ currentTime: 12 })
  expect(animate).toHaveBeenCalledWith(expect.anything(), expect.objectContaining({ duration: 4000, easing: 'linear', fill: 'both' }))
  expect(animation.currentTime).toBe(2000)
})

test('a tick close to where it is does not touch it', () => {
  const { animation, playback } = setup({ currentTime: 10 })
  animation.currentTime = 200
  act(() => playback.change({ currentTime: 10.1 }))
  expect(animation.currentTime).toBe(200)
})

test('a seek moves it', () => {
  const { animation, playback } = setup({ currentTime: 10 })
  act(() => playback.change({ currentTime: 13 }))
  expect(animation.currentTime).toBe(3000)
})

test('stands on a pause, exactly at the time, and goes on after it', () => {
  const { animation, playback } = setup({ currentTime: 10 })
  animation.currentTime = 100
  act(() => playback.change({ currentTime: 10.2, paused: true }))
  expect(animation.pause).toHaveBeenCalled()
  expect(animation.currentTime).toBeCloseTo(200)
  animation.playState = 'paused'
  act(() => playback.change({ paused: false }))
  expect(animation.play).toHaveBeenCalled()
})

test('does not start over once it has reached the end', () => {
  const { animation, playback } = setup({ currentTime: 14 })
  animation.playState = 'finished'
  act(() => playback.change({ currentTime: 14.1 }))
  expect(animation.play).not.toHaveBeenCalled()
})

test('follows the speed', () => {
  const { animation, playback } = setup({ currentTime: 10 })
  act(() => playback.change({ rate: 2 }))
  expect(animation.playbackRate).toBe(2)
})

test('goes away with the row', () => {
  const { animation, view, playback } = setup({ currentTime: 10 })
  view.unmount()
  expect(animation.cancel).toHaveBeenCalled()
  act(() => playback.change({ currentTime: 13 }))
  expect(animation.currentTime).toBe(0)
})

test('with reduced motion it stands whole', () => {
  vi.stubGlobal('matchMedia', () => ({ matches: true }))
  const { animate, view } = setup({ currentTime: 12 })
  expect(animate).not.toHaveBeenCalled()
  expect(view.getByTestId('bar').style.transform).toBe('')
})

test('without Web Animations it draws what the time says', () => {
  const playback = fakePlayback({ currentTime: 12 })
  const view = render(<Bar timing={{ playback, start: 10, end: 14 }} />)
  expect(view.getByTestId('bar').style.transform).toBe('scaleY(0.5)')
  act(() => playback.change({ currentTime: 13 }))
  expect(view.getByTestId('bar').style.transform).toBe('scaleY(0.75)')
})
