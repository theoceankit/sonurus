import { act, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { useQueueEventsSync } from '../../api/queries'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { holdOpenModal } from '../../components/Modal/open-modals'
import { createPlayback, type Playback, type PlaybackState } from '../../media/playback'
import { OverlayProvider } from '../../OverlayProvider'
import { EditorPlayer, playerTurns, useTranscriptPlayback } from './EditorPlayer'

afterEach(() => {
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

const segment = (start: number, end: number, changes: Partial<Segment>) => ({
  start, end, text: '', speaker_raw: 'SPEAKER_00', speaker_resolved: null, speaker_final: null, unassigned: false, ...changes,
}) as Segment
const speaker = (id: string, name: string | null, color_index: number) => ({ id, name, color_index }) as Speaker

test('turns: a named speaker takes its colour and name', () => {
  const [turn] = playerTurns([segment(0, 1, { speaker_resolved: 'a' })], [speaker('a', 'Anna', 4)])
  expect(turn).toEqual({ start: 0, end: 1, speaker: 'a', name: 'Anna', color: 5 })
})

test('turns: speakers with no name and Unassigned are gray', () => {
  const turns = playerTurns(
    [segment(0, 1, { speaker_resolved: 'a' }), segment(1, 2, { speaker_resolved: 'gone' }), segment(2, 3, { unassigned: true })],
    [speaker('a', null, 2)],
  )
  expect(turns.map(({ name, color }) => [name, color])).toEqual([
    ['Unknown speaker', 6], ['Unknown speaker', 6], ['Unassigned', 6],
  ])
  expect(turns[2].speaker).toBe(UNASSIGNED)
})

test('turns: the correction wins, as everywhere', () => {
  const [turn] = playerTurns([segment(0, 1, { speaker_resolved: 'a', speaker_final: 'b' })], [speaker('b', 'Bea', 0), speaker('a', 'Anna', 4)])
  expect(turn.name).toBe('Bea')
})

function Wired({ transcriptId }: { transcriptId: number | null }) {
  return <EditorPlayer transcriptId={transcriptId} playback={useTranscriptPlayback(transcriptId)} />
}

const setup = (transcriptId: number | null, options: FixtureOptions = {}) => {
  const client = createFixtureClient(options)
  render(<ApiProvider client={client}><OverlayProvider><Wired transcriptId={transcriptId} /></OverlayProvider></ApiProvider>)
  return screen.getByRole('slider', { name: 'Position' })
}

test('no recording open: disabled', () => {
  setup(null)
  expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
})

test('nothing to play: disabled, and the bars come from the segments', async () => {
  const track = setup(WEEKLY_SYNC_ID, { noAudio: true })
  expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
  await waitFor(() => expect((track.firstElementChild!.children[0] as HTMLElement).style.background).toContain('speaker-'))
})

test('a recording with nothing to play says so', async () => {
  setup(WEEKLY_SYNC_ID, { noAudio: true })
  expect(await screen.findByText('Audio file not found')).toBeTruthy()
})

test('no recording open: nothing is missing', () => {
  setup(null, { noAudio: true })
  expect(screen.queryByText('Audio file not found')).toBeNull()
})

test('audio that fails to load says so: the file is gone', async () => {
  const audio = new Audio()
  const playback = createPlayback(audio)
  render(<ApiProvider client={createFixtureClient()}><OverlayProvider><EditorPlayer transcriptId={WEEKLY_SYNC_ID} playback={playback} /></OverlayProvider></ApiProvider>)
  playback.load('blob:gone')
  expect(screen.queryByText('Audio file not found')).toBeNull()
  act(() => { audio.dispatchEvent(new Event('error')) })
  expect(await screen.findByText('Audio file not found')).toBeTruthy()
})

test('while the backend is away a failed load is not called missing, and it loads again when back', async () => {
  const made: HTMLAudioElement[] = []
  const RealAudio = Audio
  vi.stubGlobal('Audio', function FakeAudio() {
    const audio = new RealAudio()
    made.push(audio)
    return audio
  })
  const client = createFixtureClient()
  function Synced() {
    useQueueEventsSync()
    return <Wired transcriptId={WEEKLY_SYNC_ID} />
  }
  render(<ApiProvider client={client}><OverlayProvider><Synced /></OverlayProvider></ApiProvider>)
  await waitFor(() => expect(made[0].src).not.toBe(''))
  const load = vi.spyOn(made[0], 'load')
  act(() => client.setConnected(false))
  act(() => { made[0].dispatchEvent(new Event('error')) })
  await waitFor(() => expect(made[0].getAttribute('src')).toBeTruthy())
  expect(screen.queryByText('Audio file not found')).toBeNull()
  act(() => client.setConnected(true))
  await waitFor(() => expect(load).toHaveBeenCalled())
})

test('metadata not there yet: disabled until the audio is ready', async () => {
  const track = setup(WEEKLY_SYNC_ID)
  await waitFor(() => expect((track.firstElementChild!.children[0] as HTMLElement).style.background).toContain('speaker-'))
  expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
})

const heightsOf = (track: HTMLElement) => [...track.firstElementChild!.children].map(bar => (bar as HTMLElement).style.height)

test('the waveform is flat, then takes the levels of the whole length of the recording', async () => {
  const getWaveform = vi.fn(async (_id: number, { bars }: { bars: number }) => Array.from({ length: bars }, (_, i) => (i % 2) / 2))
  const track = setup(WEEKLY_SYNC_ID, { overrides: { getWaveform } })
  expect(new Set(heightsOf(track)).size).toBe(1)
  await waitFor(() => expect(heightsOf(track)[1]).toBe('50%'))
  const transcript = await createFixtureClient().getTranscript(WEEKLY_SYNC_ID)
  expect(getWaveform).toHaveBeenCalledWith(WEEKLY_SYNC_ID, { bars: 120, start: 0, end: transcript.segments.at(-1)!.end })
})

test('levels that fail to come leave the waveform flat', async () => {
  const getWaveform = vi.fn(() => Promise.reject(new Error('ffmpeg')))
  const track = setup(WEEKLY_SYNC_ID, { overrides: { getWaveform } })
  await waitFor(() => expect(getWaveform).toHaveBeenCalled())
  await waitFor(() => expect((track.firstElementChild!.children[0] as HTMLElement).style.background).toContain('speaker-'))
  expect(new Set(heightsOf(track)).size).toBe(1)
})

// A playback that is ready and only counts what it is asked to do.
const readyPlayback = (status: PlaybackState['status'] = 'ready') => {
  const state: PlaybackState = { currentTime: 30, duration: 120, paused: true, rate: 1, volume: 1, status }
  return {
    getState: () => state,
    subscribe: () => () => {},
    load: vi.fn(), reload: vi.fn(), toggle: vi.fn(), seek: vi.fn(), setRate: vi.fn(), setVolume: vi.fn(),
  } satisfies Playback
}

const renderWith = (playback: Playback) => render(
  <ApiProvider client={createFixtureClient()}><OverlayProvider><EditorPlayer transcriptId={WEEKLY_SYNC_ID} playback={playback} /></OverlayProvider></ApiProvider>,
)

const pressSpace = (target: EventTarget = document.body, changes: KeyboardEventInit = {}) => {
  const event = new KeyboardEvent('keydown', { key: ' ', code: 'Space', bubbles: true, cancelable: true, ...changes })
  target.dispatchEvent(event)
  return event
}

test('space plays and pauses the open recording, and does not scroll', () => {
  const playback = readyPlayback()
  renderWith(playback)
  const event = pressSpace()
  expect(playback.toggle).toHaveBeenCalledTimes(1)
  expect(event.defaultPrevented).toBe(true)
})

test('a held space plays or pauses once', () => {
  const playback = readyPlayback()
  renderWith(playback)
  pressSpace()
  const repeat = pressSpace(document.body, { repeat: true })
  expect(playback.toggle).toHaveBeenCalledTimes(1)
  expect(repeat.defaultPrevented).toBe(true)
})

test('space does nothing until the audio is ready', () => {
  for (const status of ['empty', 'loading', 'error'] as const) {
    const playback = readyPlayback(status)
    const { unmount } = renderWith(playback)
    const event = pressSpace()
    expect(playback.toggle, status).not.toHaveBeenCalled()
    expect(event.defaultPrevented, status).toBe(false)
    unmount()
  }
})

test('space does nothing while a modal window is open', () => {
  const playback = readyPlayback()
  renderWith(playback)
  const release = holdOpenModal()
  try {
    expect(pressSpace().defaultPrevented).toBe(false)
    expect(playback.toggle).not.toHaveBeenCalled()
  } finally {
    release()
  }
})

test('the player gone, space is no longer heard', () => {
  const playback = readyPlayback()
  const { unmount } = renderWith(playback)
  unmount()
  expect(pressSpace().defaultPrevented).toBe(false)
  expect(playback.toggle).not.toHaveBeenCalled()
})

test('a button left in focus by a click is not pressed again by the space', () => {
  const playback = readyPlayback()
  renderWith(playback)
  const rewind = screen.getByRole('button', { name: 'Rewind 15 seconds' })
  fireEvent.pointerDown(rewind)
  rewind.focus()
  const event = pressSpace(rewind)
  expect(playback.toggle).toHaveBeenCalledTimes(1)
  expect(event.defaultPrevented).toBe(true)
  // Stopped on the way down, so the button and Radix never hear it.
  const heard = vi.fn()
  rewind.addEventListener('keydown', heard)
  pressSpace(rewind)
  expect(heard).not.toHaveBeenCalled()
})

// Chromium presses a focused button on the keyup of Space even when the keydown
// was cancelled, so the keyup of a Space that played or paused is cancelled too.
test('a button reached from the keyboard is pressed by the space as before', () => {
  const playback = readyPlayback()
  renderWith(playback)
  const rewind = screen.getByRole('button', { name: 'Rewind 15 seconds' })
  fireEvent.pointerDown(document.body)
  fireEvent.keyDown(document.body, { key: 'Tab' })
  rewind.focus()
  expect(pressSpace(rewind).defaultPrevented).toBe(false)
  expect(playback.toggle).not.toHaveBeenCalled()
})

test('a button clicked once it had the focus from the keyboard counts as clicked', () => {
  const playback = readyPlayback()
  renderWith(playback)
  const rewind = screen.getByRole('button', { name: 'Rewind 15 seconds' })
  fireEvent.keyDown(document.body, { key: 'Tab' })
  rewind.focus()
  fireEvent.pointerDown(rewind)
  expect(pressSpace(rewind).defaultPrevented).toBe(true)
  expect(playback.toggle).toHaveBeenCalledTimes(1)
})

test('the keyup of a space that played or paused is cancelled, and only that one', () => {
  const playback = readyPlayback()
  renderWith(playback)
  const keyup = (changes: KeyboardEventInit = {}) => {
    const event = new KeyboardEvent('keyup', { key: ' ', code: 'Space', bubbles: true, cancelable: true, ...changes })
    document.body.dispatchEvent(event)
    return event
  }
  pressSpace()
  expect(keyup().defaultPrevented).toBe(true)
  expect(keyup().defaultPrevented).toBe(false)
  const release = holdOpenModal()
  try {
    pressSpace()
    expect(keyup().defaultPrevented).toBe(false)
  } finally {
    release()
  }
})
