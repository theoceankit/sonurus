import type { Meta, StoryObj } from '@storybook/react-vite'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'
import { paragraph, standing, waitFor } from './story-helpers'

// The boards of Redesign / Editor / Transcript, with the names of the boards.
const meta: Meta<typeof EditorScreen> = {
  title: 'Redesign/Editor/Transcript',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID, playback: standing() },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

const nameButton = (canvas: HTMLElement, name: string) =>
  waitFor(() => [...canvas.querySelectorAll('button')].find(node => node.textContent === name))

export const ChangeSpeaker: Story = {
  name: 'Change speaker',
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => { (await nameButton(canvasElement, 'Mark Ellis')).click() },
}

export const TextSelection: Story = {
  name: 'Text selection',
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => {
    const text = (await paragraph(canvasElement, 'I saw a couple of complaints')).firstChild!
    const value = text.textContent!
    const selection = window.getSelection()!
    selection.setBaseAndExtent(text, value.indexOf('I saw'), text, value.length)
    document.dispatchEvent(new MouseEvent('mouseup'))
  },
}

export const EditingText: Story = {
  name: 'Editing text',
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => {
    const text = await paragraph(canvasElement, 'That was me')
    text.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  },
}

export const Renaming: Story = {
  name: 'Renaming',
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => { (await nameButton(canvasElement, 'Weekly product sync')).click() },
}

export const Unassigned: Story = {
  name: 'Unassigned',
  args: { possibleMatches: false },
  parameters: { api: { board: 'unassigned' } },
}
