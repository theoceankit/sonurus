import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useApi } from './ApiProvider'
import { ApiError, type SpeakerAssignment, type SpeakerUndo, type WaveformStretch } from './client'
import type { HandleFormat, QueueJobUpdate, QueueStartMode, QueueUpdate, Speaker, SpeakerUpdate, Transcript, TranscriptListItem } from './types'

// Everything below a transcript starts with its key, so invalidating
// queryKeys.transcripts reaches the list, the details and the candidates.
export const queryKeys = {
  transcripts: ['transcripts'],
  transcript: (id: number) => ['transcripts', id],
  candidates: (id: number) => ['transcripts', id, 'candidates'],
  speakers: ['speakers'],
  sample: (speakerId: string, transcriptId?: number) => ['speakers', speakerId, 'sample', transcriptId],
  speakerTranscripts: (speakerId: string) => ['speakers', speakerId, 'transcripts'],
  // Under the speakers: a speaker named, renamed or gone changes what is free.
  handleSuggestion: (name: string, exclude?: string) => ['speakers', 'handle-suggestion', name, exclude],
  handleFormat: ['handleFormat'],
  // Not under the transcript: edits never change the audio.
  waveform: (id: number, { bars, start, end }: WaveformStretch) => ['waveform', id, bars, start, end],
  queue: ['queue'],
  models: ['models'],
  // Under the models: what changes them (a download, a delete) may make the folder.
  modelsFolder: ['models', 'folder'],
  captureSources: ['captureSources'],
  connected: ['connected'],
} satisfies Record<string, QueryKey | ((...args: never[]) => QueryKey)>

export function useTranscripts() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.transcripts, queryFn: () => api.listTranscripts() })
}

// With no id nothing is asked for: no recording is open.
export function useTranscript(id: number | null) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.transcript(id ?? -1),
    queryFn: () => api.getTranscript(id!),
    enabled: id !== null,
  })
}

export function useSpeakerCandidates(id: number | null) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.candidates(id ?? -1),
    queryFn: () => api.getSpeakerCandidates(id!),
    enabled: id !== null,
  })
}

// With no recording or no length yet nothing is asked for. The levels of a
// recording never change.
export function useWaveform(id: number | null, stretch: WaveformStretch) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.waveform(id ?? -1, stretch),
    queryFn: () => api.getWaveform(id!, stretch),
    enabled: id !== null && stretch.end > stretch.start,
    staleTime: Infinity,
  })
}

export function useSpeakers() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.speakers, queryFn: () => api.listSpeakers() })
}

// The handle a speaker named name would get: numbered when taken. exclude: the
// speaker being edited. Asked for on every change of the name, so the handle keeps up
// with the typing (the backend is local); until the answer comes the last one stays.
// Nothing is asked for a blank name or while disabled.
export function useHandleSuggestion(name: string, exclude?: string, enabled = true) {
  const api = useApi()
  const trimmed = name.trim()
  return useQuery({
    queryKey: queryKeys.handleSuggestion(trimmed, exclude),
    queryFn: () => api.getHandleSuggestion(trimmed, exclude),
    enabled: enabled && trimmed !== '',
    placeholderData: previous => previous,
  })
}

export function useHandleFormat() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.handleFormat, queryFn: () => api.getHandleFormat() })
}

export function useSetHandleFormat() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (format: HandleFormat) => api.setHandleFormat(format),
    onSuccess: format => {
      queries.setQueryData(queryKeys.handleFormat, format)
      void queries.invalidateQueries({ queryKey: ['speakers', 'handle-suggestion'] })
    },
  })
}

export function useSpeakerSample(speakerId: string, transcriptId?: number) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.sample(speakerId, transcriptId),
    queryFn: () => api.getSpeakerSample(speakerId, transcriptId),
  })
}

// The recordings a speaker talks in. With no speaker nothing is asked for.
export function useSpeakerTranscripts(speakerId: string | null) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.speakerTranscripts(speakerId ?? ''),
    queryFn: () => api.listSpeakerTranscripts(speakerId!),
    enabled: speakerId !== null,
  })
}

// The catalog with what is downloaded. A screen that shows it asks again when it
// opens: models come and go in Settings.
export function useModels() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.models, queryFn: () => api.listModels(), refetchOnMount: 'always' })
}

export function useModelsFolder() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.modelsFolder, queryFn: () => api.getModelsFolder() })
}

export function useQueue() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.queue, queryFn: () => api.getQueue() })
}

// The system audio sources, asked for only while enabled, and again each time a screen
// that shows them mounts: an output device may have come or gone.
export function useCaptureSources(enabled = true) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.captureSources, queryFn: () => api.listCaptureSources(), refetchOnMount: 'always', enabled })
}

// Whether WS /ws/queue is up, kept by useQueueEventsSync.
export function useBackendConnected(): boolean {
  return useQuery({ queryKey: queryKeys.connected, queryFn: () => true, initialData: true, staleTime: Infinity }).data
}

const refreshTranscripts = (queries: QueryClient) => queries.invalidateQueries({ queryKey: queryKeys.transcripts })

const refreshTranscriptsAndSpeakers = (queries: QueryClient) => Promise.all([
  refreshTranscripts(queries),
  queries.invalidateQueries({ queryKey: queryKeys.speakers }),
])

export function useUpdateTranscriptTitle() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: ({ transcriptId, title }: { transcriptId: number; title: string }) => api.updateTranscriptTitle(transcriptId, title),
    // The new title shows at once and goes back if the request fails.
    onMutate: async ({ transcriptId, title }) => {
      await queries.cancelQueries({ queryKey: queryKeys.transcripts })
      const before = queries.getQueryData<Transcript>(queryKeys.transcript(transcriptId))
      const listBefore = queries.getQueryData<TranscriptListItem[]>(queryKeys.transcripts)
      if (before) queries.setQueryData(queryKeys.transcript(transcriptId), { ...before, title })
      if (listBefore) queries.setQueryData(queryKeys.transcripts, listBefore.map(item => (item.id === transcriptId ? { ...item, title } : item)))
      return { before, listBefore }
    },
    onError: (_error, { transcriptId }, context) => {
      if (context?.before) queries.setQueryData(queryKeys.transcript(transcriptId), context.before)
      if (context?.listBefore) queries.setQueryData(queryKeys.transcripts, context.listBefore)
    },
    onSettled: () => refreshTranscripts(queries),
  })
}

// Called by the panel that shows a recording, with whether it has loaded. The dot
// goes at once and nothing is said if the request fails. Asked once per opening:
// after a failure the list says not opened again, and it would ask forever.
export function useMarkOpened(transcriptId: number | null, loaded: boolean) {
  const api = useApi()
  const queries = useQueryClient()
  const item = useTranscripts().data?.find(row => row.id === transcriptId)
  const asked = useRef<number | null>(null)

  useEffect(() => {
    if (transcriptId === null || !loaded || !item || asked.current === transcriptId) return
    // Also when it was opened before: one marked unread while open keeps its dot.
    asked.current = transcriptId
    if (item.opened) return
    queries.setQueryData<TranscriptListItem[]>(queryKeys.transcripts, items => items?.map(row => (row.id === transcriptId ? { ...row, opened: true } : row)))
    // Only the list: the key as a prefix would load the recording again.
    void api.markTranscriptOpened(transcriptId).catch(() => {}).finally(() => queries.invalidateQueries({ queryKey: queryKeys.transcripts, exact: true }))
  }, [api, queries, transcriptId, loaded, item])

  useEffect(() => {
    if (asked.current !== transcriptId) asked.current = null
  }, [transcriptId])
}

// Mark as read or unread from the menu of a recording: the dot changes at once and
// comes back as it was if the request fails.
export function useSetOpened() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: ({ transcriptId, opened }: { transcriptId: number; opened: boolean }) =>
      (opened ? api.markTranscriptOpened(transcriptId) : api.markTranscriptUnopened(transcriptId)),
    onMutate: async ({ transcriptId, opened }) => {
      await queries.cancelQueries({ queryKey: queryKeys.transcripts, exact: true })
      const listBefore = queries.getQueryData<TranscriptListItem[]>(queryKeys.transcripts)
      if (listBefore) queries.setQueryData(queryKeys.transcripts, listBefore.map(item => (item.id === transcriptId ? { ...item, opened } : item)))
      return { listBefore }
    },
    onError: (_error, _variables, context) => {
      if (context?.listBefore) queries.setQueryData(queryKeys.transcripts, context.listBefore)
    },
    // Only the list: the key as a prefix would load the recording again.
    onSettled: () => queries.invalidateQueries({ queryKey: queryKeys.transcripts, exact: true }),
  })
}

export function useDeleteTranscript() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: async (transcriptId: number) => {
      try {
        await api.deleteTranscript(transcriptId)
      } catch (error) {
        // Already gone is what was asked for.
        if (!(error instanceof ApiError && error.status === 404)) throw error
      }
    },
    // Not waiting for the refresh, and not asking for the deleted recording again:
    // it is still open until the caller closes it, and would only answer 404.
    onSuccess: (_result, transcriptId) => {
      queries.setQueryData<TranscriptListItem[]>(queryKeys.transcripts, items => items?.filter(item => item.id !== transcriptId))
      void queries.invalidateQueries({ queryKey: queryKeys.transcripts, predicate: query => query.queryKey[1] !== transcriptId })
      void queries.invalidateQueries({ queryKey: queryKeys.speakers })
    },
  })
}

export function useUpdateSegmentText() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: ({ transcriptId, segmentStart, text }: { transcriptId: number; segmentStart: number; text: string }) =>
      api.updateSegmentText(transcriptId, segmentStart, text),
    // The new text shows at once and goes back if the request fails.
    onMutate: async ({ transcriptId, segmentStart, text }) => {
      await queries.cancelQueries({ queryKey: queryKeys.transcript(transcriptId) })
      const before = queries.getQueryData<Transcript>(queryKeys.transcript(transcriptId))
      if (before) {
        queries.setQueryData(queryKeys.transcript(transcriptId), {
          ...before,
          segments: before.segments.map(segment => (segment.start === segmentStart ? { ...segment, text } : segment)),
        })
      }
      return { before }
    },
    onError: (_error, { transcriptId }, context) => {
      if (context?.before) queries.setQueryData(queryKeys.transcript(transcriptId), context.before)
    },
    onSettled: () => refreshTranscripts(queries),
  })
}

export function useDeleteSegment() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: ({ transcriptId, segmentStart }: { transcriptId: number; segmentStart: number }) =>
      api.deleteSegment(transcriptId, segmentStart),
    onSuccess: () => refreshTranscriptsAndSpeakers(queries),
  })
}

export function useAssignSpeaker() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (assignment: SpeakerAssignment) => api.assignSpeaker(assignment),
    onSuccess: () => refreshTranscriptsAndSpeakers(queries),
  })
}

export function useUndoSpeakerAssignment() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (undo: SpeakerUndo) => api.undoSpeakerAssignment(undo),
    onSuccess: () => refreshTranscriptsAndSpeakers(queries),
  })
}

export function useUpdateSpeaker() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: ({ speakerId, update }: { speakerId: string; update: SpeakerUpdate }) => api.updateSpeaker(speakerId, update),
    onSuccess: () => refreshTranscriptsAndSpeakers(queries),
  })
}

// Their segments become Unassigned in every recording, so the recordings are asked
// for again; the speaker leaves the list at once and is not asked about again.
export function useDeleteSpeaker() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: async (speakerId: string) => {
      try {
        await api.deleteSpeaker(speakerId)
      } catch (error) {
        // Already gone is what was asked for.
        if (!(error instanceof ApiError && error.status === 404)) throw error
      }
    },
    onSuccess: (_result, speakerId) => {
      queries.setQueryData<Speaker[]>(queryKeys.speakers, speakers => speakers?.filter(speaker => speaker.id !== speakerId))
      queries.removeQueries({ queryKey: [...queryKeys.speakers, speakerId] })
      void queries.invalidateQueries({ queryKey: queryKeys.speakers })
      void refreshTranscripts(queries)
    },
  })
}

// Files that went into the queue before one failed stay there, so the caller can
// take them off its list and not send them twice.
export class AddToQueueError extends Error {
  readonly added: number
  readonly error: ApiError

  constructor(added: number, error: ApiError) {
    super(error.message)
    this.name = 'AddToQueueError'
    this.added = added
    this.error = error
  }
}

export type QueueFiles = {
  // A null title is the file name.
  files: readonly { audioPath: string; title: string | null }[]
  // Null is the backend's own: its default model, and the language detected from the audio.
  whisperModel: string | null
  language: string | null
}

// Puts files into the transcription queue one at a time, in the order given, all with
// one model and language. Stops at the first refusal.
export function useAddToQueue() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: async ({ files, whisperModel, language }: QueueFiles) => {
      for (const [added, { audioPath, title }] of files.entries()) {
        try {
          await api.addQueueJob({ audioPath, whisperModel, language, title })
        } catch (error) {
          throw new AddToQueueError(added, error instanceof ApiError ? error : new ApiError(0, String(error)))
        }
      }
    },
    onSettled: () => queries.invalidateQueries({ queryKey: queryKeys.queue }),
  })
}

// The snapshot that follows on WS /ws/queue shows the change; asking again covers a
// connection that is down.
export function useUpdateQueueJob() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: ({ jobId, update }: { jobId: string; update: QueueJobUpdate }) => api.updateQueueJob(jobId, update),
    onSuccess: () => queries.invalidateQueries({ queryKey: queryKeys.queue }),
  })
}

// The backend keeps the start mode with the queue. The answer is the new snapshot,
// shown at once; the one that follows on WS /ws/queue says the same.
export function useSetQueueStartMode() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (startMode: QueueStartMode) => api.setQueueStartMode(startMode),
    onSuccess: snapshot => queries.setQueryData(queryKeys.queue, snapshot),
  })
}

export type QueueControl = 'start' | 'pause'

// Start, pause and a new order answer the queue after the change: it is shown at
// once, before the snapshot on WS /ws/queue.
export function useQueueControl() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (action: QueueControl) => (action === 'start' ? api.startQueue() : api.pauseQueue()),
    onSuccess: snapshot => queries.setQueryData(queryKeys.queue, snapshot),
  })
}

export function useReorderQueue() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (jobIds: readonly string[]) => api.reorderQueue(jobIds),
    onSuccess: snapshot => queries.setQueryData(queryKeys.queue, snapshot),
  })
}

export function useRetryQueueJob() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.retryQueueJob(jobId),
    onSuccess: () => queries.invalidateQueries({ queryKey: queryKeys.queue }),
  })
}

export function useDeleteQueueJob() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (jobId: string) => api.deleteQueueJob(jobId),
    onSuccess: () => queries.invalidateQueries({ queryKey: queryKeys.queue }),
  })
}

// Keeps the cache up with WS /ws/queue while the calling component is mounted:
// the app's root calls it once. onEvent is for what a screen shows itself, such
// as the toast of a failed job.
export function useQueueEventsSync(onEvent?: (event: QueueUpdate) => void) {
  const api = useApi()
  const queries = useQueryClient()
  const latestOnEvent = useRef(onEvent)
  latestOnEvent.current = onEvent

  useEffect(() => api.subscribeQueueEvents(event => {
    if (event.type === 'snapshot') queries.setQueryData(queryKeys.queue, event)
    if (event.type === 'job_done') void refreshTranscriptsAndSpeakers(queries)
    latestOnEvent.current?.(event)
  }, connected => {
    queries.setQueryData(queryKeys.connected, connected)
    // A job may have finished while no one was listening.
    if (connected) void queries.invalidateQueries({ predicate: query => query.queryKey[0] !== queryKeys.connected[0] })
  }), [api, queries])
}
