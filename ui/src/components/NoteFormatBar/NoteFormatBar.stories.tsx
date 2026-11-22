import type { Meta, StoryObj } from '@storybook/react-vite'
import type { Editor, JSONContent } from '@tiptap/react'
import { useEffect, useState } from 'react'
import { NoteEditor } from '../NoteEditor/NoteEditor'
import { findSampleSpeaker, minutesNote, SAMPLE_IDS } from '../NoteEditor/note-samples'
import { NoteFormatBar } from './NoteFormatBar'

const meta: Meta<typeof NoteFormatBar> = { component: NoteFormatBar }
export default meta

type Story = StoryObj<typeof NoteFormatBar>

const para = (text: string, marks?: JSONContent['marks']): JSONContent => ({ type: 'paragraph', content: [{ type: 'text', text, marks }] })

// On a real editor, at the narrowest the panel gets, with the cursor at the given place.
function OnEditor({ content, at, time }: { content: JSONContent | null; at?: number; time?: 'ready' | 'off' }) {
  const [editor, setEditor] = useState<Editor | null>(null)
  useEffect(() => { if (editor && at !== undefined) editor.commands.focus(at) }, [editor, at])
  return (
    <div style={{ width: 290 }}>
      <NoteFormatBar editor={editor} onInsertTime={time ? () => {} : undefined} timeDisabled={time === 'off'} />
      <NoteEditor content={content} findSpeaker={findSampleSpeaker} onEditor={setEditor} />
    </div>
  )
}

// Before the editor has loaded: nothing can be pressed.
export const NoEditor: Story = { args: { editor: null } }
export const EmptyNote: Story = { render: () => <OnEditor content={null} /> }
export const OnMinutes: Story = { render: () => <OnEditor content={minutesNote(SAMPLE_IDS)} at={3} /> }
// With the player's time, and with a player that has no audio.
export const WithTime: Story = { render: () => <OnEditor content={minutesNote(SAMPLE_IDS)} time="ready" /> }
export const TimeOutOfUse: Story = { render: () => <OnEditor content={minutesNote(SAMPLE_IDS)} time="off" /> }
export const BoldActive: Story = { render: () => <OnEditor content={{ type: 'doc', content: [para('Bold text', [{ type: 'bold' }])] }} at={3} /> }
export const HeadingActive: Story = { render: () => <OnEditor content={{ type: 'doc', content: [{ type: 'heading', attrs: { level: 2 }, content: [{ type: 'text', text: 'Decisions' }] }] }} at={3} /> }
export const OnLink: Story = { render: () => <OnEditor content={{ type: 'doc', content: [para('A link', [{ type: 'link', attrs: { href: 'https://localhost/page' } }])] }} at={3} /> }
