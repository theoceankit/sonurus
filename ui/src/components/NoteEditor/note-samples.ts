import type { JSONContent } from '@tiptap/react'
import type { MentionCandidate } from '../MentionList/mention-list'
import { mention, paragraph, quoteBlock, text, timecode } from './note-content'
import type { FindSpeaker } from './note-extensions'

// Minutes of the weekly sync, for stories: every kind of Markdown, both chips, a
// person not in the base and a speaker deleted since.
export interface SampleIds { anna: string; mark: string; lena: string; oliver: string; sofia: string }

const heading = (level: number, value: string): JSONContent => ({ type: 'heading', attrs: { level }, content: [text(value)] })
const item = (...content: JSONContent[]): JSONContent => ({ type: 'listItem', content: [paragraph(...content)] })
const task = (checked: boolean, ...content: JSONContent[]): JSONContent => ({ type: 'taskItem', attrs: { checked }, content: [paragraph(...content)] })
const speaker = (id: string, label: string) => mention({ kind: 'speaker', id, label })

export const minutesNote = (ids: SampleIds): JSONContent => ({
  type: 'doc',
  content: [
    heading(1, 'Weekly product sync'),
    paragraph(
      text('With '), speaker(ids.anna, 'Anna'), text(' '), speaker(ids.mark, 'Mark'), text(' '), speaker(ids.lena, 'Lena'),
      text(' and '), mention({ kind: 'person', label: 'Sam from support' }), text('. Friday\'s release went out without crashes.'),
    ),
    heading(2, 'Decisions'),
    {
      type: 'bulletList',
      content: [
        item(text('Ship the import fix '), text('before', [{ type: 'bold' }]), text(' the redesign '), timecode(16)),
        item(text('One button style for the editor and settings, ask '), text('the design team', [{ type: 'link', attrs: { href: 'mailto:design@example.com' } }])),
        item(text('Retry for failed jobs is '), text('good enough', [{ type: 'italic' }]), text(' for now')),
      ],
    },
    heading(2, 'Action items'),
    {
      type: 'taskList',
      content: [
        task(false, speaker(ids.oliver, 'Oliver'), text(' checks the numbers by Friday '), timecode(31)),
        task(true, speaker(ids.sofia, 'Sofia'), text(' picks up the button styles '), timecode(44)),
        task(false, speaker('a0000000-0000-4000-8000-000000000000', 'Pat Old'), text(' sends the old import logs')),
      ],
    },
    heading(3, 'Import, in order'),
    {
      type: 'orderedList',
      attrs: { start: 1 },
      content: [item(text('Copy large files in the background')), item(text('Show the copy in the queue'))],
    },
    quoteBlock({ speaker: { kind: 'speaker', id: ids.anna, label: 'Anna' }, start: 10, text: 'What about the import flow? I saw a couple of complaints about large files.' }),
    paragraph(text('Next sync: ')),
  ],
})

// People for component stories: the recording's five, then two from elsewhere.
export const SAMPLE_IDS: SampleIds = { anna: 'anna', mark: 'mark', lena: 'lena', oliver: 'oliver', sofia: 'sofia' }
export const SAMPLE_CANDIDATES: MentionCandidate[] = [
  { id: 'anna', name: 'Anna Petrova', handle: 'anna', color: 5, inRecording: true },
  { id: 'mark', name: 'Mark Ellis', handle: 'mark', color: 1, inRecording: true },
  { id: 'lena', name: 'Lena Kovacs', handle: 'lena', color: 4, inRecording: true },
  { id: 'oliver', name: 'Oliver Grant', handle: 'oliver', color: 3, inRecording: true },
  { id: 'sofia', name: 'Sofia Ramos', handle: 'sofia', color: 2, inRecording: true },
  { id: 'daniel', name: 'Daniel Brooks', handle: 'daniel', color: 4, inRecording: false },
  { id: 'hanna', name: 'Hanna Lind', handle: 'hanna', color: 2, inRecording: false },
]
export const findSampleSpeaker: FindSpeaker = id => SAMPLE_CANDIDATES.find(candidate => candidate.id === id) ?? null
