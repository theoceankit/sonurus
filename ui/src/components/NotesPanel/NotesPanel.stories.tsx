import type { Meta, StoryObj } from '@storybook/react-vite'
import { findSampleSpeaker, minutesNote, SAMPLE_CANDIDATES, SAMPLE_IDS } from '../NoteEditor/note-samples'
import { NotesPanel } from './NotesPanel'

const meta: Meta<typeof NotesPanel> = {
  component: NotesPanel,
  args: { candidates: SAMPLE_CANDIDATES, findSpeaker: findSampleSpeaker, time: 754, onCopy: () => {}, onToggleExpanded: () => {} },
  decorators: [Story => <div style={{ width: 284, height: 560 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof NotesPanel>

// No note yet: Copy notes has nothing to copy.
export const Empty: Story = {}
export const WithText: Story = { args: { content: minutesNote(SAMPLE_IDS) } }
// In place of the transcript: a title, a reading column and Collapse.
export const Expanded: Story = {
  args: { content: minutesNote(SAMPLE_IDS), mode: 'expanded', title: 'Weekly product sync' },
  decorators: [Story => <div style={{ width: 900, height: 560 }}><Story /></div>],
}
// The player has no audio yet, or its file is gone: the button stays, out of use.
export const NoAudio: Story = { args: { content: minutesNote(SAMPLE_IDS), time: 0, timeDisabled: true } }
