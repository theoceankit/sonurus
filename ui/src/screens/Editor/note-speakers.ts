import type { Speaker } from '../../api/types'
import type { MentionCandidate } from '../../components/MentionList/mention-list'
import type { FindSpeaker } from '../../components/NoteEditor/note-extensions'
import { speakerColor } from '../../styles/speaker-colors'

// Named speakers only: someone without a name is no one to mention yet.
export const mentionCandidates = (speakers: readonly Speaker[], inRecording: readonly string[]): MentionCandidate[] =>
  speakers.flatMap(speaker => (speaker.name
    ? [{ id: speaker.id, name: speaker.name, handle: speaker.handle, color: speakerColor(speaker.color_index), photo: speaker.photo_url, inRecording: inRecording.includes(speaker.id) }]
    : []))

// A speaker of a note as they are now, null once deleted or without a name.
export const speakerFinder = (speakers: readonly Speaker[]): FindSpeaker => id => {
  const speaker = speakers.find(candidate => candidate.id === id)
  return speaker?.name ? { name: speaker.name, color: speakerColor(speaker.color_index), photo: speaker.photo_url, handle: speaker.handle } : null
}
