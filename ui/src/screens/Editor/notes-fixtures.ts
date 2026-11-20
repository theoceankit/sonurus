import { SPEAKER_IDS } from '../../api/fixtures/data'
import type { Speaker } from '../../api/types'
import type { MentionCandidate } from '../../components/MentionList/mention-list'
import type { FindSpeaker } from '../../components/NoteEditor/note-extensions'
import { minutesNote } from '../../components/NoteEditor/note-samples'
import { speakerColor } from '../../styles/speaker-colors'

// Notes are not stored yet: the note of the weekly sync, for the stories of the Editor.
export const WEEKLY_SYNC_MINUTES = minutesNote(SPEAKER_IDS)

// Named speakers only: someone without a name is no one to mention yet.
export const mentionCandidates = (speakers: readonly Speaker[], inRecording: readonly string[]): MentionCandidate[] =>
  speakers.flatMap(speaker => (speaker.name
    ? [{ id: speaker.id, name: speaker.name, handle: speaker.handle, color: speakerColor(speaker.color_index), photo: speaker.photo_url, inRecording: inRecording.includes(speaker.id) }]
    : []))

export const speakerFinder = (speakers: readonly Speaker[]): FindSpeaker => id => {
  const speaker = speakers.find(candidate => candidate.id === id)
  return speaker?.name ? { name: speaker.name, color: speakerColor(speaker.color_index), photo: speaker.photo_url, handle: speaker.handle } : null
}
