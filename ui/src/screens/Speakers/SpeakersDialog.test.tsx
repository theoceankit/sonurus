import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
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
import { findDialog, findTitlebarButton, getDialog, queryDialog } from '../../test-queries'
import { trackUndoToast } from '../Editor/speaker-undo-toasts'

afterEach(() => {
  dismissAllToasts()
  vi.unstubAllGlobals()
})

async function setup(options: FixtureOptions = {}) {
  const client = createFixtureClient(options)
  vi.stubGlobal('electronAPI', createMockElectronAPI())
  render(<ApiProvider client={client}><OverlayProvider><App /></OverlayProvider></ApiProvider>)
  await userEvent.click(await findTitlebarButton('Speakers'))
  const dialog = await findDialog('Speakers')
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
  expect(names[0]).toMatch(/^Anna Petrova@anna\.petrova8 recordings/)
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

test('Recently added is not available yet', async () => {
  const { dialog } = await setup()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Recently added' }))
  expect((await screen.findAllByText(NOT_IMPLEMENTED_TOAST)).length).toBeGreaterThan(0)
})

const newSpeaker = async (dialog: HTMLElement) => {
  const button = within(dialog).getByRole('button', { name: 'New speaker' })
  expect(button.getAttribute('data-not-implemented')).toBeNull()
  await userEvent.click(button)
  return findDialog('New speaker')
}

test('New speaker makes a speaker in no recording and opens their card', async () => {
  const { client, dialog } = await setup()
  const create = vi.spyOn(client, 'createSpeaker')
  const window = await newSpeaker(dialog)
  await userEvent.type(within(window).getByRole('textbox', { name: 'Name' }), 'Dana Scully')
  await waitFor(() => expect((within(window).getByRole('textbox', { name: 'Handle' }) as HTMLInputElement).value).toBe('dana.scully'))
  await userEvent.click(within(window).getByRole('button', { name: 'Create speaker' }))
  await waitFor(() => expect(queryDialog('New speaker')).toBeNull())
  expect(create).toHaveBeenCalledOnce()
  expect(create.mock.calls[0][0]).toMatchObject({ name: 'Dana Scully' })
  expect(create.mock.calls[0][0].handle).toBeUndefined()
  expect((await within(dialog).findByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Dana Scully')
  expect(within(dialog).getByText('Not in any recording')).toBeTruthy()
  // No voice sample and no recordings in Appears in.
  await waitFor(() => expect(within(dialog).getAllByText('Not in any recording yet.')).toHaveLength(2))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  expect(rowNames(dialog).some(row => row.startsWith('Dana Scully@dana.scullyNot in any recording'))).toBe(true)
  expect(within(dialog).getByRole('button', { name: /All speakers/ }).textContent).toContain('19')
})

test('Cancel in New speaker creates no one', async () => {
  const { client, dialog } = await setup()
  const create = vi.spyOn(client, 'createSpeaker')
  const window = await newSpeaker(dialog)
  await userEvent.type(within(window).getByRole('textbox', { name: 'Name' }), 'Dana')
  await userEvent.click(within(window).getByRole('button', { name: 'Cancel' }))
  await waitFor(() => expect(queryDialog('New speaker')).toBeNull())
  expect(create).not.toHaveBeenCalled()
  expect(within(dialog).getByRole('searchbox', { name: 'Search speakers' })).toBeTruthy()
})

test('a taken handle is said in New speaker, and a refusal keeps the window open', async () => {
  const { client, dialog } = await setup()
  const window = await newSpeaker(dialog)
  await userEvent.type(within(window).getByRole('textbox', { name: 'Name' }), 'Lena')
  const handle = within(window).getByRole('textbox', { name: 'Handle' })
  await userEvent.clear(handle)
  await userEvent.type(handle, 'lena.kovacs')
  expect(within(window).getByText(/taken by Lena Kovacs/)).toBeTruthy()
  expect((within(window).getByRole('button', { name: 'Create speaker' }) as HTMLButtonElement).disabled).toBe(true)
  // One the backend refuses, though the list did not know it.
  await userEvent.clear(handle)
  await userEvent.type(handle, 'lena2')
  vi.spyOn(client, 'createSpeaker').mockRejectedValueOnce(Object.assign(new Error('@lena2 is taken by Lena.'), { code: 'handle_taken' }))
  await userEvent.click(within(window).getByRole('button', { name: 'Create speaker' }))
  expect(await within(window).findByText('@lena2 is taken by Lena.')).toBeTruthy()
  expect(getDialog('New speaker')).toBeTruthy()
  expect((await client.listSpeakers()).some(speaker => speaker.name === 'Lena')).toBe(false)
})

test('New speaker from a card with edits asks first', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' Jr')
  await userEvent.click(within(dialog).getByRole('button', { name: 'New speaker' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
  expect(queryDialog('New speaker')).toBeNull()
  await userEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
  expect(await findDialog('New speaker')).toBeTruthy()
})

test('a speaker made from Unnamed opens in All speakers', async () => {
  const { dialog } = await setup()
  await userEvent.click(within(dialog).getByRole('button', { name: /^Unnamed/ }))
  const window = await newSpeaker(dialog)
  await userEvent.type(within(window).getByRole('textbox', { name: 'Name' }), 'Dana')
  await userEvent.click(within(window).getByRole('button', { name: 'Create speaker' }))
  expect((await within(dialog).findByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Dana')
  expect(within(dialog).getByRole('button', { name: /All speakers/ }).getAttribute('aria-current')).toBeTruthy()
})

test('a card opens in place of the list and goes back to it', async () => {
  const { dialog } = await setup()
  const back = await openCard(dialog, /Lena Kovacs/)
  expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Lena Kovacs')
  expect(within(dialog).getByText('11 recordings')).toBeTruthy()
  expect(within(dialog).getByText('Last seen 4 Oct 2026')).toBeTruthy()
  const handle = within(dialog).getByRole('textbox', { name: 'Handle' }) as HTMLInputElement
  expect(handle.value).toBe('lena.kovacs')
  expect(handle.getAttribute('data-not-implemented')).toBeNull()
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
  expect(getDialog('Speakers')).toBeTruthy()
  await userEvent.clear(name)
  expect(saveButton(dialog).disabled).toBe(true)
  await userEvent.type(name, '{Enter}')
  expect(update).not.toHaveBeenCalled()
})

test('nothing is saved while typing or leaving the field: only Save saves', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  expect(saveButton(dialog).disabled).toBe(true)
  expect(cancelButton(dialog).disabled).toBe(true)
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Lena K')
  await userEvent.tab()
  expect(update).not.toHaveBeenCalled()
  await userEvent.click(saveButton(dialog))
  await waitFor(() => expect(update).toHaveBeenCalledWith(SPEAKER_IDS.lena, { name: 'Lena K' }))
  await waitFor(() => expect(saveButton(dialog).disabled).toBe(true))
})

test('a colour kept from the Avatar window never turns Save and Cancel on, not even for a moment', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  const save = saveButton(dialog)
  const cancel = cancelButton(dialog)
  const enabled: string[] = []
  const watch = new MutationObserver(() => {
    if (!save.disabled) enabled.push('Save')
    if (!cancel.disabled) enabled.push('Cancel')
  })
  watch.observe(save, { attributes: true })
  watch.observe(cancel, { attributes: true })
  await userEvent.click(within(dialog).getByRole('button', { name: 'Change avatar' }))
  const window = await screen.findByRole('dialog', { name: 'Avatar' })
  await userEvent.click(within(window).getByRole('radio', { name: 'Blue' }))
  await waitFor(() => expect(within(dialog).getByRole('button', { name: 'Change avatar', hidden: true }).querySelector('[style*="speaker-1-bg"]')).toBeTruthy())
  watch.disconnect()
  expect(enabled).toEqual([])
  expect(save.disabled).toBe(true)
})

test('the colour is chosen in the Avatar window and kept at once, edits of the name staying as they were', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  expect(within(dialog).queryByRole('radiogroup', { name: 'Colour' })).toBeNull()
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Lena K')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Change avatar' }))
  const window = await screen.findByRole('dialog', { name: 'Avatar' })
  await userEvent.click(within(window).getAllByRole('radio')[0])
  await waitFor(() => expect(update).toHaveBeenCalledWith(SPEAKER_IDS.lena, { color_index: 0 }))
  await userEvent.click(within(window).getByRole('button', { name: 'Done' }))
  await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Avatar' })).toBeNull())
  // The name is still an edit; Save sends it alone and keeps the new colour.
  expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Lena K')
  await userEvent.click(saveButton(dialog))
  await waitFor(() => expect(update).toHaveBeenLastCalledWith(SPEAKER_IDS.lena, { name: 'Lena K' }))
  expect((await client.listSpeakers()).find(s => s.id === SPEAKER_IDS.lena)?.color_index).toBe(0)
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
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), ' K')
  await userEvent.click(within(dialog).getByRole('button', { name: 'Close' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
  await userEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
  await waitFor(() => expect(queryDialog('Speakers')).toBeNull())
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
  expect(within(dialog).getByText('Speakers without a name are grey. Add a name to choose a colour and a photo.')).toBeTruthy()
  expect(within(dialog).queryByRole('button', { name: 'Change avatar' })).toBeNull()
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
  await waitFor(() => expect(queryDialog('Speakers')).toBeNull())
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

const chooseMergeTarget = async (dialog: HTMLElement, from: string) => {
  await openCard(dialog, new RegExp(from))
  await userEvent.click(within(dialog).getByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge into another speaker' }))
  return findDialog(`Merge "${from}" into another speaker`)
}

test('merging chooses the other speaker, asks first, then shows the one who stays', async () => {
  const { dialog } = await setup()
  const picker = await chooseMergeTarget(dialog, 'Lena Kovacs')
  const list = within(picker).getByRole('listbox', { name: 'Speakers' })
  expect(within(list).queryByText('Lena Kovacs')).toBeNull()
  expect(within(picker).queryByRole('button', { name: 'New speaker' })).toBeNull()
  await userEvent.click(within(list).getByRole('option', { name: /Mark Ellis/ }))
  await userEvent.click(within(picker).getByRole('button', { name: 'Merge' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Merge "Lena Kovacs" into "Mark Ellis"?' })
  expect(within(confirm).getByText(/move to "Mark Ellis"/)).toBeTruthy()
  await userEvent.click(within(confirm).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Mark Ellis'))
  expect(await screen.findByText('Merged "Lena Kovacs" into "Mark Ellis".')).toBeTruthy()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  expect(rowNames(dialog).some(row => row?.startsWith('Lena Kovacs'))).toBe(false)
})

test('a speaker without a name takes the name of the one merged into them', async () => {
  const { dialog } = await setup()
  const picker = await chooseMergeTarget(dialog, 'Lena Kovacs')
  await userEvent.click(within(picker).getByRole('button', { name: /^Unnamed/ }))
  await userEvent.click(within(picker).getAllByRole('option', { name: /Unnamed speaker/ })[0])
  await userEvent.click(within(picker).getByRole('button', { name: 'Merge' }))
  const confirm = await screen.findByRole('alertdialog', { name: 'Merge "Lena Kovacs" into Unnamed speaker?' })
  expect(within(confirm).getByText(/takes the name "Lena Kovacs"/)).toBeTruthy()
  await userEvent.click(within(confirm).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect((within(dialog).getByRole('textbox', { name: 'Name' }) as HTMLInputElement).value).toBe('Lena Kovacs'))
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  expect(rowNames(dialog).filter(row => row?.startsWith('Lena Kovacs'))).toHaveLength(1)
})

test('a speaker is not merged while the queue transcribes', async () => {
  const { client, dialog } = await setup()
  act(() => { client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ running_job_id: 'a' }) }] }) })
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.click(within(dialog).getByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge into another speaker' }))
  expect(await screen.findByText('Pause the transcription queue first.')).toBeTruthy()
  expect(queryDialog('Merge "Lena Kovacs" into another speaker')).toBeNull()
})

test('a card with edits asks to discard them before merging', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'x')
  await userEvent.click(within(dialog).getByRole('button', { name: 'More' }))
  await userEvent.click(await screen.findByRole('menuitem', { name: 'Merge into another speaker' }))
  const ask = await screen.findByRole('alertdialog', { name: 'Discard changes?' })
  await userEvent.click(within(ask).getByRole('button', { name: 'Discard' }))
  expect(await findDialog('Merge "Lena Kovacs" into another speaker')).toBeTruthy()
})

test('a merge closes the Undo toasts that would give segments back to the merged speaker', async () => {
  const { dialog } = await setup()
  const dismiss = vi.fn()
  trackUndoToast([SPEAKER_IDS.lena], dismiss)
  const picker = await chooseMergeTarget(dialog, 'Lena Kovacs')
  await userEvent.click(within(picker).getByRole('option', { name: /Mark Ellis/ }))
  await userEvent.click(within(picker).getByRole('button', { name: 'Merge' }))
  await userEvent.click(within(await screen.findByRole('alertdialog')).getByRole('button', { name: 'Merge' }))
  await waitFor(() => expect(dismiss).toHaveBeenCalledTimes(1))
})

const handleField = (dialog: HTMLElement) => within(dialog).getByRole('textbox', { name: 'Handle' }) as HTMLInputElement

test('the search finds a speaker by handle, with or without the @', async () => {
  const { dialog } = await setup()
  const search = within(dialog).getByRole('searchbox', { name: 'Search speakers' })
  await userEvent.type(search, '@lena.k')
  expect(rowNames(dialog)).toEqual([expect.stringMatching(/^Lena Kovacs@lena\.kovacs/)])
})

test('two people with one name have different handles', async () => {
  const { dialog } = await setup({ board: 'sameNames' })
  const list = within(dialog).getByLabelText('Speakers')
  expect(within(list).getByText('@mark.ellis')).toBeTruthy()
  expect(within(list).getByText('@mark.ellis2')).toBeTruthy()
})

test('a new name shows the handle it brings, and Save sends the name alone', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Анна Петрова')
  await waitFor(() => expect(handleField(dialog).value).toBe('anna.petrova2'))
  await userEvent.click(saveButton(dialog))
  await waitFor(() => expect(update).toHaveBeenCalledWith(SPEAKER_IDS.lena, { name: 'Анна Петрова' }))
  await waitFor(() => expect(handleField(dialog).value).toBe('anna.petrova2'))
})

test('a handle typed by hand is saved, lowercase and without the @, and stays through a rename', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.clear(handleField(dialog))
  await userEvent.type(handleField(dialog), '@Lena.K{Enter}')
  await waitFor(() => expect(update).toHaveBeenCalledWith(SPEAKER_IDS.lena, { handle: 'lena.k' }))
  const name = within(dialog).getByRole('textbox', { name: 'Name' })
  await userEvent.clear(name)
  await userEvent.type(name, 'Lena Stone')
  expect(handleField(dialog).value).toBe('lena.k')
  await userEvent.click(saveButton(dialog))
  await waitFor(() => expect(saveButton(dialog).disabled).toBe(true))
  expect(handleField(dialog).value).toBe('lena.k')
})

test('a taken or bad handle is said under the field and cannot be saved', async () => {
  const { client, dialog } = await setup()
  const update = vi.spyOn(client, 'updateSpeaker')
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.clear(handleField(dialog))
  await userEvent.type(handleField(dialog), 'Anna.Petrova')
  expect(within(dialog).getByText('@anna.petrova is taken by Anna Petrova.')).toBeTruthy()
  expect(saveButton(dialog).disabled).toBe(true)
  await userEvent.clear(handleField(dialog))
  await userEvent.type(handleField(dialog), 'лена{Enter}')
  expect(within(dialog).getByText(/^Use lowercase Latin letters/)).toBeTruthy()
  expect(saveButton(dialog).disabled).toBe(true)
  expect(update).not.toHaveBeenCalled()
})

test('an emptied handle shows the one made from the name and brings it back', async () => {
  const { client, dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.clear(handleField(dialog))
  await userEvent.type(handleField(dialog), 'lk{Enter}')
  await waitFor(() => expect(saveButton(dialog).disabled).toBe(true))
  const update = vi.spyOn(client, 'updateSpeaker')
  await userEvent.clear(handleField(dialog))
  await waitFor(() => expect(handleField(dialog).placeholder).toBe('lena.kovacs'))
  expect(within(dialog).getByText('Left empty, the handle is made from the name.')).toBeTruthy()
  await userEvent.click(saveButton(dialog))
  await waitFor(() => expect(update).toHaveBeenCalledWith(SPEAKER_IDS.lena, { handle: '' }))
  await waitFor(() => expect(handleField(dialog).value).toBe('lena.kovacs'))
})

test('a speaker without a name has no handle until they get one', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Unnamed speaker/)
  expect(handleField(dialog).value).toBe('')
  expect(handleField(dialog).readOnly).toBe(true)
  expect(within(dialog).getByText('Add a name first: the handle is made from it.')).toBeTruthy()
  await userEvent.type(within(dialog).getByRole('textbox', { name: 'Name' }), 'Tom Hardy')
  await waitFor(() => expect(handleField(dialog).value).toBe('tom.hardy'))
  expect(handleField(dialog).readOnly).toBe(false)
})

test('the avatar of a speaker without a name opens nothing: a photo comes with a name', async () => {
  const { dialog } = await setup()
  await userEvent.click(within(dialog).getByRole('button', { name: /^Unnamed/ }))
  await openCard(dialog, /Unnamed speaker/)
  expect(within(dialog).queryByRole('button', { name: 'Add photo' })).toBeNull()
})

// What is in the Avatar window is queried inside it, not over the whole app (test-queries.ts).
const avatarWindow = () => findDialog('Avatar')

// jsdom draws nothing: the picture's size and the canvas are given by hand.
async function uploadPhoto() {
  URL.createObjectURL = vi.fn(() => 'blob:picture')
  URL.revokeObjectURL = vi.fn()
  vi.spyOn(HTMLCanvasElement.prototype, 'getContext').mockReturnValue({ drawImage: vi.fn() } as unknown as CanvasRenderingContext2D)
  vi.spyOn(HTMLCanvasElement.prototype, 'toBlob').mockImplementation(done => done(new Blob(['photo'], { type: 'image/jpeg' })))
  const window = await avatarWindow()
  expect(within(window).getByText(/JPEG, PNG or WebP, up to 20 MB\./)).toBeTruthy()
  fireEvent.change(within(window).getByLabelText('Photo file'), { target: { files: [new File(['x'], 'me.jpg', { type: 'image/jpeg' })] } })
  const crop = await avatarWindow()
  await within(crop).findByRole('group', { name: 'Photo position' })
  const picture = crop.querySelector('img')!
  Object.defineProperty(picture, 'naturalWidth', { value: 300 })
  Object.defineProperty(picture, 'naturalHeight', { value: 300 })
  fireEvent.load(picture)
  await userEvent.click(within(crop).getByRole('button', { name: 'Save photo' }))
  await waitFor(() => expect(within(crop).queryByLabelText('Photo position')).toBeNull())
}


test('a click on the avatar opens the Avatar window: a photo kept at once shows on the card and in the list; Remove photo takes it away', async () => {
  const { client, dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  await userEvent.click(within(dialog).getByRole('button', { name: 'Change avatar' }))
  await uploadPhoto()
  const window = await avatarWindow()
  await within(window).findByRole('button', { name: 'Remove photo' })
  await userEvent.click(within(window).getByRole('button', { name: 'Done' }))
  const lena = (await client.listSpeakers()).find(speaker => speaker.name === 'Lena Kovacs')!
  expect(lena.photo_url).toMatch(/^data:image\/jpeg/)
  await waitFor(() => expect(dialog.querySelector(`img[src="${lena.photo_url}"]`)).toBeTruthy())
  // Nothing to Save: the photo is not an edit of the card.
  expect(saveButton(dialog).disabled).toBe(true)

  await userEvent.click(within(dialog).getByRole('button', { name: 'Change avatar' }))
  const again = await avatarWindow()
  await userEvent.click(await within(again).findByRole('button', { name: 'Remove photo' }))
  await waitFor(() => expect(within(again).queryByRole('button', { name: 'Remove photo' })).toBeNull())
  await userEvent.click(within(again).getByRole('button', { name: 'Done' }))
  expect((await client.listSpeakers()).find(speaker => speaker.name === 'Lena Kovacs')!.photo).toBeNull()
  await userEvent.click(within(dialog).getByRole('button', { name: 'Back to speakers' }))
  expect(within(dialog).getAllByRole('button', { name: /Lena Kovacs/ })[0].querySelector('img')).toBeNull()
})

test('a card goes: name and handle, what the speaker did, the sample, the recordings', async () => {
  const { dialog } = await setup()
  await openCard(dialog, /Lena Kovacs/)
  const order = ['Handle', '11 recordings', 'Voice sample', 'Appears in'].map(text => within(dialog).getByText(text))
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

test('a photo chosen in New speaker goes with the new speaker', async () => {
  const { client, dialog } = await setup()
  const window = await newSpeaker(dialog)
  await userEvent.type(within(window).getByRole('textbox', { name: 'Name' }), 'Dana')
  await userEvent.click(within(window).getByRole('button', { name: 'Change avatar' }))
  await uploadPhoto()
  await userEvent.click(within(await avatarWindow()).getByRole('button', { name: 'Done' }))
  await userEvent.click(within(window).getByRole('button', { name: 'Create speaker' }))
  await within(dialog).findByRole('button', { name: 'Back to speakers' })
  await waitFor(async () => expect((await client.listSpeakers()).find(speaker => speaker.name === 'Dana')?.photo).toBeTruthy())
})
