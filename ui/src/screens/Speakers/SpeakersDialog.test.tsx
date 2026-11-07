import { act, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, expect, test, vi } from 'vitest'
import { ApiProvider } from '../../api/ApiProvider'
import { GONE_AUDIO_IDS, queueSnapshot, SPEAKER_IDS } from '../../api/fixtures/data'
import { createFixtureClient, type FixtureOptions } from '../../api/fixtures/fixture-client'
import { App } from '../../App'
import { dismissAllToasts } from '../../components/Toast/toast-store'
import { NOT_IMPLEMENTED_TOAST } from '../../not-implemented'
import { OverlayProvider } from '../../OverlayProvider'
import { createMockElectronAPI } from '../../platform/electron-api-mock'
import unknownSpeakerSvg from '../../assets/icons/speaker-unknown.svg?raw'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}) {
  const client = createFixtureClient(options)
  vi.stubGlobal('electronAPI', createMockElectronAPI())
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await userEvent.click(await screen.findByRole('button', { name: 'Speakers' }))
  const dialog = await screen.findByRole('dialog', { name: 'Speakers' })
  await within(dialog).findByRole('button', { name: /Anna Petrova/ })
  return { client, dialog }
}

// The text of each row, without the initials of its avatar.
const rowNames = (dialog: HTMLElement) =>
  [...within(dialog).getByLabelText('Speakers').querySelectorAll('button')]
    .map(button => [...button.children].slice(1).map(part => part.textContent).join(''))

const saveButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Save' }) as HTMLButtonElement
const cancelButton = (dialog: HTMLElement) => within(dialog).getByRole('button', { name: 'Cancel' }) as HTMLButtonElement

const openCard = async (dialog: HTMLElement, name: RegExp) => {
  await userEvent.click(within(dialog).getAllByRole('button', { name })[0])
  return within(dialog).findByRole('button', { name: 'Back to speakers' })
}

test('opens from the titlebar on every speaker, named first', async () => {
  const { dialog } = await setup()
  const names = rowNames(dialog)
  expect(names[0]).toMatch(/^Anna Petrova8 recordings/)
  expect(names.at(-1)).toMatch(/^Unnamed speaker/)
  expect(within(dialog).getByRole('button', { name: /All speakers/ }).textContent).toContain('18')
})

const pathsOf = (svg: Element | null) => [...(svg?.querySelectorAll('path') ?? [])].map(path => path.getAttribute('d'))

test('Unnamed has its own icon, a speaker with a question mark', async () => {
  const { dialog } = await setup()
  const icon = within(dialog).getByRole('button', { name: /^Unnamed/ }).querySelector('svg')
  const file = new DOMParser().parseFromString(unknownSpeakerSvg, 'image/svg+xml').querySelector('svg')
  expect(pathsOf(icon)).toEqual(pathsOf(file))
})

test('the categories and the search narrow the list', async () => {
  const { dialog } = await setup()
  await userEvent.click(within(dialog).getByRole('button', { name: /^Unnamed/ }))
  expect(rowNames(dialog).every(name => name?.startsWith('Unnamed speaker'))).toBe(true)
  await userEvent.click(within(dialog).getByRole('button', { name: /^Recognized/ }))
  await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search speakers' }), 'LENA')
  expect(rowNames(dialog)).toHaveLength(1)
  await userEvent.type(within(dialog).getByRole('searchbox', { name: 'Search speakers' }), 'zzz')
  expect(within(dialog).getByText('No speakers match "LENAzzz"')).toBeTruthy()
})

test('two people with one name are told apart, the one heard last first', async () => {
  const { dialog } = await setup({ board: 'sameNames' })
  const marks = rowNames(dialog).filter(name => name?.startsWith('Mark Ellis'))
  expect(marks).toHaveLength(2)
  expect(marks.every(name => name?.includes('same name'))).toBe(true)
  expect(marks[0]).toContain('8 recordings')
})

test('Recently added and New speaker are not available yet', async () => {
  const { dialog } = await setup()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Recently added' }))
  await userEvent.click(within(dialog).getByRole('button', { name: 'New speaker' }))
  expect((await screen.findAllByText(NOT_IMPLEMENTED_TOAST)).length).toBeGreaterThan(0)
})

test('a card opens in place of the list and goes back to it', async () => {
  const { dialog } = await setup()
  const back = await openCard(dialog, /Lena Kovacs/)
  expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Lena Kovacs')
  expect(within(dialog).getByText('11 recordings')).toBeTruthy()
  expect(within(dialog).getByText('Last seen 4 Oct 2026')).toBeTruthy()
  expect(within(dialog).getByRole('textbox', { name: 'Handle' }).getAttribute('data-not-implemented')).toBe('speaker-card.handle')
  expect(within(dialog).queryByRole('textbox', { name: 'Email' })).toBeNull()
  await userEvent.click(back)
  expect(within(dialog).getByRole('searchbox', { name: 'Search speakers' })).toBeTruthy()
})

test('Enter saves a new name everywhere; a repeated one is allowed and said', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Anna Petrova')
  expect(within(dialog).getByText('Another speaker is also named "Anna Petrova".')).toBeTruthy()
  await userEvent.type(name, '{Enter}')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  await waitFor(() => expect(rowNames(dialog).filter(row => row?.includes('same name'))).toHaveLength(2))
})

test('Escape in the name takes back the edits and keeps the window; a blank name is not saved', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
  await userEvent.clear(name)
  await userEvent.type(name, 'Someone{Escape}')
  expect(name.value).toBe('Lena Kovacs')
  expect(screen.getByRole('dialog', { name: 'Speakers' })).toBeTruthy()
  await userEvent.clear(name)
  expect(saveButton(dialog).disabled).toBe(true)
  await userEvent.type(name, '{Enter}')
  expect(update).not.toHaveBeenCalled()
})

test('nothing is saved while typing or leaving the field: only Save saves, name and colour at once', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  expect(saveButton(dialog).disabled).toBe(true)
  expect(cancelButton(dialog).disabled).toBe(true)
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Lena K')
  await userEvent.tab()
  await userEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Colour' })).getAllByRole('radio')[0])
  expect(update).not.toHaveBeenCalled()
  await userEvent.click(saveButton(dialog))
  await waitFor(() => expect(update).toHaveBeenCalledWith(SPEAKER_IDS.lena, { name: 'Lena K', color_index: 0 }))
  await waitFor(() => expect(saveButton(dialog).disabled).toBe(true))
})

test('Cancel takes back the edits', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  const name = within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement
  await userEvent.type(name, ' Jr')
  await userEvent.click(cancelButton(dialog))
  expect(name.value).toBe('Lena Kovacs')
  expect(saveButton(dialog).disabled).toBe(true)
  expect(update).not.toHaveBeenCalled()
})

test('leaving a card with edits asks first: Keep editing stays, Discard goes', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' Jr')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  let ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
  await userEvent.click(within(ask).getByRole('button', { name: 'Keep editing' }))
  await waitFor(() => expect(screen.queryByRole('alertdialog')).toBeNull())
  expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Lena Kovacs Jr')
  // A category leaves the card too.
  await userEvent.click(within(dialog).getByRole('button', { name: /^Recognized/ }))
  ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
  await userEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
  expect(await within(dialog).findByRole('searchbox', { name: 'Search speakers' })).toBeTruthy()
  expect(update).not.toHaveBeenCalled()
})

test('closing the window with edits asks first', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.click(within(within(dialog).getByRole('radiogroup', { name: 'Colour' })).getAllByRole('radio')[0])
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
  await userEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Speakers' })).toBeNull())
})

test('a card without edits leaves without asking', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  expect(within(dialog).getByRole('searchbox', { name: 'Search speakers' })).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('a speaker without a name is grey, and gets a colour with a name', async () => {
  const { dialog } = await setup()
  await userEvent.click(within(dialog).getByRole('button', { name: /^Unnamed/ }))
  await openCard(dialog, /Unnamed speaker/)
  expect(within(dialog).getByText('Speakers without a name are grey. Add a name to choose a colour.')).toBeTruthy()
  expect(within(dialog).queryByRole('radiogroup', { name: 'Colour' })).toBeNull()
})

test('the voice sample is the clip of the Review card: its text opens with the chevron, without quotes', async () => {
  const { client, dialog } = await setup()
  const { text } = await client.getSpeakerSample(SPEAKER_IDS.lena)
  await openCard(dialog, /Lena Kovacs/)
  const show = await within(dialog).findByRole('button', { name: 'Show text' })
  expect(within(dialog).queryByText(text.trim())).toBeNull()
  await userEvent.click(show)
  expect(within(dialog).getByText(text.trim()).textContent).toBe(text.trim())
  expect((within(dialog).getByRole('button', { name: 'Play clip' }) as HTMLButtonElement).disabled).toBe(false)
})

test('while the sample loads its player is off and has no text', async () => {
  const { dialog } = await setup({ overrides: { getSpeakerSample: () => new Promise(() => {}) } })
  await openCard(dialog, /Lena Kovacs/)
  expect((within(dialog).getByRole('button', { name: 'Play clip' }) as HTMLButtonElement).disabled).toBe(true)
  expect(within(dialog).queryByRole('button', { name: 'Show text' })).toBeNull()
})

test('Appears in opens a recording in the Editor, and a recording without its file cannot play', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Oliver Grant/)
  await within(dialog).findByText('Archived partner call')
  expect(GONE_AUDIO_IDS).toContain(7)
  expect((within(dialog).getByRole('button', { name: 'Audio unavailable' }) as HTMLButtonElement).disabled).toBe(true)
  await userEvent.click(within(dialog).getByText('Design review'))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Speakers' })).toBeNull())
  expect(await screen.findByRole('heading', { name: 'Design review' })).toBeTruthy()
})

test('deleting asks first, then shows the next speaker', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  expect(within(dialog).queryByRole('button', { name: /^Delete speaker/ })).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete speaker' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Delete "Lena Kovacs"?' })
  expect(within(confirm).getByText(/will become Unassigned/)).toBeTruthy()
  await userEvent.click(within(confirm).getByRole('button', { name: 'Delete' }))
  await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Mark Ellis'))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  expect(rowNames(dialog).some(row => row?.startsWith('Lena Kovacs'))).toBe(false)
})

test('a speaker is not deleted while the queue transcribes', async () => {
  const { client, dialog } = await setup()
  act(() => { client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ running_job_id: 'a' }) }] }) })
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.click(within(dialog).getByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Delete speaker' }))
  expect(await screen.findByText('Pause the transcription queue first.')).toBeTruthy()
  expect(screen.queryByRole('alertdialog')).toBeNull()
})

test('Merge and Delete follow each other in More, with nothing between them', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.click(within(dialog).getByRole('button', { name: 'More' }))
  const menu = await screen.findByRole('menu')
  expect(within(menu).queryByRole('separator')).toBeNull()
  expect(within(menu).getAllByRole('menuitem').map(item => item.textContent?.trim())).toEqual(['Merge into another speaker', 'Delete speaker'])
})

test('a card goes: name and colour, what the speaker did, the sample, the recordings', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  const order = ['Colour', '11 recordings', 'Voice sample', 'Appears in'].map(text => within(dialog).getByText(text))
  for (let i = 1; i < order.length; i++) {
    expect(order[i - 1].compareDocumentPosition(order[i]) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy()
  }
})

test('a row of Appears in has the date and no time', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  const row = (await within(dialog).findByText('Design review')).closest('button')!
  expect(row.textContent).toBe('Design review5 Oct 2026')
})
