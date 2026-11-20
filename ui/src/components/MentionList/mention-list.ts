import type { SpeakerColor } from '../../styles/speaker-colors'

// A named speaker that can be mentioned.
export interface MentionCandidate {
  id: string
  name: string
  handle?: string | null
  color: SpeakerColor
  photo?: string | null
  // Speaks in the recording the note belongs to.
  inRecording: boolean
}

export type MentionOption =
  | { kind: 'speaker'; speaker: MentionCandidate }
  // A person who is not in the base, under the name as typed.
  | { kind: 'person'; name: string }

export interface MentionSection {
  title: string
  options: MentionOption[]
}

// The speakers of this recording first, then everyone else; a search looks at the
// name and the handle, a leading @ left out. With something typed, the last option
// mentions it as it is.
export function mentionList(candidates: readonly MentionCandidate[], query: string): { sections: MentionSection[]; options: MentionOption[] } {
  const typed = query.trim()
  const search = typed.toLowerCase().replace(/^@+/, '')
  const found = candidates.filter(speaker => speaker.name.toLowerCase().includes(search) || (speaker.handle ?? '').toLowerCase().includes(search))
  const speakers = (inRecording: boolean): MentionOption[] =>
    found.filter(speaker => speaker.inRecording === inRecording).map(speaker => ({ kind: 'speaker', speaker }))
  const sections: MentionSection[] = [
    { title: 'In this recording', options: speakers(true) },
    { title: 'Other speakers', options: speakers(false) },
    ...(typed ? [{ title: '', options: [{ kind: 'person', name: typed } as MentionOption] }] : []),
  ].filter(section => section.options.length > 0)
  return { sections, options: sections.flatMap(section => section.options) }
}
