import { act, render, screen, waitFor } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { createPlayback } from '../../media/playback'
import { OverlayProvider } from '../../OverlayProvider'
import { EditorPlayer, playerTurns, useTranscriptPlayback } from './EditorPlayer'

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

test('metadata not there yet: disabled until the audio is ready', async () => {
  const track = setup(WEEKLY_SYNC_ID)
  await waitFor(() => expect((track.firstElementChild!.children[0] as HTMLElement).style.background).toContain('speaker-'))
  expect((screen.getByRole('button', { name: 'Play' }) as HTMLButtonElement).disabled).toBe(true)
})
