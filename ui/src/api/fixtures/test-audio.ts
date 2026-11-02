import { effectiveSpeaker, type Segment } from '../types'

const SAMPLE_RATE = 8000
const LOUDNESS = 0.2
const FADE_SECONDS = 0.01
// A tone per speaker, in order of appearance, so a jump to the next speaker can be heard.
const TONES = [220, 277, 330, 392, 466, 554]

// One tone for each segment and silence in the pauses. A segment wins over the one
// that overlaps it and starts later, as on the timeline.
export function synthesize(segments: readonly Segment[]): Int16Array {
  const end = segments.reduce((last, segment) => Math.max(last, segment.end), 0)
  const samples = new Int16Array(Math.ceil(end * SAMPLE_RATE))
  const speakers = [...new Set(segments.map(effectiveSpeaker))]
  for (const segment of [...segments].reverse()) {
    const tone = TONES[speakers.indexOf(effectiveSpeaker(segment)) % TONES.length]
    const first = Math.floor(segment.start * SAMPLE_RATE)
    const last = Math.min(samples.length, Math.floor(segment.end * SAMPLE_RATE))
    for (let i = first; i < last; i++) {
      const fade = Math.min(1, (i - first) / (FADE_SECONDS * SAMPLE_RATE), (last - i) / (FADE_SECONDS * SAMPLE_RATE))
      samples[i] = Math.round(Math.sin((2 * Math.PI * tone * i) / SAMPLE_RATE) * fade * LOUDNESS * 0x7fff)
    }
  }
  return samples
}

const HEADER_BYTES = 44

// 16-bit mono PCM in a WAV container.
export function encodeWav(samples: Int16Array): ArrayBuffer {
  const dataBytes = samples.length * 2
  const buffer = new ArrayBuffer(HEADER_BYTES + dataBytes)
  const view = new DataView(buffer)
  const text = (offset: number, value: string) => [...value].forEach((char, i) => view.setUint8(offset + i, char.charCodeAt(0)))
  text(0, 'RIFF')
  view.setUint32(4, HEADER_BYTES - 8 + dataBytes, true)
  text(8, 'WAVEfmt ')
  view.setUint32(16, 16, true)
  view.setUint16(20, 1, true)
  view.setUint16(22, 1, true)
  view.setUint32(24, SAMPLE_RATE, true)
  view.setUint32(28, SAMPLE_RATE * 2, true)
  view.setUint16(32, 2, true)
  view.setUint16(34, 16, true)
  text(36, 'data')
  view.setUint32(40, dataBytes, true)
  samples.forEach((sample, i) => view.setInt16(HEADER_BYTES + i * 2, sample, true))
  return buffer
}

// Made in memory, so fixtures have audio with no file and no request.
export const createTestAudioUrl = (segments: readonly Segment[]) =>
  URL.createObjectURL(new Blob([encodeWav(synthesize(segments))], { type: 'audio/wav' }))
