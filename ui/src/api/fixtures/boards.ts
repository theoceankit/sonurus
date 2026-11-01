import type { Segment, Speaker, SpeakerCandidates, Transcript, TranscriptListItem } from '../types'
import { CANDIDATES, SPEAKER_IDS, SPEAKERS, TRANSCRIPTS, WEEKLY_SYNC_ID, weeklySync } from './data'

export type FixtureData = {
  transcripts: TranscriptListItem[]
  details: Transcript[]
  speakers: Speaker[]
  candidates: Record<number, SpeakerCandidates>
}

// The states of the Editor data the boards differ by; the other boards show
// the same data with another UI state.
export type FixtureBoard = 'review' | 'reviewDone' | 'unassigned'

const isUnknown1 = (segment: Segment) => segment.speaker_resolved === SPEAKER_IDS.unknown1

const withWeeklySync = (segments: (all: Segment[]) => Segment[], candidates: SpeakerCandidates): FixtureData => ({
  transcripts: TRANSCRIPTS,
  details: [weeklySync(segments(weeklySync().segments))],
  speakers: SPEAKERS,
  candidates: { [WEEKLY_SYNC_ID]: candidates },
})

export const BOARDS: Record<FixtureBoard, FixtureData> = {
  // Speakers / Review, Review / Possible match, Review closed and the Transcript boards.
  review: withWeeklySync(all => all, CANDIDATES),
  // Speakers / Done: Unknown speaker 1 turned out to be Mark.
  reviewDone: withWeeklySync(
    all => all.map(s => (isUnknown1(s) ? { ...s, speaker_final: SPEAKER_IDS.mark } : s)),
    {},
  ),
  // Transcript / Unassigned.
  unassigned: withWeeklySync(
    all => all.map(s => (isUnknown1(s) ? { ...s, unassigned: true } : s)),
    CANDIDATES,
  ),
}
