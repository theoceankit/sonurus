import type { Speaker } from '../../api/types'
import type { MentionCandidate } from '../../components/MentionList/mention-list'
import type { FindSpeaker } from '../../components/NoteEditor/note-extensions'
import { speakerColor } from '../../styles/speaker-colors'

// Named speakers only: someone without a name is no one to mention yet. Those who
// speak in the recording come first, as they first speak there (inRecording is in
// that order); the rest as the list has them.
export const mentionCandidates = (speakers: readonly Speaker[], inRecording: readonly string[]): MentionCandidate[] => {
  const order = (id: string) => {
    const at = inRecording.indexOf(id)
    return at === -1 ? inRecording.length : at
  }
  return speakers
    .filter(speaker => speaker.name)
    .map((speaker, index) => ({ speaker, index }))
    .sort((a, b) => order(a.speaker.id) - order(b.speaker.id) || a.index - b.index)
    .map(({ speaker }) => ({ id: speaker.id, name: speaker.name!, handle: speaker.handle, color: speakerColor(speaker.color_index), photo: speaker.photo_url, inRecording: inRecording.includes(speaker.id) }))
}

// A speaker of a note as they are now; a voice with no name yet only says so; null once deleted.
export const speakerFinder = (speakers: readonly Speaker[]): FindSpeaker => id => {
  const speaker = speakers.find(candidate => candidate.id === id)
  if (!speaker) return null
  return speaker.name ? { name: speaker.name, color: speakerColor(speaker.color_index), photo: speaker.photo_url, handle: speaker.handle } : { name: null }
}
