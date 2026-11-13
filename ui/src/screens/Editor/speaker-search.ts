import type { Speaker, SpeakerCandidate } from '../../api/types'

export type SpeakerCategory = 'all' | 'best' | 'recording'

export interface SpeakerChoice {
  id: string
  name: string
  handle?: string | null
  colorIndex: number
  score?: number
  suggested?: boolean
  usage?: string
}

export interface ChooseSpeakerSection {
  title: string
  rows: SpeakerChoice[]
}

interface ChooseSpeakerQuery {
  speakers: readonly Speaker[]
  candidates: readonly SpeakerCandidate[]
  // Everyone speaking in this recording.
  recordingSpeakers: readonly string[]
  query: string
  category: SpeakerCategory
}

const usage = (recordings: number) => `${recordings} ${recordings === 1 ? 'recording' : 'recordings'}`

const choice = (speaker: Speaker): SpeakerChoice => (
  { id: speaker.id, name: speaker.name!, handle: speaker.handle, colorIndex: speaker.color_index, usage: usage(speaker.transcripts) }
)

// Only speakers with a name can be chosen, and a search looks at the name and the
// handle (a leading @ in it is left out).
export function chooseSpeakerList({ speakers, candidates, recordingSpeakers, query, category }: ChooseSpeakerQuery) {
  const search = query.trim().toLowerCase().replace(/^@+/, '')
  const named = speakers.filter(speaker => !!speaker.name && (speaker.name.toLowerCase().includes(search) || (speaker.handle ?? '').includes(search)))
  const known = new Map(named.map(speaker => [speaker.id, speaker]))

  const best = candidates.flatMap((candidate): SpeakerChoice[] => {
    const speaker = known.get(candidate.speaker_id)
    return speaker ? [{ id: speaker.id, name: speaker.name!, handle: speaker.handle, colorIndex: speaker.color_index, score: candidate.score, suggested: candidate.suggested }] : []
  })
  const others = named.filter(speaker => !best.some(row => row.id === speaker.id)).map(choice)
  const inRecording = named.filter(speaker => recordingSpeakers.includes(speaker.id)).map(choice)

  const sections: ChooseSpeakerSection[] = category === 'recording'
    ? [{ title: 'Already in this recording', rows: inRecording }]
    : [
        { title: 'Best voice matches', rows: best },
        ...(category === 'all' ? [{ title: 'Other speakers', rows: others }] : []),
      ]

  return {
    counts: { all: named.length, best: best.length, recording: inRecording.length },
    sections: sections.filter(section => section.rows.length > 0),
  }
}

export const preselectedSpeaker = (chosen: string | null, candidates: readonly SpeakerCandidate[]) =>
  chosen ?? candidates.find(candidate => candidate.suggested)?.speaker_id ?? null
