import { afterEach, describe, expect, test, vi } from 'vitest'
import { ApiError } from '../client'
import { effectiveSpeaker, UNASSIGNED, type QueueUpdate, type Segment } from '../types'
import { BOARDS } from './boards'
import { DESIGN_REVIEW_ID, QUEUE_JOB, queueSnapshot, SPEAKER_IDS, WEEKLY_SYNC_ID } from './data'
import { EVENT_SCRIPTS } from './event-scripts'
import type { ApiClient } from '../client'
import { createFixtureClient, NO_MODELS } from './fixture-client'
import { DEFAULT_INSTALLED } from './models'
import { ALIGNMENT_MODELS } from '../../transcribe/languages'

const { anna, mark, oliver, unknown1 } = SPEAKER_IDS
const talkTime = (segments: Segment[], id: string) =>
  segments.filter(s => effectiveSpeaker(s) === id).reduce((sum, s) => sum + s.end - s.start, 0)

afterEach(() => vi.useRealTimers())

const startsOf = async (client: ApiClient, id: string) =>
  (await client.getTranscript(WEEKLY_SYNC_ID)).segments.filter(s => effectiveSpeaker(s) === id).map(s => s.start)

describe('board data', () => {
  test('today is the day of the boards, whatever the clock says', () => {
    const now = createFixtureClient().now()
    expect([now.getFullYear(), now.getMonth(), now.getDate()]).toEqual([2026, 9, 5])
  })

  test('has the recordings and the speakers of the boards', async () => {
    const client = createFixtureClient()
    const transcripts = await client.listTranscripts()
    const speakers = await client.listSpeakers()
    expect(transcripts).toHaveLength(16)
    expect(new Set(transcripts.map(t => t.id)).size).toBe(16)
    expect(speakers.filter(s => s.name)).toHaveLength(13)
    expect(speakers.some(s => s.name === null)).toBe(true)
  })

  test('the talk times add up as on the review board', async () => {
    const { segments } = await createFixtureClient().getTranscript(WEEKLY_SYNC_ID)
    expect(talkTime(segments, anna)).toBe(19)
    expect(talkTime(segments, mark)).toBe(11)
    expect(talkTime(segments, unknown1)).toBe(9)
    expect(talkTime(segments, oliver)).toBe(7)
    expect(Math.max(...segments.map(s => s.end))).toBe(53)
  })

  test('every speaker in the data is known', () => {
    const known = new Set(BOARDS.review.speakers.map(s => s.id))
    for (const t of BOARDS.review.transcripts) for (const id of t.speakers) expect(known).toContain(id)
    for (const s of BOARDS.review.details[0].segments) expect(known).toContain(s.speaker_resolved)
  })

  test('speaker ids are UUID4', () => {
    for (const s of BOARDS.review.speakers) expect(s.id).toMatch(/^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/)
  })

  test('review: four speakers with candidates sorted by score, as on the card', async () => {
    const candidates = await createFixtureClient().getSpeakerCandidates(WEEKLY_SYNC_ID)
    expect(Object.keys(candidates)).toHaveLength(4)
    expect(candidates[unknown1].candidates.map(c => c.score)).toEqual([0.82, 0.41, 0.12])
    expect(candidates[oliver].candidates.map(c => c.score)).toEqual([0.64, 0.31, 0.18])
    for (const { candidates: list } of Object.values(candidates)) {
      expect(list.length).toBeLessThanOrEqual(3)
      expect(list).toEqual([...list].sort((a, b) => b.score - a.score))
    }
  })

  test('review: only the first candidate is suggested and every speaker has a clip', async () => {
    const candidates = await createFixtureClient().getSpeakerCandidates(WEEKLY_SYNC_ID)
    for (const { candidates: list, clip } of Object.values(candidates)) {
      expect(list.map(c => c.suggested)).toEqual([true, false, false])
      expect(clip?.end).toBeGreaterThan(clip?.start ?? Infinity)
    }
    expect(candidates[unknown1].clip).toMatchObject({ start: 16, end: 20 })
  })

  test('reviewDone: the unknown speaker is Mark and nothing is left to review', async () => {
    const client = createFixtureClient({ board: 'reviewDone' })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(talkTime(segments, mark)).toBe(20)
    expect(await client.getSpeakerCandidates(WEEKLY_SYNC_ID)).toEqual({})
  })

  test('unassigned: the segment shows as unassigned', async () => {
    const { segments } = await createFixtureClient({ board: 'unassigned' }).getTranscript(WEEKLY_SYNC_ID)
    expect(effectiveSpeaker(segments.find(s => s.start === 16)!)).toBe(UNASSIGNED)
  })
})

describe('scenarios', () => {
  test('loading never answers', async () => {
    const client = createFixtureClient({ scenario: 'loading' })
    const settled = vi.fn()
    client.listTranscripts().then(settled, settled)
    await new Promise(resolve => setTimeout(resolve, 10))
    expect(settled).not.toHaveBeenCalled()
  })

  test('empty has no rows and an idle queue', async () => {
    const client = createFixtureClient({ scenario: 'empty' })
    expect(await client.listTranscripts()).toEqual([])
    expect(await client.listSpeakers()).toEqual([])
    expect((await client.getQueue()).jobs).toEqual([])
    await expect(client.getTranscript(WEEKLY_SYNC_ID)).rejects.toMatchObject({ status: 404 })
  })

  test('error rejects reads and changes', async () => {
    const client = createFixtureClient({ scenario: 'error' })
    await expect(client.listTranscripts()).rejects.toBeInstanceOf(ApiError)
    await expect(client.updateTranscriptTitle(WEEKLY_SYNC_ID, 'x')).rejects.toMatchObject({ status: 500 })
  })

  test('an override changes one method', async () => {
    const client = createFixtureClient({
      overrides: { updateSegmentText: () => Promise.reject(new ApiError(409, 'Busy')) },
    })
    await expect(client.updateSegmentText(WEEKLY_SYNC_ID, 0, 'x')).rejects.toMatchObject({ status: 409 })
    expect(await client.listTranscripts()).toHaveLength(16)
  })
})

describe('changes', () => {
  test('a new title reaches the list too', async () => {
    const client = createFixtureClient()
    await client.updateTranscriptTitle(WEEKLY_SYNC_ID, 'New')
    expect((await client.getTranscript(WEEKLY_SYNC_ID)).title).toBe('New')
    expect((await client.listTranscripts()).find(t => t.id === WEEKLY_SYNC_ID)?.title).toBe('New')
  })

  test('marking a recording opened shows in the list', async () => {
    const client = createFixtureClient()
    expect((await client.listTranscripts()).find(t => t.id === DESIGN_REVIEW_ID)?.opened).toBe(false)
    await client.markTranscriptOpened(DESIGN_REVIEW_ID)
    expect((await client.listTranscripts()).find(t => t.id === DESIGN_REVIEW_ID)?.opened).toBe(true)
    await expect(client.markTranscriptOpened(999)).rejects.toMatchObject({ status: 404 })
  })

  test('segment text and removal', async () => {
    const client = createFixtureClient()
    await client.updateSegmentText(WEEKLY_SYNC_ID, 5, 'Edited')
    await client.deleteSegment(WEEKLY_SYNC_ID, 8)
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(segments.find(s => s.start === 5)?.text).toBe('Edited')
    expect(segments.some(s => s.start === 8)).toBe(false)
    await expect(client.deleteSegment(WEEKLY_SYNC_ID, 8)).rejects.toMatchObject({ status: 404 })
  })

  test('deleting a recording', async () => {
    const client = createFixtureClient()
    await client.deleteTranscript(WEEKLY_SYNC_ID)
    expect(await client.listTranscripts()).toHaveLength(15)
    await expect(client.getTranscript(WEEKLY_SYNC_ID)).rejects.toMatchObject({ status: 404 })
  })

  test('assigning all segments of a speaker clears the review of that speaker', async () => {
    const client = createFixtureClient()
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: await startsOf(client, unknown1), target: { id: mark } })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(talkTime(segments, mark)).toBe(20)
    expect(talkTime(segments, unknown1)).toBe(0)
    expect(await client.getSpeakerCandidates(WEEKLY_SYNC_ID)).not.toHaveProperty(unknown1)
    const item = (await client.listTranscripts()).find(t => t.id === WEEKLY_SYNC_ID)
    expect(item?.speakers).not.toContain(unknown1)
  })

  test('a correction reads back as the backend gives it: in speaker_resolved', async () => {
    const client = createFixtureClient()
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5], target: { id: anna } })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(segments.find(s => s.start === 5)).toMatchObject({ speaker_resolved: anna, speaker_final: null })
  })

  test('assigning one segment leaves the others', async () => {
    const client = createFixtureClient()
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5], target: { id: anna } })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(effectiveSpeaker(segments.find(s => s.start === 5)!)).toBe(anna)
    expect(effectiveSpeaker(segments.find(s => s.start === 8)!)).toBe(mark)
  })

  test('assigning clears unassigned: the correction wins', async () => {
    const client = createFixtureClient({ board: 'unassigned' })
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [16], target: { id: mark } })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(effectiveSpeaker(segments.find(s => s.start === 16)!)).toBe(mark)
  })

  test('assigning to a new speaker creates it', async () => {
    const client = createFixtureClient()
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: await startsOf(client, unknown1), target: { name: 'Olivia Brown', colorIndex: 2 } })
    const created = (await client.listSpeakers()).find(s => s.name === 'Olivia Brown')
    expect(created?.color_index).toBe(2)
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(effectiveSpeaker(segments.find(s => s.start === 16)!)).toBe(created?.id)
  })

  test('assigning to a speaker that does not exist fails', async () => {
    const client = createFixtureClient()
    await expect(client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [0], target: { id: 'nobody' } }))
      .rejects.toMatchObject({ status: 404 })
  })

  test('renaming a speaker', async () => {
    const client = createFixtureClient()
    const updated = await client.updateSpeaker(unknown1, { name: 'Tom', color_index: 3 })
    expect(updated).toMatchObject({ name: 'Tom', color_index: 3 })
  })

  test('a voice sample comes from the segments of the speaker', async () => {
    const client = createFixtureClient()
    expect(await client.getSpeakerSample(unknown1, WEEKLY_SYNC_ID)).toMatchObject({ transcript_id: WEEKLY_SYNC_ID, start: 16, end: 25 })
    await expect(client.getSpeakerSample(SPEAKER_IDS.kate)).rejects.toMatchObject({ status: 404 })
  })

  test('clients do not share changes, and results are copies', async () => {
    const first = createFixtureClient()
    await first.updateTranscriptTitle(WEEKLY_SYNC_ID, 'Changed')
    const second = createFixtureClient()
    const transcript = await second.getTranscript(WEEKLY_SYNC_ID)
    expect(transcript.title).toBe('Weekly product sync')
    transcript.title = 'Local edit'
    expect((await second.getTranscript(WEEKLY_SYNC_ID)).title).toBe('Weekly product sync')
    expect(BOARDS.review.details[0].title).toBe('Weekly product sync')
  })
})

describe('queue events', () => {
  test('a subscriber first gets the snapshot, after the subscribe returns', async () => {
    vi.useFakeTimers()
    const events: QueueUpdate[] = []
    createFixtureClient().subscribeQueueEvents(e => events.push(e))
    expect(events).toEqual([])
    await vi.advanceTimersByTimeAsync(0)
    expect(events.map(e => e.type)).toEqual(['snapshot'])
  })

  test('no snapshot while the backend is not there', async () => {
    vi.useFakeTimers()
    const events: QueueUpdate[] = []
    createFixtureClient({ scenario: 'error' }).subscribeQueueEvents(e => events.push(e))
    await vi.advanceTimersByTimeAsync(10)
    expect(events).toEqual([])
  })

  test('the transcribing script ends with a new recording in the list', async () => {
    vi.useFakeTimers()
    const client = createFixtureClient()
    const events: QueueUpdate[] = []
    client.subscribeQueueEvents(e => events.push(e))
    await vi.advanceTimersByTimeAsync(0)
    events.length = 0

    client.playEvents(EVENT_SCRIPTS.transcribing)
    await vi.advanceTimersByTimeAsync(1000)
    expect(events.at(-1)).toMatchObject({ type: 'snapshot', step: 'Loading models…' })
    expect((await client.getQueue()).step).toBe('Loading models…')

    await vi.advanceTimersByTimeAsync(10000)
    expect(events.map(e => e.type)).toEqual(['snapshot', 'snapshot', 'snapshot', 'snapshot', 'job_done', 'snapshot'])
    expect((await client.getQueue()).jobs).toEqual([])
    const [newest] = await client.listTranscripts()
    expect(newest.title).toBe('Planning call')
    expect((await client.getTranscript(newest.id)).segments).toHaveLength(2)
  })

  test('the failed script leaves the job failed in the queue', async () => {
    vi.useFakeTimers()
    const client = createFixtureClient()
    const events: QueueUpdate[] = []
    client.subscribeQueueEvents(e => events.push(e))
    client.playEvents(EVENT_SCRIPTS.failed)
    await vi.advanceTimersByTimeAsync(10000)
    expect(events.find(e => e.type === 'job_failed')).toMatchObject({ error_code: 'alignment_model_missing', error_language: 'pt' })
    expect((await client.getQueue()).jobs[0].status).toBe('failed')
    expect(await client.listTranscripts()).toHaveLength(16)
  })

  test('stopping a script and unsubscribing end the events', async () => {
    vi.useFakeTimers()
    const client = createFixtureClient()
    const first: QueueUpdate[] = []
    const second: QueueUpdate[] = []
    const unsubscribe = client.subscribeQueueEvents(e => first.push(e))
    client.subscribeQueueEvents(e => second.push(e))
    await vi.advanceTimersByTimeAsync(0)
    unsubscribe()
    const stop = client.playEvents(EVENT_SCRIPTS.transcribing)
    await vi.advanceTimersByTimeAsync(0)
    expect(first).toHaveLength(1)
    expect(second).toHaveLength(2)
    stop()
    await vi.advanceTimersByTimeAsync(10000)
    expect(second).toHaveLength(2)
  })
})

describe('undoing an assignment', () => {
  test('a speaker the assignment created goes, unless it got other segments', async () => {
    const client = createFixtureClient()
    const first = await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5], target: { name: 'Olivia Brown' } })
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5], speakerId: mark, createdSpeakerId: first.speakerId })
    expect((await client.listSpeakers()).some(s => s.id === first.speakerId)).toBe(false)

    const second = await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5], target: { name: 'Olivia Brown' } })
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [8], target: { id: second.speakerId } })
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5], speakerId: mark, createdSpeakerId: second.speakerId })
    expect((await client.listSpeakers()).some(s => s.id === second.speakerId)).toBe(true)
  })

  test('a segment deleted since is skipped', async () => {
    const client = createFixtureClient()
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], target: { id: anna } })
    await client.deleteSegment(WEEKLY_SYNC_ID, 5)
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: [5, 8], speakerId: mark })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    expect(effectiveSpeaker(segments.find(s => s.start === 8)!)).toBe(mark)
  })

  const starts = (segments: Segment[], id: string) => segments.filter(s => effectiveSpeaker(s) === id).map(s => s.start)

  test('gives the segments back and leaves those the speaker had before', async () => {
    const client = createFixtureClient()
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    const segmentStarts = starts(segments, unknown1)
    const marks = starts(segments, mark)
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: await startsOf(client, unknown1), target: { id: mark } })
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts, speakerId: unknown1 })
    const after = (await client.getTranscript(WEEKLY_SYNC_ID)).segments
    expect(starts(after, unknown1)).toEqual(segmentStarts)
    expect(starts(after, mark)).toEqual(marks)
  })

  test('brings back the candidates and the clip', async () => {
    const client = createFixtureClient()
    const before = await client.getSpeakerCandidates(WEEKLY_SYNC_ID)
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: await startsOf(client, unknown1), target: { id: mark } })
    expect((await client.getSpeakerCandidates(WEEKLY_SYNC_ID))[unknown1]).toBeUndefined()
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: starts(segments, unknown1), speakerId: unknown1 })
    expect((await client.getSpeakerCandidates(WEEKLY_SYNC_ID))[unknown1]).toEqual(before[unknown1])
  })

  test('the list of the recording has the speaker again', async () => {
    const client = createFixtureClient()
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: await startsOf(client, unknown1), target: { id: mark } })
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: starts(segments, unknown1), speakerId: unknown1 })
    const item = (await client.listTranscripts()).find(t => t.id === WEEKLY_SYNC_ID)!
    expect(item.speakers).toContain(unknown1)
  })

  test('segments of a deleted speaker go back to unassigned', async () => {
    const client = createFixtureClient({ board: 'unassigned' })
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    const segmentStarts = starts(segments, UNASSIGNED)
    await client.assignSpeaker({ transcriptId: WEEKLY_SYNC_ID, segmentStarts: await startsOf(client, UNASSIGNED), target: { id: mark } })
    await client.undoSpeakerAssignment({ transcriptId: WEEKLY_SYNC_ID, segmentStarts, speakerId: UNASSIGNED })
    expect(starts((await client.getTranscript(WEEKLY_SYNC_ID)).segments, UNASSIGNED)).toEqual(segmentStarts)
  })
})

describe('the recording for going through a whole review', () => {
  test('has voices with no name, and every one in the list of the recording', async () => {
    const client = createFixtureClient()
    const { segments } = await client.getTranscript(DESIGN_REVIEW_ID)
    const speakers = await client.listSpeakers()
    const ids = new Set(segments.map(effectiveSpeaker))
    expect([...ids].filter(id => !speakers.find(s => s.id === id)?.name).length).toBeGreaterThanOrEqual(3)
    const item = (await client.listTranscripts()).find(t => t.id === DESIGN_REVIEW_ID)!
    expect(new Set(item.speakers)).toEqual(ids)
  })

  test('has the edge cases of the card: no candidates, no clip, a long clip', async () => {
    const answers = Object.values(await createFixtureClient().getSpeakerCandidates(DESIGN_REVIEW_ID))
    expect(answers.some(a => a.candidates.length === 0 && a.clip)).toBe(true)
    expect(answers.some(a => a.candidates.length > 0 && a.clip === null)).toBe(true)
    expect(answers.some(a => a.clip && a.clip.end - a.clip.start === 29)).toBe(true)
  })
})

describe('waveform', () => {
  test('one level per bar, from 0 to 1, louder where someone speaks', async () => {
    const client = createFixtureClient()
    const { segments } = await client.getTranscript(WEEKLY_SYNC_ID)
    const end = segments.at(-1)!.end
    const levels = await client.getWaveform(WEEKLY_SYNC_ID, { bars: 120, start: 0, end: end + 60 })
    expect(levels).toHaveLength(120)
    expect(levels.every(level => level >= 0 && level <= 1)).toBe(true)
    expect(levels.at(-1)).toBeLessThan(0.1)
    expect(Math.max(...levels)).toBeGreaterThan(0.5)
  })

  test('the same every time', async () => {
    const range = { bars: 26, start: 10, end: 14 }
    expect(await createFixtureClient().getWaveform(WEEKLY_SYNC_ID, range))
      .toEqual(await createFixtureClient().getWaveform(WEEKLY_SYNC_ID, range))
  })

  test('nothing to play: the audio is not found', async () => {
    await expect(createFixtureClient({ noAudio: true }).getWaveform(WEEKLY_SYNC_ID, { bars: 2, start: 0, end: 1 }))
      .rejects.toMatchObject({ status: 404 })
  })
})

describe('adding to the queue', () => {
  test('a file waits in the queue under its name, and the listeners hear of it', async () => {
    const client = createFixtureClient()
    const events: QueueUpdate[] = []
    client.subscribeQueueEvents(e => events.push(e))
    const job = await client.addQueueJob({ audioPath: '/in/Team call.final.m4a', whisperModel: null, language: null })
    expect(job).toMatchObject({ title: 'Team call.final', status: 'waiting', language: null })
    expect((await client.getQueue()).jobs.map(j => j.id)).toEqual([job.id])
    expect(events.at(-1)).toMatchObject({ type: 'snapshot', jobs: [{ id: job.id }] })
  })

  test('without models it is refused as the backend does', async () => {
    const client = createFixtureClient({ noModels: true })
    await expect(client.addQueueJob({ audioPath: '/in/a.mp3', whisperModel: null, language: null })).rejects.toMatchObject({ status: 400, message: NO_MODELS })
    expect((await client.getQueue()).jobs).toEqual([])
  })
})

describe('models', () => {
  const installed = (models: { id: string; installed: boolean }[]) => models.filter(m => m.installed).map(m => m.id)

  test('by default a Whisper model and diarization are there, no alignment model', async () => {
    const models = await createFixtureClient().listModels()
    expect(installed(models)).toEqual(DEFAULT_INSTALLED)
    expect(models.filter(m => m.kind === 'alignment').map(m => m.id)).toEqual(ALIGNMENT_MODELS.map(m => m.id))
  })

  test('noModels has nothing, installedModels exactly the given ones', async () => {
    expect(installed(await createFixtureClient({ noModels: true }).listModels())).toEqual([])
    expect(installed(await createFixtureClient({ installedModels: ['tiny', 'diarize', 'ru'] }).listModels())).toEqual(['tiny', 'diarize', 'ru'])
  })

  test('a job is refused for each missing model in the backend order', async () => {
    const add = (options: Parameters<typeof createFixtureClient>[0], whisperModel: string | null, language: string | null) =>
      createFixtureClient(options).addQueueJob({ audioPath: '/in/a.mp3', whisperModel, language })
    await expect(add({}, 'tiny', null)).rejects.toMatchObject({ status: 400, message: 'Whisper model "tiny" is not installed. Download it in Settings.' })
    await expect(add({ installedModels: ['small'] }, 'small', null)).rejects.toMatchObject({ status: 400, message: NO_MODELS })
    await expect(add({}, 'small', 'ru')).rejects.toMatchObject({ status: 400, message: 'Alignment model for language "ru" is not installed. Download it in Settings.' })
    await expect(add({ installedModels: [...DEFAULT_INSTALLED, 'ru'] }, 'small', 'ru')).resolves.toMatchObject({ language: 'ru' })
    await expect(add({}, 'small', 'en')).resolves.toMatchObject({ whisper_model: 'small' })
  })
})

describe('model downloads', () => {
  const follow = (client: ReturnType<typeof createFixtureClient>, jobId: string) => new Promise<string[]>(resolve => {
    const seen: string[] = []
    client.watchModelDownload(jobId, event => {
      seen.push(event.type === 'progress' ? String(event.pct) : event.type)
      if (event.type !== 'progress') resolve(seen)
    })
  })

  test('goes up a quarter a step and installs the model', async () => {
    const client = createFixtureClient({ downloadStepMs: 1 })
    const jobId = await client.startModelDownload('cs', null)
    expect(await follow(client, jobId)).toEqual(['25', '50', '75', '100', 'done'])
    expect((await client.listModels()).find(m => m.id === 'cs')?.installed).toBe(true)
  })

  test('a second start joins the running download', async () => {
    const client = createFixtureClient({ downloadStepMs: 1 })
    expect(await client.startModelDownload('cs', null)).toBe(await client.startModelDownload('cs', null))
  })

  test('downloadFails ends it with an error and nothing installed', async () => {
    const client = createFixtureClient({ downloadStepMs: 1, downloadFails: true })
    const jobId = await client.startModelDownload('cs', null)
    expect((await follow(client, jobId)).at(-1)).toBe('error')
    expect((await client.listModels()).find(m => m.id === 'cs')?.installed).toBe(false)
  })

  test('a cancel ends it as cancelled; a job that ended is unknown', async () => {
    const client = createFixtureClient({ downloadStepMs: 1000 })
    const jobId = await client.startModelDownload('cs', null)
    const seen = follow(client, jobId)
    await client.cancelModelDownload('cs', jobId)
    expect(await seen).toEqual(['cancelled'])
    await expect(client.cancelModelDownload('cs', jobId)).rejects.toMatchObject({ status: 404 })
    expect(await follow(client, jobId)).toEqual(['error'])
  })
})

describe('retrying a job', () => {
  const failedOn = (language: string) => queueSnapshot({
    jobs: [
      { ...QUEUE_JOB, id: 'a', status: 'failed', language, error: 'x', error_code: 'alignment_model_missing', error_language: language },
      { ...QUEUE_JOB, id: 'b', status: 'waiting' },
    ],
  })

  test('a failed job waits again at the end of the queue, with no error', async () => {
    const client = createFixtureClient({ installedModels: [...DEFAULT_INSTALLED, 'pt'] })
    client.playEvents({ steps: [{ afterMs: 0, event: failedOn('pt') }] })
    await vi.waitFor(async () => expect((await client.getQueue()).jobs).toHaveLength(2))
    await expect(client.retryQueueJob('a')).resolves.toMatchObject({ status: 'waiting', error_code: null })
    expect((await client.getQueue()).jobs.map(j => j.id)).toEqual(['b', 'a'])
  })

  test('refused while the model is missing, or for a job that has not failed', async () => {
    const client = createFixtureClient()
    client.playEvents({ steps: [{ afterMs: 0, event: failedOn('pt') }] })
    await vi.waitFor(async () => expect((await client.getQueue()).jobs).toHaveLength(2))
    await expect(client.retryQueueJob('a')).rejects.toMatchObject({ status: 400 })
    await expect(client.retryQueueJob('b')).rejects.toMatchObject({ status: 409 })
  })
})

describe('editing a job', () => {
  const withJob = async (status: 'waiting' | 'running', options = {}) => {
    const client = createFixtureClient(options)
    client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs: [{ ...QUEUE_JOB, id: 'a', status, whisper_model: 'small', language: null }] }) }] })
    await vi.waitFor(async () => expect((await client.getQueue()).jobs).toHaveLength(1))
    return client
  }

  test('changes only what is given', async () => {
    const client = await withJob('waiting')
    await expect(client.updateQueueJob('a', { title: 'Standup', language: 'de' })).resolves.toMatchObject({ title: 'Standup', language: 'de', whisper_model: 'small' })
    expect((await client.getQueue()).jobs[0]).toMatchObject({ title: 'Standup', language: 'de' })
  })

  test('refuses a model or an alignment model not installed, and a running job', async () => {
    const client = await withJob('waiting')
    await expect(client.updateQueueJob('a', { whisper_model: 'tiny' })).rejects.toMatchObject({ status: 400 })
    await expect(client.updateQueueJob('a', { language: 'ru' })).rejects.toMatchObject({ status: 400 })
    await expect((await withJob('running')).updateQueueJob('a', { title: 'x' })).rejects.toMatchObject({ status: 409 })
  })
})
