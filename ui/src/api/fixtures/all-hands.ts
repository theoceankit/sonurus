import type { Segment, Transcript, TranscriptListItem } from '../types'
import { SPEAKER_IDS } from './data'

export const ALL_HANDS_ID = 1001

const { anna, mark, lena, priya, oliver, sofia, olga, daniel, emma, hugo, ines, jonas, kate, unknown1, unknown2 } = SPEAKER_IDS

// Fifteen speakers, two of them with no name: more than the inspector holds in
// most windows. Each speaks a little less than the one before.
const SPEAKERS = [anna, mark, unknown1, lena, priya, oliver, sofia, olga, daniel, unknown2, emma, hugo, ines, jonas, kate]

function allHandsSegments(): Segment[] {
  const segments: Segment[] = []
  let start = 0
  for (let round = 0; round < 3; round++) {
    SPEAKERS.forEach((speaker, i) => {
      const end = start + SPEAKERS.length - i
      segments.push({
        start,
        end,
        text: `A word from speaker ${i + 1} in round ${round + 1}.`,
        speaker_raw: `SPEAKER_${String(i).padStart(2, '0')}`,
        speaker_resolved: speaker,
        speaker_final: null,
        unassigned: false,
      })
      start = end
    })
  }
  return segments
}

export const ALL_HANDS_ITEM: TranscriptListItem = {
  id: ALL_HANDS_ID,
  title: 'All hands',
  created_at: '2026-10-05T10:00:00',
  status: 'done',
  opened: true,
  speakers: SPEAKERS,
  section: 'Today',
  duration: '6 min',
}

export const allHands = (): Transcript => ({
  id: ALL_HANDS_ID,
  audio_path: '/fixtures/all-hands.wav',
  language: 'en',
  status: 'done',
  title: ALL_HANDS_ITEM.title,
  segments: allHandsSegments(),
})
