import type { Segment, Speaker, SpeakerCandidates, Transcript, TranscriptListItem } from '../types'
import { allHands, ALL_HANDS_ITEM } from './all-hands'
import { longRecording, LONG_RECORDING_ITEM } from './long-recording'
import { CANDIDATES, DESIGN_REVIEW_CANDIDATES, DESIGN_REVIEW_ID, designReview, PLANNING_CALL, PLANNING_CALL_ITEM, SPEAKER_IDS, SPEAKERS, TRANSCRIPTS, WEEKLY_SYNC_ID, weeklySync } from './data'

export type FixtureData = {
  transcripts: TranscriptListItem[]
  details: Transcript[]
  speakers: Speaker[]
  candidates: Record<number, SpeakerCandidates>
}

// The states of the Editor data the boards differ by; the other boards show
// the same data with another UI state.
export type FixtureBoard = 'review' | 'reviewDone' | 'unassigned' | 'longRecording' | 'speakerCounts'

const { anna, mark, oliver, sofia, lena } = SPEAKER_IDS

const isUnknown1 = (segment: Segment) => segment.speaker_resolved === SPEAKER_IDS.unknown1

const withWeeklySync = (segments: (all: Segment[]) => Segment[], candidates: SpeakerCandidates, speakers?: string[]): FixtureData => ({
  transcripts: speakers ? TRANSCRIPTS.map(t => (t.id === WEEKLY_SYNC_ID ? { ...t, speakers } : t)) : TRANSCRIPTS,
  details: [weeklySync(segments(weeklySync().segments)), designReview()],
  speakers: SPEAKERS,
  candidates: { [WEEKLY_SYNC_ID]: candidates, [DESIGN_REVIEW_ID]: DESIGN_REVIEW_CANDIDATES },
})

export const BOARDS: Record<FixtureBoard, FixtureData> = {
  // Speakers / Review, Review / Possible match, Review closed and the Transcript boards.
  review: withWeeklySync(all => all, CANDIDATES),
  // Speakers / Done: Unknown speaker 1 turned out to be Mark.
  reviewDone: withWeeklySync(
    all => all.map(s => (isUnknown1(s) ? { ...s, speaker_resolved: SPEAKER_IDS.mark } : s)),
    {},
    [mark, anna, oliver, sofia, lena],
  ),
  // Transcript / Unassigned.
  unassigned: withWeeklySync(
    all => all.map(s => (isUnknown1(s) ? { ...s, speaker_resolved: null, unassigned: true } : s)),
    // Unassigned segments may mix voices, so they get no candidates.
    Object.fromEntries(Object.entries(CANDIDATES).filter(([id]) => id !== SPEAKER_IDS.unknown1)),
    [anna, mark, oliver, lena, sofia],
  ),
  // Not on a board: three hours, to scroll through. Made when asked for.
  get longRecording() {
    return {
      transcripts: [LONG_RECORDING_ITEM, ...TRANSCRIPTS],
      details: [longRecording(), weeklySync()],
      speakers: SPEAKERS,
      candidates: {},
    }
  },
  // Not on a board: recordings with 2, 6 and 15 speakers, for the room of the rows.
  speakerCounts: {
    transcripts: [ALL_HANDS_ITEM, PLANNING_CALL_ITEM, ...TRANSCRIPTS],
    details: [allHands(), PLANNING_CALL, weeklySync(), designReview()],
    speakers: SPEAKERS,
    candidates: { [WEEKLY_SYNC_ID]: CANDIDATES, [DESIGN_REVIEW_ID]: DESIGN_REVIEW_CANDIDATES },
  },
}
