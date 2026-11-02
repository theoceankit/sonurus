import { render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { ApiError } from '../../api/client'
import { DESIGN_REVIEW_ID, SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast'
import type { Playback, PlaybackState } from '../../media/playback'
import { OverlayProvider } from '../../OverlayProvider'
import { InspectorPanel, type InspectorPanelProps } from './InspectorPanel'
import { SpeakerDialogs, type SpeakerRequest } from './SpeakerDialogs'
import { effectiveSpeaker } from '../../api/types'

afterEach(dismissAllToasts)

const { unknown1, oliver } = SPEAKER_IDS

const standing: Playback = (() => {
  const state: PlaybackState = { currentTime: 0, duration: 53, paused: true, rate: 1, volume: 1, status: 'ready' }
  return { getState: () => state, subscribe: () => () => {}, load() {}, toggle() {}, seek() {}, setRate() {}, setVolume() {} }
})()

function Host({ id, panel }: { id: number | null; panel: Partial<InspectorPanelProps> }) {
  const [request, setRequest] = useState<SpeakerRequest | null>(null)
  return (
    <>
      <InspectorPanel transcriptId={id} playback={standing} onChooseSpeaker={setRequest} {...panel} />
      {request && <SpeakerDialogs request={request} onClose={() => setRequest(null)} />}
    </>
  )
}

function setup(id: number | null = DESIGN_REVIEW_ID, options: FixtureOptions = {}, panel: object = {}) {
  const client = createFixtureClient(options)
  const onClose = vi.fn()
  const view = render(
    <ApiProvider client={client}>
      <OverlayProvider>
        <Host id={id} panel={{ onClose, ...panel }} />
      </OverlayProvider>
    </ApiProvider>,
  )
  return { client, onClose, ...view }
}

const counter = (text: string) => screen.findByText(text)
const button = (name: string | RegExp) => screen.getByRole('button', { name })
const card = () => screen.getByRole('region', { name: /^Who is/ })

describe('speakers', () => {
  test('talk time and the rows of the board', async () => {
    setup(WEEKLY_SYNC_ID)
    expect(await screen.findByText('Talk time')).toBeTruthy()
    expect(screen.getByText('0:53')).toBeTruthy()
    expect(screen.getByText('Anna Petrova')).toBeTruthy()
    expect(screen.getByText('0:19')).toBeTruthy()
  })

  test('while reviewing: three rows and Show more, then all and Show less', async () => {
    setup(WEEKLY_SYNC_ID)
    const more = await screen.findByRole('button', { name: /Show 3 more/ })
    expect(screen.queryByText('Sofia Ramos')).toBeNull()
    await userEvent.click(more)
    expect(screen.getByRole('button', { name: 'Show less' })).toBeTruthy()
    expect(screen.getByText('Sofia Ramos')).toBeTruthy()
  })

  test('review over: everyone shows', async () => {
    setup(WEEKLY_SYNC_ID, { board: 'reviewDone' })
    expect(await screen.findByText('Lena Kovacs')).toBeTruthy()
    expect(screen.queryByRole('button', { name: /Show \d more/ })).toBeNull()
    expect(screen.queryByText('Review speakers')).toBeNull()
  })

  test('unassigned: last, with only assign', async () => {
    setup(WEEKLY_SYNC_ID, { board: 'unassigned' })
    expect(await screen.findByRole('button', { name: 'Assign Unassigned' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Play Unassigned' })).toBeNull()
    expect(screen.queryByText('Review speakers')).toBeNull()
  })

  test('assign on a row opens Choose speaker and moves all its segments', async () => {
    const { client } = setup(WEEKLY_SYNC_ID, { board: 'unassigned' })
    await userEvent.click(await screen.findByRole('button', { name: 'Assign Unassigned' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('option', { name: /Kate Nguyen/ }))
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText('Assigned to Kate Nguyen')).toBeTruthy()
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(segments.filter(s => s.start === 16).map(s => s.unassigned)).toEqual([false])
  })
})

describe('panel states', () => {
  test('no recording: the tabs only', () => {
    setup(null)
    expect(screen.getByRole('tab', { name: 'Speakers' })).toBeTruthy()
    expect(screen.queryByText('Talk time')).toBeNull()
  })

  test('loading: the tabs only', () => {
    setup(WEEKLY_SYNC_ID, { scenario: 'loading' })
    expect(screen.getByRole('tab', { name: 'Speakers' })).toBeTruthy()
    expect(screen.queryByText('Talk time')).toBeNull()
  })

  test('failed: says so and retries', async () => {
    const listSpeakers = vi.fn(() => Promise.reject(new ApiError(500, 'Server error 500')))
    setup(WEEKLY_SYNC_ID, { overrides: { listSpeakers } })
    await userEvent.click(await screen.findByRole('button', { name: 'Retry' }, { timeout: 3000 }))
    await waitFor(() => expect(listSpeakers.mock.calls.length).toBeGreaterThan(1))
  })

  test('a recording with no segments says so', async () => {
    const client = createFixtureClient()
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    for (const { start } of segments) await client.deleteSegment(WEEKLY_SYNC_ID, start)
    render(<ApiProvider client={client}><OverlayProvider><InspectorPanel transcriptId={WEEKLY_SYNC_ID} playback={standing} /></OverlayProvider></ApiProvider>)
    expect(await screen.findByText('No speakers')).toBeTruthy()
  })

  test('the close button closes the panel', async () => {
    const { onClose } = setup(WEEKLY_SYNC_ID)
    await screen.findByText('Talk time')
    await userEvent.click(button('Close inspector'))
    expect(onClose).toHaveBeenCalledOnce()
  })
})

describe('review', () => {
  test('opens on the first speaker with no name', async () => {
    setup()
    expect(await counter('1 of 4')).toBeTruthy()
    expect(within(card()).getByText('Unknown speaker 1')).toBeTruthy()
  })

  test('in the app only speakers with no name count', async () => {
    setup(WEEKLY_SYNC_ID)
    expect(await counter('1 of 1')).toBeTruthy()
  })

  test('with possible matches as on the board', async () => {
    setup(WEEKLY_SYNC_ID, {}, { possibleMatches: true })
    expect(await counter('1 of 4')).toBeTruthy()
  })

  test('a possible match is preselected and says so', async () => {
    setup(WEEKLY_SYNC_ID, {}, { possibleMatches: true, initialSpeakerId: oliver })
    expect(await counter('3 of 4')).toBeTruthy()
    expect(within(card()).getByText('Possible match')).toBeTruthy()
    expect(within(card()).getByRole('button', { name: /^OG Oliver Grant/ }).getAttribute('aria-pressed')).toBe('true')
    expect(within(card()).getByText('Let me check the numbers and get back to you by Friday.')).toBeTruthy()
  })

  test('confirming a possible match moves on, and it does not come back', async () => {
    setup(WEEKLY_SYNC_ID, {}, { possibleMatches: true, initialSpeakerId: oliver })
    await counter('3 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    expect(await counter('4 of 4')).toBeTruthy()
  })

  test('Assign waits for a choice, and a second click takes it back', async () => {
    setup()
    await counter('1 of 4')
    const assign = () => within(card()).getByRole('button', { name: 'Assign' }) as HTMLButtonElement
    expect(assign().disabled).toBe(true)
    const sofia = within(card()).getByRole('button', { name: /Sofia Ramos/ })
    await userEvent.click(sofia)
    expect(assign().disabled).toBe(false)
    await userEvent.click(sofia)
    expect(assign().disabled).toBe(true)
  })

  test('Assign moves all the segments, tells, and goes on', async () => {
    const { client } = setup()
    await counter('1 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: /Sofia Ramos/ }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText('Assigned to Sofia Ramos')).toBeTruthy()
    expect(await counter('2 of 4')).toBeTruthy()
    const { segments } = await client.getTranscript(DESIGN_REVIEW_ID)
    expect(segments.filter(s => effectiveSpeaker(s) === SPEAKER_IDS.sofia).map(s => s.start)).toEqual([6, 57])
  })

  test('Undo gives the segments back and shows that speaker again', async () => {
    const { client } = setup()
    await counter('1 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: /Sofia Ramos/ }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    await counter('2 of 4')
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await counter('1 of 4')).toBeTruthy()
    const { segments } = await client.getTranscript(DESIGN_REVIEW_ID)
    expect(segments.filter(s => effectiveSpeaker(s) === SPEAKER_IDS.unknown2).map(s => s.start)).toEqual([6, 57])
    expect(within(card()).getByRole('button', { name: /Sofia Ramos/ })).toBeTruthy()
  })

  test('Undo after the last assignment brings the review back', async () => {
    setup(WEEKLY_SYNC_ID)
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: /Mark Ellis/ }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    await waitFor(() => expect(screen.queryByText('Review speakers')).toBeNull())
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await counter('1 of 1')).toBeTruthy()
  })

  test('a failed undo says so', async () => {
    setup(WEEKLY_SYNC_ID, { overrides: { undoSpeakerAssignment: () => Promise.reject(new ApiError(501, 'No')) } })
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: /Mark Ellis/ }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    await userEvent.click(await screen.findByRole('button', { name: 'Undo' }))
    expect(await screen.findByText('Failed to undo: No')).toBeTruthy()
  })

  test('a failed assignment says so and stays', async () => {
    setup(WEEKLY_SYNC_ID, { overrides: { assignSpeaker: () => Promise.reject(new ApiError(500, 'No')) } })
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: /Mark Ellis/ }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText('Failed to assign the speaker: No')).toBeTruthy()
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })

  test('Skip goes around', async () => {
    setup()
    await counter('1 of 4')
    for (const text of ['2 of 4', '3 of 4', '4 of 4', '1 of 4']) {
      await userEvent.click(within(card()).getByRole('button', { name: 'Skip' }))
      expect(await counter(text)).toBeTruthy()
    }
  })

  test('Close collapses, Resume opens on the next', async () => {
    setup()
    await counter('1 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: 'Close review' }))
    expect(await screen.findByText('4 left')).toBeTruthy()
    expect(screen.queryByRole('region', { name: /^Who is/ })).toBeNull()
    await userEvent.click(button('Resume'))
    expect(await counter('2 of 4')).toBeTruthy()
  })

  test('a click on a speaker with no name opens the card on them, also from collapsed', async () => {
    setup()
    await counter('1 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: 'Close review' }))
    await userEvent.click(await screen.findByText('Unknown speaker 2'))
    expect(await counter('2 of 4')).toBeTruthy()
    expect(within(card()).getByText('Unknown speaker 2')).toBeTruthy()
  })

  test('a named speaker opens nothing', async () => {
    setup()
    await counter('1 of 4')
    await screen.findByText('Lena Kovacs')
    expect(screen.queryByRole('button', { name: /^LK Lena Kovacs/ })).toBeNull()
  })

  test('another recording starts over', async () => {
    const client = createFixtureClient()
    const tree = (id: number) => <ApiProvider client={client}><OverlayProvider><InspectorPanel transcriptId={id} playback={standing} /></OverlayProvider></ApiProvider>
    const { rerender } = render(tree(DESIGN_REVIEW_ID))
    await counter('1 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: 'Skip' }))
    await counter('2 of 4')
    rerender(tree(WEEKLY_SYNC_ID))
    await counter('1 of 1')
    rerender(tree(DESIGN_REVIEW_ID))
    expect(await counter('1 of 4')).toBeTruthy()
  })

  test('the edge cases of the card', async () => {
    setup()
    await counter('1 of 4')
    await userEvent.click(within(card()).getByRole('button', { name: 'Skip' }))
    await counter('2 of 4')
    expect(within(card()).getByText('0:29')).toBeTruthy()
    await userEvent.click(within(card()).getByRole('button', { name: 'Skip' }))
    await counter('3 of 4')
    expect(within(card()).queryByRole('button', { name: 'Play clip' })).toBeNull()
    expect(within(card()).getByRole('button', { name: /Kate Nguyen/ })).toBeTruthy()
    await userEvent.click(within(card()).getByRole('button', { name: 'Skip' }))
    await counter('4 of 4')
    expect(within(card()).getByRole('button', { name: 'Play clip' })).toBeTruthy()
    expect(within(card()).getByRole('button', { name: 'Add a new speaker' })).toBeTruthy()
    expect(within(card()).queryAllByRole('button', { pressed: false })).toEqual([])
  })
})

describe('speaker windows from the card', () => {
  test('Search: preselects, assigns and goes on', async () => {
    setup(WEEKLY_SYNC_ID)
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: 'Search speakers' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('option', { name: /Mark Ellis/ }).getAttribute('aria-selected')).toBe('true')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Assign' }))
    expect(await screen.findByText(`Assigned to Mark Ellis`)).toBeTruthy()
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
  })

  test('Search takes what the card chose', async () => {
    setup(WEEKLY_SYNC_ID)
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: /Lena Kovacs/ }))
    await userEvent.click(within(card()).getByRole('button', { name: 'Search speakers' }))
    const dialog = await screen.findByRole('dialog')
    expect(within(dialog).getByRole('option', { name: /Lena Kovacs/ }).getAttribute('aria-selected')).toBe('true')
  })

  test('Add a new speaker: Back closes, the card stays', async () => {
    setup(WEEKLY_SYNC_ID)
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: 'Add a new speaker' }))
    const dialog = await screen.findByRole('dialog')
    await userEvent.click(within(dialog).getByRole('button', { name: 'Back' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(screen.getByText('1 of 1')).toBeTruthy()
  })

  test('from Choose speaker: the name comes along, Back returns with the search', async () => {
    setup(WEEKLY_SYNC_ID)
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: 'Search speakers' }))
    await userEvent.type(await screen.findByRole('searchbox', { name: 'Search speakers' }), 'Zoe')
    await userEvent.click(screen.getByRole('button', { name: 'Add “Zoe” as a new speaker' }))
    expect((await screen.findByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Zoe')
    await userEvent.click(button('Back'))
    expect((await screen.findByRole('searchbox', { name: 'Search speakers' }) as HTMLInputElement).value).toBe('Zoe')
  })

  test('Create and assign, then Undo: the voice is back and the new speaker stays', async () => {
    const { client } = setup(WEEKLY_SYNC_ID)
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: 'Add a new speaker' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'Olivia Brown')
    await userEvent.click(button('Create and assign'))
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull())
    expect(await screen.findByText('Assigned to Olivia Brown')).toBeTruthy()
    await userEvent.click(button('Undo'))
    expect(await counter('1 of 1')).toBeTruthy()
    expect((await client.listSpeakers()).some(s => s.name === 'Olivia Brown')).toBe(true)
    expect((await client.getTranscript(WEEKLY_SYNC_ID)).segments.some(s => effectiveSpeaker(s) === unknown1)).toBe(true)
  })

  test('a failure while creating shows in the window', async () => {
    setup(WEEKLY_SYNC_ID, { overrides: { assignSpeaker: () => Promise.reject(new ApiError(500, 'Server error 500')) } })
    await counter('1 of 1')
    await userEvent.click(within(card()).getByRole('button', { name: 'Add a new speaker' }))
    await userEvent.type(await screen.findByRole('textbox', { name: 'Name' }), 'Olivia')
    await userEvent.click(button('Create and assign'))
    expect(await within(screen.getByRole('dialog')).findByText('Server error 500')).toBeTruthy()
  })
})
