import type { NoteDocument } from '../types'

const text = (value: string, marks?: { type: string; attrs?: Record<string, unknown> }[]) => ({ type: 'text', text: value, ...(marks && { marks }) })
const paragraph = (...content: object[]) => ({ type: 'paragraph', content })
const heading = (level: number, value: string) => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const item = (value: string) => ({ type: 'listItem', content: [paragraph(text(value))] })
const task = (checked: boolean, value: string) => ({ type: 'taskItem', attrs: { checked }, content: [paragraph(text(value))] })

// The note of the weekly sync, as the backend keeps it: Markdown only, no chips yet.
export const weeklySyncNote = (): NoteDocument => ({
  type: 'doc',
  content: [
    heading(1, 'Weekly product sync'),
    paragraph(text('Friday\'s release went out '), text('without crashes', [{ type: 'bold' }]), text('.')),
    heading(2, 'Decisions'),
    { type: 'bulletList', content: [item('Ship the import fix before the redesign'), item('Retry for failed jobs is good enough for now')] },
    heading(2, 'Action items'),
    { type: 'taskList', content: [task(true, 'Draft the release notes'), task(false, 'Ask support about the import errors')] },
    { type: 'blockquote', content: [paragraph(text('Nobody reads the changelog, so the release notes are the changelog.', [{ type: 'italic' }]))] },
    paragraph(text('Questions: '), text('support', [{ type: 'link', attrs: { href: 'mailto:support@example.com' } }])),
  ],
})
