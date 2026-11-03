import { act, render, screen, waitFor } from '@testing-library/react'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { useQueueEventsSync } from '../../api/queries'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { createPlayback } from '../../media/playback'
import { OverlayProvider } from '../../OverlayProvider'
import { EditorPlayer, playerTurns, useTranscriptPlayback } from './EditorPlayer'

afterEach(() => vi.unstubAllGlobals())

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
