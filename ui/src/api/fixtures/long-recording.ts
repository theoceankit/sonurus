import type { Segment, Transcript, TranscriptListItem } from '../types'
import { SPEAKER_IDS } from './data'

const LONG_RECORDING_ID = 1000
const THREE_HOURS = 3 * 60 * 60

const PHRASES = [
  "Okay, let's get started with the next part of the agenda.",
  'Right, and so far nobody has reported a crash after the release we shipped on Friday.',
  'Files over two hours took a long time to copy before the job even started, so we looked at that first.',
  'I would like to fix that before the big redesign.',
  'Let me check the numbers and get back to you by Friday.',
  'That matches what I saw in the queue, although the second run was a lot faster than the first one, and I am not sure why yet.',
  'Great, thanks.',
  'One more thing from design: the editor and the settings page use different button styles, and we keep getting questions about which one is right.',
]

// A little generator of its own, so the recording is the same on every run.
function randoms(seed: number) {
  let state = seed
  return () => {
    state = (state * 1664525 + 1013904223) % 2 ** 32
    return state / 2 ** 32
  }
}

// Three hours of a meeting at the pace of the boards: about 3600 segments, and a
// speaker keeps the word for one to six of them.
export function longSegments(): Segment[] {
  const random = randoms(135)
  const speakers = [SPEAKER_IDS.anna, SPEAKER_IDS.mark, SPEAKER_IDS.unknown1, SPEAKER_IDS.oliver, SPEAKER_IDS.lena, SPEAKER_IDS.sofia]
  const segments: Segment[] = []
  let time = 0
  let speaker = 0
  let left = 0
  while (time < THREE_HOURS) {
    if (left === 0) {
      speaker = (speaker + 1 + Math.floor(random() * (speakers.length - 1))) % speakers.length
      left = 1 + Math.floor(random() * 6)
    }
    left--
    const length = Math.round((1 + random() * 3.5) * 100) / 100
    const end = Math.round((time + length) * 100) / 100
    segments.push({
      start: time,
      end,
      text: PHRASES[Math.floor(random() * PHRASES.length)],
      speaker_raw: `SPEAKER_0${speaker}`,
      speaker_resolved: speakers[speaker],
      speaker_final: null,
      unassigned: false,
    })
    time = Math.round((end + (random() < 0.1 ? random() * 2 : 0)) * 100) / 100
  }
  return segments
}

export const LONG_RECORDING_ITEM: TranscriptListItem = {
  id: LONG_RECORDING_ID,
  title: 'Long recording, 3 hours',
  created_at: '2026-10-05T09:00:00',
  status: 'done',
  speakers: [SPEAKER_IDS.anna, SPEAKER_IDS.mark, SPEAKER_IDS.unknown1, SPEAKER_IDS.oliver, SPEAKER_IDS.lena, SPEAKER_IDS.sofia],
  section: 'Today',
  duration: '180 min',
}

export const longRecording = (): Transcript => ({
  id: LONG_RECORDING_ID,
  audio_path: '/fixtures/long-recording.wav',
  language: 'en',
  status: 'done',
  title: LONG_RECORDING_ITEM.title,
  segments: longSegments(),
})
