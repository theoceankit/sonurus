import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import type { Turn } from '../../media/timeline'
import { OverlayProvider } from '../../OverlayProvider'
import { Player, type PlayerProps } from './Player'
import playerSource from './Player.tsx?raw'
import volumeSource from './VolumeControl.tsx?raw'

const turn = (start: number, end: number, speaker: string, color: Turn['color'] = 1): Turn => ({ start, end, speaker, name: speaker, color })
const TURNS = [turn(0, 20, 'Anna', 5), turn(25, 40, 'Mark', 1), turn(40, 100, 'Lena', 4)]
const STATE = { currentTime: 30, duration: 100, paused: true, rate: 1, volume: 1 }

function setup(props: Partial<PlayerProps> = {}) {
  const handlers = { onToggle: vi.fn(), onSeek: vi.fn(), onRateChange: vi.fn(), onVolumeChange: vi.fn() }
  const { container } = render(<OverlayProvider><Player state={STATE} turns={TURNS} {...handlers} {...props} /></OverlayProvider>)
  const track = screen.getByRole('slider', { name: 'Position' })
  // jsdom lays nothing out: a waveform 1000 wide starting at 0.
  track.getBoundingClientRect = () => ({ left: 0, width: 1000 }) as DOMRect
  return { ...handlers, track, container }
}

const button = (name: string) => screen.getByRole('button', { name })

test('shows the time and the time left', () => {
  setup()
  expect(screen.getByText('00:30')).toBeTruthy()
  expect(screen.getByText('01:10')).toBeTruthy()
})

test('the slider still tells the whole length', () => {
  const { track } = setup()
  expect(track.getAttribute('aria-valuetext')).toBe('00:30 of 01:40')
})

test('a recording of an hour or more keeps the hours in the time left', () => {
  setup({ state: { ...STATE, currentTime: 7326, duration: 10925 } })
  expect(screen.getByText('0:59:59')).toBeTruthy()
})

test('a duration not known yet shows 00:00', () => {
  setup({ state: { ...STATE, currentTime: 0, duration: NaN }, turns: [] })
  expect(screen.getAllByText('00:00')).toHaveLength(2)
})

// A live recording in WebM has no length in the file: duration is Infinity.
test('audio that does not know its length counts the time left to the end of the last turn', () => {
  setup({ state: { ...STATE, duration: Infinity } })
  expect(screen.getByText('01:10')).toBeTruthy()
})

test('audio that goes on after the last turn keeps the playhead on the waveform', () => {
  const { container } = setup({ state: { ...STATE, currentTime: 130, duration: Infinity } })
  expect(container.innerHTML).not.toContain('130%')
})

test('audio that goes on after the last turn leaves 00:00, not less', () => {
  setup({ state: { ...STATE, currentTime: 130, duration: Infinity } })
  expect(screen.getByText('00:00')).toBeTruthy()
})

test('a notice shows over the waveform', () => {
  setup({ disabled: true, notice: 'Audio file not found' })
  expect(screen.getByText('Audio file not found')).toBeTruthy()
})

test('the middle button says what it does and toggles', async () => {
  const { onToggle } = setup()
  await userEvent.click(button('Play'))
  expect(onToggle).toHaveBeenCalled()
})

test('a playing player offers pause', () => {
  setup({ state: { ...STATE, paused: false } })
  expect(button('Pause')).toBeTruthy()
})

test('rewind and forward go 15 seconds and stop at the ends', async () => {
  const { onSeek } = setup()
  await userEvent.click(button('Rewind 15 seconds'))
  expect(onSeek).toHaveBeenLastCalledWith(15)
  await userEvent.click(button('Forward 15 seconds'))
  expect(onSeek).toHaveBeenLastCalledWith(45)
})

test('rewind at the start stays at the start', async () => {
  const { onSeek } = setup({ state: { ...STATE, currentTime: 5 } })
  await userEvent.click(button('Rewind 15 seconds'))
  expect(onSeek).toHaveBeenLastCalledWith(0)
})

test('speaker buttons go to the neighbouring blocks', async () => {
  const { onSeek } = setup()
  await userEvent.click(button('Previous speaker'))
  expect(onSeek).toHaveBeenLastCalledWith(0)
  await userEvent.click(button('Next speaker'))
  expect(onSeek).toHaveBeenLastCalledWith(40)
})

test('speaker buttons do nothing at the edges', async () => {
  const { onSeek } = setup({ state: { ...STATE, currentTime: 90 } })
  await userEvent.click(button('Next speaker'))
  expect(onSeek).not.toHaveBeenCalled()
})

test('the list of speeds opens centred over its button', () => {
  expect(playerSource).toMatch(/side="top"\s+align="center"/)
  expect(playerSource).toMatch(/offset=\{POPUP_OFFSET\}/)
  expect(volumeSource).toMatch(/sideOffset=\{POPUP_OFFSET\}/)
})

test('the speed is chosen from a list that marks the current one', async () => {
  setup({ state: { ...STATE, rate: 1.5 } })
  await userEvent.click(button('Playback speed 1.5×'))
  const options = screen.getAllByRole('menuitemradio')
  expect(options.map(option => option.textContent!.trim())).toEqual(['0.5×', '1×', '1.2×', '1.5×', '2×'])
  expect(options.map(option => option.getAttribute('aria-checked'))).toEqual(['false', 'false', 'false', 'true', 'false'])
})

test.each([[1, 0.5], [1, 1.2], [1.2, 2], [2, 1]])('at speed %d choosing %d', async (rate, next) => {
  const { onRateChange } = setup({ state: { ...STATE, rate } })
  await userEvent.click(button(`Playback speed ${rate}×`))
  await userEvent.click(screen.getByRole('menuitemradio', { name: `${next}×` }))
  expect(onRateChange).toHaveBeenCalledWith(next)
})

test('pressing the waveform seeks, and dragging keeps seeking', () => {
  const { track, onSeek } = setup()
  fireEvent.pointerDown(track, { button: 0, clientX: 250, pointerId: 1 })
  expect(onSeek).toHaveBeenLastCalledWith(25)
  fireEvent.pointerMove(track, { clientX: 500, pointerId: 1 })
  expect(onSeek).toHaveBeenLastCalledWith(50)
  fireEvent.pointerUp(track, { pointerId: 1 })
  fireEvent.pointerMove(track, { clientX: 700, pointerId: 1 })
  expect(onSeek).toHaveBeenCalledTimes(2)
})

test('dragging past the ends stops at the ends', () => {
  const { track, onSeek } = setup()
  fireEvent.pointerDown(track, { button: 0, clientX: -50, pointerId: 1 })
  expect(onSeek).toHaveBeenLastCalledWith(0)
  fireEvent.pointerMove(track, { clientX: 5000, pointerId: 1 })
  expect(onSeek).toHaveBeenLastCalledWith(100)
})

test('hovering shows the time and the speaker under the cursor, without seeking', () => {
  const { track, onSeek } = setup()
  fireEvent.pointerMove(track, { clientX: 300 })
  expect(screen.getByText('Mark')).toBeTruthy()
  expect(onSeek).not.toHaveBeenCalled()
  fireEvent.pointerLeave(track)
  expect(screen.queryByText('Mark')).toBeNull()
})

test('hovering a pause shows only the time', () => {
  const { track } = setup()
  fireEvent.pointerMove(track, { clientX: 220 })
  expect(screen.getByText('00:22')).toBeTruthy()
  expect(screen.queryByText('Anna')).toBeNull()
})

test('arrow keys move by 5 seconds, Home and End to the ends', () => {
  const { track, onSeek } = setup()
  for (const [key, to] of [['ArrowLeft', 25], ['ArrowDown', 25], ['ArrowRight', 35], ['ArrowUp', 35], ['Home', 0], ['End', 100]] as const) {
    fireEvent.keyDown(track, { key })
    expect(onSeek).toHaveBeenLastCalledWith(to)
  }
})

test('the waveform reads as a slider with the time in words', () => {
  const { track } = setup()
  expect(track.getAttribute('aria-valuenow')).toBe('30')
  expect(track.getAttribute('aria-valuemax')).toBe('100')
  expect(track.getAttribute('aria-valuetext')).toBe('00:30 of 01:40')
})

test('the volume opens a slider, and zero dims the button', async () => {
  const { onVolumeChange } = setup({ state: { ...STATE, volume: 0.5 } })
  await userEvent.click(button('Volume'))
  const level = await screen.findByRole('slider', { name: 'Volume level' })
  fireEvent.keyDown(level, { key: 'ArrowUp' })
  expect(onVolumeChange).toHaveBeenCalledWith(0.52)
})

test('disabled: no control acts and no playhead is drawn', () => {
  const { track, onSeek, container } = setup({ disabled: true })
  for (const name of ['Previous speaker', 'Rewind 15 seconds', 'Play', 'Forward 15 seconds', 'Next speaker', 'Volume']) {
    expect((button(name) as HTMLButtonElement).disabled).toBe(true)
  }
  expect((button('Playback speed 1×') as HTMLButtonElement).disabled).toBe(true)
  expect(track.getAttribute('tabindex')).toBeNull()
  fireEvent.pointerDown(track, { button: 0, clientX: 250, pointerId: 1 })
  fireEvent.pointerMove(track, { clientX: 300 })
  fireEvent.keyDown(track, { key: 'Home' })
  expect(onSeek).not.toHaveBeenCalled()
  expect(screen.queryByText('Mark')).toBeNull()
  expect(container.querySelectorAll('[class*="playhead"]')).toHaveLength(0)
})

test('disabled: the bars keep their colours from the segments', () => {
  const { track } = setup({ disabled: true, state: { ...STATE, duration: NaN } })
  const bars = [...track.firstElementChild!.children] as HTMLElement[]
  expect(bars[0].style.background).toContain('speaker-5')
})

test('a highlighted speaker colours only their bars, the rest are pauses', () => {
  const { track } = setup({ highlightedSpeaker: 'Mark' })
  const bars = ([...track.firstElementChild!.children] as HTMLElement[]).map(bar => bar.style.background)
  expect(bars[0]).toBe('var(--color-border-default)')
  expect(bars[36]).toBe('var(--color-speaker-1-mid)')
  expect(bars.at(-1)).toBe('var(--color-border-default)')
  expect(new Set(bars)).toEqual(new Set(['var(--color-border-default)', 'var(--color-speaker-1-mid)']))
})

test('disabled: a highlighted speaker still shows', () => {
  const { track } = setup({ disabled: true, highlightedSpeaker: 'Anna' })
  const bars = [...track.firstElementChild!.children] as HTMLElement[]
  expect(bars[0].style.background).toBe('var(--color-speaker-5-mid)')
  expect(bars.at(-1)!.style.background).toBe('var(--color-border-default)')
})

const heights = (track: HTMLElement) => [...track.firstElementChild!.children].map(bar => (bar as HTMLElement).style.height)

test('the waveform takes the heights it is given, and is flat without them', () => {
  const levels = Array.from({ length: 120 }, (_, i) => (i % 4) / 4)
  const { track } = setup({ heights: levels })
  expect(heights(track)).toEqual(levels.map(level => `${level * 100}%`))
})

test('flat until the heights come', () => {
  const { track } = setup()
  expect(new Set(heights(track)).size).toBe(1)
})

test('a highlighted speaker changes the colours, not the heights', () => {
  const levels = Array.from({ length: 120 }, (_, i) => (i % 3) / 3)
  const { track } = setup({ heights: levels, highlightedSpeaker: 'Mark' })
  expect(heights(track)).toEqual(levels.map(level => `${level * 100}%`))
})
