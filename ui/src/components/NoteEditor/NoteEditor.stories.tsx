import type { Meta, StoryObj } from '@storybook/react-vite'
import { useEffect, useRef } from 'react'
import { findSampleSpeaker, minutesNote, SAMPLE_CANDIDATES, SAMPLE_IDS } from './note-samples'
import { NoteEditor, type NoteEditorHandle } from './NoteEditor'

// Types into the note once it is there, as from the keyboard.
function Typed({ typing, ...props }: Parameters<typeof NoteEditor>[0] & { typing?: string }) {
  const editor = useRef<NoteEditorHandle>(null)
  useEffect(() => {
    if (!typing) return
    const timer = setTimeout(() => editor.current?.type(typing), 100)
    return () => clearTimeout(timer)
  }, [typing])
  return <NoteEditor ref={editor} {...props} />
}

const meta: Meta<typeof Typed> = {
  title: 'Components/NoteEditor',
  component: Typed,
  args: { candidates: SAMPLE_CANDIDATES, findSpeaker: findSampleSpeaker },
  decorators: [Story => <div style={{ width: 268, height: 560, overflow: 'auto' }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Typed>

// Nothing written yet: the placeholder says what Markdown does.
export const Empty: Story = { args: { autoFocus: true } }
// Every kind of Markdown, both chips, someone not in the base and a deleted speaker.
export const Minutes: Story = { args: { content: minutesNote(SAMPLE_IDS) } }
// @ typed: the recording's speakers, the others, and the text as typed.
export const Mentioning: Story = { args: { content: minutesNote(SAMPLE_IDS), typing: '@an' } }
export const MentioningSomeoneElse: Story = { args: { content: minutesNote(SAMPLE_IDS), typing: '@Sam from support' } }
// In place of the transcript: wider and a size larger.
export const Expanded: Story = {
  args: { content: minutesNote(SAMPLE_IDS), size: 'expanded' },
  decorators: [Story => <div style={{ width: 720 }}><Story /></div>],
}
