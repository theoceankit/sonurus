import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useApi } from './ApiProvider'
import { readTranscribeDefaults } from '../platform/transcribe-defaults'
import { ApiError, type SpeakerAssignment, type SpeakerUndo, type WaveformStretch } from './client'
import type { QueueUpdate, SpeakerUpdate, Transcript, TranscriptListItem } from './types'

// Everything below a transcript starts with its key, so invalidating
// queryKeys.transcripts reaches the list, the details and the candidates.
export const queryKeys = {
  transcripts: ['transcripts'],
  transcript: (id: number) => ['transcripts', id],
  candidates: (id: number) => ['transcripts', id, 'candidates'],
  speakers: ['speakers'],
  sample: (speakerId: string, transcriptId?: number) => ['speakers', speakerId, 'sample', transcriptId],
  // Not under the transcript: edits never change the audio.
  waveform: (id: number, { bars, start, end }: WaveformStretch) => ['waveform', id, bars, start, end],
  queue: ['queue'],
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

export function useSpeakerSample(speakerId: string, transcriptId?: number) {
  const api = useApi()
  return useQuery({
    queryKey: queryKeys.sample(speakerId, transcriptId),
    queryFn: () => api.getSpeakerSample(speakerId, transcriptId),
  })
}

export function useQueue() {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.queue, queryFn: () => api.getQueue() })
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
    if (transcriptId === null || !loaded || !item || item.opened || asked.current === transcriptId) return
    asked.current = transcriptId
    queries.setQueryData<TranscriptListItem[]>(queryKeys.transcripts, items => items?.map(row => (row.id === transcriptId ? { ...row, opened: true } : row)))
    // Only the list: the key as a prefix would load the recording again.
    void api.markTranscriptOpened(transcriptId).catch(() => {}).finally(() => queries.invalidateQueries({ queryKey: queryKeys.transcripts, exact: true }))
  }, [api, queries, transcriptId, loaded, item])

  useEffect(() => {
    if (asked.current !== transcriptId) asked.current = null
  }, [transcriptId])
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

// Puts files into the transcription queue one at a time, in the order given, with the
// default model and language of the settings. Stops at the first refusal.
export function useAddToQueue() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: async (paths: readonly string[]) => {
      const defaults = await readTranscribeDefaults()
      for (const [added, audioPath] of paths.entries()) {
        try {
          await api.addQueueJob({ audioPath, ...defaults })
        } catch (error) {
          throw new AddToQueueError(added, error instanceof ApiError ? error : new ApiError(0, String(error)))
        }
      }
    },
    onSettled: () => queries.invalidateQueries({ queryKey: queryKeys.queue }),
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
