import { effectiveSpeaker, TITLE_MAX_LENGTH, UNASSIGNED, type Segment, type Speaker, type Transcript } from '../../api/types'
import { formatClock, formatDuration } from '../../media/timeline'
import { speakerColor, type SpeakerColor } from '../../styles/speaker-colors'

const GRAY: SpeakerColor = 6

export interface TurnSpeaker {
  id: string
  kind: 'named' | 'unknown' | 'unassigned'
  name: string
  color: SpeakerColor
}

// Neighbouring segments of one speaker, shown as one turn. Each stays a paragraph:
// the API edits, plays and deletes segments, and a turn is only how they are shown.
export interface TranscriptTurn {
  speaker: TurnSpeaker
  start: number
  segments: Segment[]
}

const namedSpeaker = (known: ReadonlyMap<string, Speaker>, id: string) => (known.get(id)?.name ? known.get(id) : undefined)

// Speakers with no name, numbered in the order they first speak.
export function unknownSpeakerNames(segments: readonly Segment[], speakers: readonly Speaker[]): Map<string, string> {
  const known = new Map(speakers.map(speaker => [speaker.id, speaker]))
  const names = new Map<string, string>()
  for (const segment of segments) {
    const id = effectiveSpeaker(segment)
    if (id !== UNASSIGNED && !namedSpeaker(known, id) && !names.has(id)) names.set(id, `Unknown speaker ${names.size + 1}`)
  }
  return names
}

export function buildTurns(segments: readonly Segment[], speakers: readonly Speaker[]): TranscriptTurn[] {
  const known = new Map(speakers.map(speaker => [speaker.id, speaker]))
  const unknown = unknownSpeakerNames(segments, speakers)

  const describe = (id: string): TurnSpeaker => {
    if (id === UNASSIGNED) return { id, kind: 'unassigned', name: 'Unassigned', color: GRAY }
    const found = namedSpeaker(known, id)
    return found
      ? { id, kind: 'named', name: found.name!, color: speakerColor(found.color_index) }
      : { id, kind: 'unknown', name: unknown.get(id)!, color: GRAY }
  }

  const turns: TranscriptTurn[] = []
  for (const segment of segments) {
    const id = effectiveSpeaker(segment)
    const last = turns.at(-1)
    if (last?.speaker.id === id) last.segments.push(segment)
    else turns.push({ speaker: describe(id), start: segment.start, segments: [segment] })
  }
  return turns
}

// The whole transcript as plain text, as the Editor shows it: each turn its speaker
// and start time, then a line per paragraph, turns apart by an empty line.
export function transcriptText(turns: readonly TranscriptTurn[]): string {
  return turns
    .map(turn => [`${turn.speaker.name} ${formatClock(turn.start)}`, ...turn.segments.map(segment => segment.text)].join('\n'))
    .join('\n\n')
}

export function talkTimes(segments: readonly Segment[]): Map<string, number> {
  const times = new Map<string, number>()
  for (const segment of segments) {
    const id = effectiveSpeaker(segment)
    times.set(id, (times.get(id) ?? 0) + segment.end - segment.start)
  }
  return times
}

export interface SpeakerMenuRow {
  speaker: Speaker
  current: boolean
  // How long they speak in this recording.
  time?: string
  // Names are not unique: this tells speakers with one name apart.
  usage?: string
}

const plural = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`

// What the speaker menu offers: only speakers with a name can take over a turn.
// Without a search these are the ones of this recording, the longest first.
export function speakerMenuRows(
  speakers: readonly Speaker[],
  times: ReadonlyMap<string, number>,
  currentId: string | null,
  query: string,
): { section: string | null; rows: SpeakerMenuRow[] } {
  const named = speakers.filter(speaker => speaker.name)
  const search = query.trim().toLowerCase()
  const found = search
    ? named.filter(speaker => speaker.name!.toLowerCase().includes(search))
    : named.filter(speaker => times.has(speaker.id)).sort((a, b) => times.get(b.id)! - times.get(a.id)!)
  const counts = new Map<string, number>()
  for (const { name } of named) counts.set(name!, (counts.get(name!) ?? 0) + 1)

  const time = (id: string) => (times.has(id) ? formatDuration(times.get(id)!) : undefined)
  const rows = found.map(speaker => ({
    speaker,
    current: speaker.id === currentId,
    time: time(speaker.id),
    usage: counts.get(speaker.name!)! > 1 ? `${plural(speaker.transcripts, 'transcript')}, ${formatDuration(speaker.duration_sec)}` : undefined,
  }))
  rows.sort((a, b) => Number(!times.has(a.speaker.id)) - Number(!times.has(b.speaker.id)))
  return { section: search ? null : 'In this recording', rows }
}

// The title to send, or null when there is nothing to save.
export function titleToSave(raw: string, current: string): string | null {
  const title = raw.trim()
  if (!title || title === current || title.length > TITLE_MAX_LENGTH) return null
  return title
}

const fileTitle = (path: string) => (path.split(/[\\/]/).pop() ?? '').replace(/\.[^.]+$/, '').replace(/[_-]/g, ' ')

export const recordingTitle = (transcript: Pick<Transcript, 'title' | 'audio_path'>, listed: string | undefined) =>
  transcript.title || listed || fileTitle(transcript.audio_path)

const LANGUAGE_NAMES: Record<string, string> = {
  en: 'English', ru: 'Русский', es: 'Español', de: 'Deutsch', fr: 'Français', uk: 'Українська', zh: '中文', ja: '日本語',
}

export function languageLabel(language: string | null | undefined): string {
  if (!language || language === 'auto' || language.toLowerCase() === 'unknown') return ''
  return LANGUAGE_NAMES[language] ?? language
}

export function formatRecordingDate(iso: string | undefined): string {
  if (!iso) return ''
  const date = new Date(iso)
  if (Number.isNaN(date.getTime())) return ''
  const pad = (value: number) => String(value).padStart(2, '0')
  const month = date.toLocaleDateString('en-US', { month: 'short' })
  return `${date.getDate()} ${month} ${date.getFullYear()}, ${pad(date.getHours())}:${pad(date.getMinutes())}`
}
