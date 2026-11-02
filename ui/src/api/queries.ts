import { useMutation, useQuery, useQueryClient, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { useApi } from './ApiProvider'
import type { SpeakerAssignment, SpeakerTarget } from './client'
import type { QueueUpdate, SpeakerUpdate, Transcript, TranscriptListItem } from './types'

// Everything below a transcript starts with its key, so invalidating
// queryKeys.transcripts reaches the list, the details and the candidates.
export const queryKeys = {
  transcripts: ['transcripts'],
  transcript: (id: number) => ['transcripts', id],
  candidates: (id: number) => ['transcripts', id, 'candidates'],
  speakers: ['speakers'],
  sample: (speakerId: string, transcriptId?: number) => ['speakers', speakerId, 'sample', transcriptId],
  queue: ['queue'],
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

export function useSpeakerCandidates(id: number) {
  const api = useApi()
  return useQuery({ queryKey: queryKeys.candidates(id), queryFn: () => api.getSpeakerCandidates(id) })
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

export function useDeleteTranscript() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: (transcriptId: number) => api.deleteTranscript(transcriptId),
    onSuccess: () => refreshTranscriptsAndSpeakers(queries),
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

// A turn is several segments and the API changes one at a time, so this is the one
// place that knows how a whole turn gets a new speaker.
export function useAssignTurnSpeaker() {
  const api = useApi()
  const queries = useQueryClient()
  return useMutation({
    mutationFn: async ({ transcriptId, segmentStarts, target }: { transcriptId: number; segmentStarts: readonly number[]; target: SpeakerTarget }) => {
      for (const segmentStart of segmentStarts) await api.assignSpeaker({ transcriptId, segmentStart, target })
    },
    onSettled: () => refreshTranscriptsAndSpeakers(queries),
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
  }), [api, queries])
}
