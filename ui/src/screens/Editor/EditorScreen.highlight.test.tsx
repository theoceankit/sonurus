import { act, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { SPEAKER_IDS, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { createFixtureClient } from '../../api/fixtures/fixture-client'
import { dismissAllToasts } from '../../components/Toast/toast'
import { OverlayProvider } from '../../OverlayProvider'
import { HOVER_DELAY } from '../../styles/motion'
import { EditorScreen } from './EditorScreen'

// The pointer has to stay on a speaker for the delay; the clock also runs on its own,
// so that loading still settles.
const rest = () => act(() => { vi.advanceTimersByTime(HOVER_DELAY) })
beforeEach(() => { vi.useFakeTimers({ shouldAdvanceTime: true }) })

afterEach(() => {
  vi.useRealTimers()
  dismissAllToasts()
  vi.unstubAllGlobals()
  vi.restoreAllMocks()
})

// Wide enough for all three panels; jsdom lays nothing out.
function setup() {
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(() => 1600)
  vi.stubGlobal('ResizeObserver', class { observe() {} disconnect() {} })
  return render(
    <ApiProvider client={createFixtureClient()}>
      <OverlayProvider><EditorScreen initialSelectedId={WEEKLY_SYNC_ID} /></OverlayProvider>
    </ApiProvider>,
  )
}

const inspector = () => within(screen.getByRole('region', { name: 'Inspector' }))
const row = (name: string) => inspector().getByRole('button', { name: `Assign ${name}` }).closest('[class~="speakerRow"]')!
const litTurns = () => [...document.querySelectorAll('[data-speaker][data-highlighted]')].map(turn => turn.getAttribute('data-speaker'))
const barColours = () => new Set(
  [...screen.getByRole('slider', { name: 'Position' }).firstElementChild!.children].map(bar => (bar as HTMLElement).style.background),
)

test('a row under the pointer marks the speaker in the transcript and the player, and leaving clears both', async () => {
  setup()
  await screen.findByText('Retry for failed jobs works too, I checked it.')
  await userEvent.hover(await inspector().findByRole('button', { name: 'Assign Mark Ellis' }).then(found => found.closest('[class~="speakerRow"]')!))
  rest()

  expect(litTurns()).toEqual([SPEAKER_IDS.mark, SPEAKER_IDS.mark])
  expect(barColours()).toEqual(new Set(['var(--color-border-default)', 'var(--color-speaker-1-mid)']))

  await userEvent.unhover(row('Mark Ellis'))
  expect(litTurns()).toEqual([])
  expect(barColours().size).toBeGreaterThan(2)
})

test('another recording starts with nothing highlighted', async () => {
  setup()
  await screen.findByText('Retry for failed jobs works too, I checked it.')
  await userEvent.hover(row('Anna Petrova'))
  rest()
  expect(litTurns().length).toBeGreaterThan(0)
  await userEvent.click(screen.getAllByRole('button', { name: /Design review/ })[0])
  await screen.findByText('Good, these are the cases to check.')
  expect(litTurns()).toEqual([])
})
