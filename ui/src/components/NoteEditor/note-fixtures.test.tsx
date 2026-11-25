import { render, screen } from '@testing-library/react'
import type { Editor } from '@tiptap/core'
import type { JSONContent } from '@tiptap/react'
import { readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join, resolve } from 'node:path'
import { describe, expect, test } from 'vitest'
import { minutesNote } from './note-samples'
import { NoteEditor } from './NoteEditor'

// The notes the backend turns into Markdown and back (app/services/note_markdown.py)
// are checked there against these files. Here the editor proves each document is
// exactly what it would save itself, so a change to its schema shows up in both.
// NOTE_FIXTURES=write rewrites the files from the editor instead of checking them.
// Tests run from ui/.
const DIR = resolve(process.cwd(), '../tests/fixtures/notes')
const WRITE = process.env.NOTE_FIXTURES === 'write'

const documents = readdirSync(DIR).filter(name => name.endsWith('.json') && name !== 'speakers.json' && !name.endsWith('.warnings.json')).sort()
const read = (name: string): JSONContent => JSON.parse(readFileSync(join(DIR, name), 'utf8'))
const write = (name: string, doc: JSONContent) => writeFileSync(join(DIR, name), JSON.stringify(doc, null, 2) + '\n')

function saved(content: JSONContent) {
  const { unmount } = render(<NoteEditor content={content} findSpeaker={() => null} />)
  const editor = (screen.getByRole('textbox', { name: 'Notes' }) as HTMLElement & { editor: Editor }).editor
  const doc = editor.getJSON()
  unmount()
  return doc
}

describe('note fixtures shared with the backend', () => {
  test('there are fixtures', () => {
    expect(documents.length).toBeGreaterThan(5)
  })

  test.each(documents)('%s is the document the editor saves', name => {
    const doc = read(name)
    if (WRITE) write(name, saved(doc))
    else expect(saved(doc)).toEqual(doc)
  })

  test('the minutes of the stories are minutes.input.json', () => {
    const { speakers } = read('speakers.json') as { speakers: { id: string; handle: string | null }[] }
    const id = (handle: string) => speakers.find(speaker => speaker.handle === handle)!.id
    const doc = saved(minutesNote({ anna: id('anna.petrova'), mark: id('mark.ellis'), lena: id('lena.kovacs'), oliver: id('oliver.grant'), sofia: id('sofia') }))
    if (WRITE) write('minutes.input.json', doc)
    else expect(doc).toEqual(read('minutes.input.json'))
  })
})
