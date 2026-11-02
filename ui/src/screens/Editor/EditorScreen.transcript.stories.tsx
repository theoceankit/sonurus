import type { Meta, StoryObj } from '@storybook/react-vite'
import { WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import type { Playback, PlaybackState } from '../../media/playback'
import { EditorScreen } from './EditorScreen'
import styles from './EditorScreen.stories.module.css'

// Playback standing where the boards show it, with no audio and no ticks.
const standing = (state: Partial<PlaybackState> = {}): Playback => {
  const current: PlaybackState = { currentTime: 28, duration: 53, paused: false, rate: 1, volume: 1, status: 'ready', ...state }
  return {
    getState: () => current,
    subscribe: () => () => {},
    load: () => {},
    toggle: () => {},
    seek: () => {},
    setRate: () => {},
    setVolume: () => {},
  }
}

const meta: Meta<typeof EditorScreen> = {
  title: 'Screens/Editor/Transcript',
  component: EditorScreen,
  parameters: { layout: 'fullscreen' },
  decorators: [Story => <div className={styles.board}><Story /></div>],
  args: { pinnedIds: [WEEKLY_SYNC_ID, 2], initialSelectedId: WEEKLY_SYNC_ID, playback: standing() },
}
export default meta

type Story = StoryObj<typeof EditorScreen>

const waitFor = async (find: () => Element | null | undefined) => {
  for (let i = 0; i < 100; i++) {
    const found = find()
    if (found) return found as HTMLElement
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Not found')
}

const paragraph = (canvas: HTMLElement, text: string) =>
  waitFor(() => [...canvas.querySelectorAll('[data-transcript-text]')].find(node => node.textContent!.includes(text)))
const nameButton = (canvas: HTMLElement, name: string) =>
  waitFor(() => [...canvas.querySelectorAll('button')].find(node => node.textContent === name))

export const Playing: Story = {}

export const HoverActions: Story = {
  play: async ({ canvasElement }) => {
    const text = await paragraph(canvasElement, 'Retry for failed jobs')
    text.parentElement!.dispatchEvent(new PointerEvent('pointerover', { bubbles: true }))
  },
}

export const ChangeSpeaker: Story = {
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => { (await nameButton(canvasElement, 'Mark Ellis')).click() },
}

export const TextSelection: Story = {
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
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => {
    const text = await paragraph(canvasElement, 'That was me')
    text.dispatchEvent(new MouseEvent('dblclick', { bubbles: true }))
  },
}

export const Renaming: Story = {
  parameters: { api: { board: 'reviewDone' } },
  play: async ({ canvasElement }) => { (await nameButton(canvasElement, 'Weekly product sync')).click() },
}

export const Unassigned: Story = { parameters: { api: { board: 'unassigned' } } }

export const StickyHeader: Story = {
  play: async ({ canvasElement }) => {
    const scroll = await waitFor(() => canvasElement.querySelector('[data-transcript-scroll]'))
    scroll.scrollTop = 200
  },
}

export const Paused: Story = { args: { playback: standing({ currentTime: 0, paused: true }) } }
export const Loading: Story = { parameters: { api: { scenario: 'loading' } } }
export const Failed: Story = { parameters: { api: { scenario: 'error' } } }
export const NoRecording: Story = { args: { initialSelectedId: null } }

// Three hours, about 3600 segments, to scroll through. No sound here, the app has it.
export const LongRecording: Story = {
  args: { initialSelectedId: 1000, pinnedIds: undefined, playback: undefined },
  parameters: { api: { board: 'longRecording', noAudio: true } },
}
