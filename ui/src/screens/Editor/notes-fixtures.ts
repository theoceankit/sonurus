import { SPEAKER_IDS } from '../../api/fixtures/data'
import { minutesNote } from '../../components/NoteEditor/note-samples'

export { mentionCandidates, speakerFinder } from './note-speakers'

// The note of the weekly sync with every chip, for the stories of the Editor's notes.
export const WEEKLY_SYNC_MINUTES = minutesNote(SPEAKER_IDS)
