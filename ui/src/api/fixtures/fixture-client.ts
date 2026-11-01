import { ApiError, type ApiClient, type SpeakerAssignment } from '../client'
import { effectiveSpeaker, type QueueSnapshot, type QueueUpdate, type Speaker } from '../types'
import { BOARDS, type FixtureBoard, type FixtureData } from './boards'
import { queueSnapshot } from './data'
import type { EventScript } from './event-scripts'

export type FixtureScenario = 'default' | 'loading' | 'empty' | 'error'

export type FixtureOptions = {
  scenario?: FixtureScenario
  board?: FixtureBoard
  // One method behaving differently, e.g. a failing save on a loaded screen.
  overrides?: Partial<ApiClient>
}

export type FixtureClient = ApiClient & {
  // Plays the script from now on. Returns what stops it.
  playEvents(script: EventScript): () => void
}

const EMPTY: FixtureData = { transcripts: [], details: [], speakers: [], candidates: {} }

// The same interface as the backend client, on data kept in memory. Each client
// has its own copy, so stories and tests do not see each other's changes.
export function createFixtureClient({ scenario = 'default', board = 'review', overrides = {} }: FixtureOptions = {}): FixtureClient {
  const data = structuredClone(scenario === 'empty' ? EMPTY : BOARDS[board])
  let queue: QueueSnapshot = queueSnapshot()
  const listeners = new Set<(event: QueueUpdate) => void>()

  // Every call goes through here, so the scenario covers all of them. Results
  // are copies: only the client's own methods change its data.
  const answer = <T>(read: () => T): Promise<T> => {
    if (scenario === 'loading') return new Promise(() => {})
    if (scenario === 'error') return Promise.reject(new ApiError(500, 'Server error 500'))
    try {
      return Promise.resolve(structuredClone(read()))
    } catch (err) {
      return Promise.reject(err)
    }
  }

  const transcript = (id: number) => {
    const found = data.details.find(t => t.id === id)
    if (!found) throw new ApiError(404, 'Transcript not found')
    return found
  }
  const listItem = (id: number) => data.transcripts.find(t => t.id === id)
  const segmentAt = (id: number, start: number) => {
    const found = transcript(id).segments.find(s => s.start === start)
    if (!found) throw new ApiError(404, 'Segment not found')
    return found
  }
  const speaker = (id: string) => {
    const found = data.speakers.find(s => s.id === id)
    if (!found) throw new ApiError(404, 'Speaker not found')
    return found
  }

  const resolveTarget = (target: SpeakerAssignment['target']): string => {
    if ('id' in target) return speaker(target.id).id
    const created: Speaker = {
      id: crypto.randomUUID(),
      name: target.name,
      color_index: target.colorIndex ?? 0,
      segments: 0,
      transcripts: 1,
      duration_sec: 0,
      last_seen: new Date().toISOString(),
    }
    data.speakers.push(created)
    return created.id
  }

  const assign = (assignment: SpeakerAssignment) => {
    const { transcriptId } = assignment
    const speakerId = resolveTarget(assignment.target)
    const changed = 'segmentStart' in assignment
      ? [segmentAt(transcriptId, assignment.segmentStart)]
      : transcript(transcriptId).segments.filter(s => effectiveSpeaker(s) === assignment.fromSpeakerId)
    const from = new Set(changed.map(effectiveSpeaker))
    for (const segment of changed) {
      segment.speaker_final = speakerId
      segment.unassigned = false
    }
    const left = new Set(transcript(transcriptId).segments.map(effectiveSpeaker))
    const candidates = data.candidates[transcriptId] ?? {}
    // A speaker with no segments left has nothing to review.
    for (const id of from) if (!left.has(id)) delete candidates[id]
    const item = listItem(transcriptId)
    if (item) item.speakers = [...left]
  }

  const emit = (event: QueueUpdate) => {
    if (event.type === 'snapshot') queue = event
    for (const listener of listeners) listener(structuredClone(event))
  }

  const client: ApiClient = {
    listTranscripts: () => answer(() => data.transcripts),
    getTranscript: id => answer(() => transcript(id)),
    updateTranscriptTitle: (id, title) => answer(() => {
      transcript(id).title = title
      const item = listItem(id)
      if (item) item.title = title
    }),
    deleteTranscript: id => answer(() => {
      transcript(id)
      data.details = data.details.filter(t => t.id !== id)
      data.transcripts = data.transcripts.filter(t => t.id !== id)
    }),
    updateSegmentText: (id, start, text) => answer(() => {
      segmentAt(id, start).text = text
    }),
    deleteSegment: (id, start) => answer(() => {
      const found = transcript(id)
      segmentAt(id, start)
      found.segments = found.segments.filter(s => s.start !== start)
    }),
    assignSpeaker: assignment => answer(() => assign(assignment)),
    getSpeakerCandidates: id => answer(() => {
      transcript(id)
      return data.candidates[id] ?? {}
    }),
    listSpeakers: () => answer(() => data.speakers),
    updateSpeaker: (id, update) => answer(() => {
      const found = speaker(id)
      if (update.name != null) found.name = update.name
      if (update.color_index != null) found.color_index = update.color_index
      return found
    }),
    getSpeakerSample: (id, transcriptId) => answer(() => {
      speaker(id)
      const source = data.details.filter(t => transcriptId === undefined || t.id === transcriptId)
      for (const t of source) {
        const found = t.segments.find(s => effectiveSpeaker(s) === id)
        if (found) return { transcript_id: t.id, audio_path: t.audio_path, start: found.start, end: found.end, text: found.text }
      }
      throw new ApiError(404, 'No audio available for this speaker')
    }),
    getQueue: () => answer(() => queue),
    subscribeQueueEvents: listener => {
      listeners.add(listener)
      // A real connection answers later too, never during the subscribe. Stays
      // silent when the scenario says the backend is not there.
      const hello = scenario === 'default' || scenario === 'empty'
        ? setTimeout(() => listener(structuredClone(queue)), 0)
        : undefined
      return () => {
        clearTimeout(hello)
        listeners.delete(listener)
      }
    },
  }

  return {
    ...client,
    ...overrides,
    playEvents: script => {
      let timer: ReturnType<typeof setTimeout>
      const play = (index: number) => {
        const step = script.steps[index]
        if (!step) return
        timer = setTimeout(() => {
          if (step.event.type === 'job_done' && script.result) {
            data.transcripts = [structuredClone(script.result.item), ...data.transcripts]
            data.details.push(structuredClone(script.result.transcript))
          }
          emit(step.event)
          play(index + 1)
        }, step.afterMs)
      }
      play(0)
      return () => clearTimeout(timer)
    },
  }
}
