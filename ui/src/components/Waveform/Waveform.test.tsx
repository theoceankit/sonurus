import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Waveform, type WaveformBar } from './Waveform'

const bars = (container: HTMLElement) => [...container.firstElementChild!.children] as HTMLElement[]
const colors = (container: HTMLElement) => bars(container).map(bar => bar.style.background)

test('large has 120 bars and small 26, as on the board', () => {
  expect(bars(render(<Waveform progress={0} />).container)).toHaveLength(120)
  expect(bars(render(<Waveform size="small" progress={0} />).container)).toHaveLength(26)
})

test('large: played bars are the middle tone of the speaker, the rest the light one', () => {
  const speakers: WaveformBar[] = [1, 1, 5, 5]
  const { container } = render(<Waveform progress={0.5} bars={speakers} heights={[1, 1, 1, 1]} />)
  expect(colors(container)).toEqual([
    'var(--color-speaker-1-mid)', 'var(--color-speaker-1-mid)', 'var(--color-speaker-5-bg)', 'var(--color-speaker-5-bg)',
  ])
})

test('large: a pause looks the same played or not', () => {
  const { container } = render(<Waveform progress={0.5} bars={[null, null]} heights={[1, 1]} />)
  expect(colors(container)).toEqual(['var(--color-border-default)', 'var(--color-border-default)'])
})

test('large: a highlight lights up its bars as played', () => {
  const { container } = render(<Waveform progress={0} bars={[2, 2, 2, 2]} heights={[1, 1, 1, 1]} highlight={[0.5, 1]} />)
  expect(colors(container)).toEqual([
    'var(--color-speaker-2-bg)', 'var(--color-speaker-2-bg)', 'var(--color-speaker-2-mid)', 'var(--color-speaker-2-mid)',
  ])
})

test('small: played bars are primary text, the rest gray, whatever the speakers', () => {
  const { container } = render(<Waveform size="small" progress={0.5} heights={[1, 1]} />)
  expect(colors(container)).toEqual(['var(--color-text-primary)', 'var(--color-speaker-6-mid)'])
})

test('with no heights the bars are flat and low: nothing is known of the audio yet', () => {
  for (const size of ['large', 'small'] as const) {
    const heights = bars(render(<Waveform size={size} progress={0} />).container).map(bar => bar.style.height)
    expect(new Set(heights).size).toBe(1)
    expect(parseFloat(heights[0])).toBeLessThan(50)
  }
})

test('a bar is as high as its share', () => {
  const { container } = render(<Waveform progress={0} heights={[0.5]} />)
  expect(bars(container)[0].style.height).toBe('50%')
})

test('large: the bars of one speaker are their middle tone and the rest pauses, whatever has played', () => {
  const { container } = render(<Waveform progress={0.5} bars={[1, 1, 5, 5]} speakerBars={[null, 1, 5, null]} heights={[1, 1, 1, 1]} />)
  expect(colors(container)).toEqual([
    'var(--color-border-default)', 'var(--color-speaker-1-mid)', 'var(--color-speaker-5-mid)', 'var(--color-border-default)',
  ])
})
