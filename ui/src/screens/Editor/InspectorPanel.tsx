import { useEffect, useMemo, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { SpeakerTarget } from '../../api/client'
import { useAssignSpeaker, useSpeakerCandidates, useSpeakers, useTranscript, useUndoSpeakerAssignment } from '../../api/queries'
import { effectiveSpeaker, type Speaker, type SpeakerCandidates, type Transcript } from '../../api/types'
import { avatarOf } from '../../components/Avatar/Avatar'
import { AvatarStack } from '../../components/AvatarStack/AvatarStack'
import { Button } from '../../components/Button/Button'
import { Inspector, type InspectorReview } from '../../components/Inspector/Inspector'
import { ReviewCard } from '../../components/ReviewCard/ReviewCard'
import { SpeakerRow } from '../../components/SpeakerRow/SpeakerRow'
import { Stack } from '../../components/Stack/Stack'
import { TalkTime } from '../../components/TalkTime/TalkTime'
import { toast } from '../../components/Toast/toast'
import { useClipPlayback, useClipState } from '../../media/clip-playback'
import type { Playback } from '../../media/playback'
import { formatDuration } from '../../media/timeline'
import { firstSegmentOf, pendingReview, speakerRows, splitRows, talkTotal, type SpeakerRowData } from './inspector'
import styles from './InspectorPanel.module.css'
import { closeReview, openReview, resumeReview, reviewView, selectSpeaker, skipSpeaker } from './review-queue'
import type { SpeakerRequest } from './SpeakerDialogs'

const MAX_STACK = 3

export interface InspectorPanelProps {
  transcriptId: number | null
  playback: Playback
  // A hidden panel stays mounted to keep its review, and falls silent.
  open?: boolean
  onClose?: () => void
  onChooseSpeaker?: (request: SpeakerRequest) => void
  // For a story: recognized speakers to confirm, which the API does not answer for
  // yet, and the speaker a board shows.
  possibleMatches?: boolean
  initialSpeakerId?: string
}

// Nothing shows until the recording has loaded, as in the transcript.
export function InspectorPanel({ transcriptId, playback, open = true, onClose, onChooseSpeaker, possibleMatches, initialSpeakerId }: InspectorPanelProps) {
  const transcript = useTranscript(transcriptId)
  const speakers = useSpeakers()
  const candidates = useSpeakerCandidates(transcriptId)

  if (transcriptId === null) return <Inspector onClose={onClose} />
  if ((transcript.isError && !transcript.data) || (speakers.isError && !speakers.data)) {
    return (
      <Inspector onClose={onClose}>
        <div className={styles.message}>
          <span>Could not load the speakers</span>
          <Button
            variant="secondary"
            size="small"
            onClick={() => {
              if (transcript.isError) void transcript.refetch()
              if (speakers.isError) void speakers.refetch()
            }}
          >
            Retry
          </Button>
        </div>
      </Inspector>
    )
  }
  if (!transcript.data || !speakers.data || candidates.isPending) return <Inspector onClose={onClose} />

  return (
    <InspectorView
      key={transcriptId}
      transcript={transcript.data}
      speakers={speakers.data}
      // The card works without them: search and new speaker stay.
      candidates={candidates.data ?? {}}
      playback={playback}
      open={open}
      onClose={onClose}
      onChooseSpeaker={onChooseSpeaker}
      possibleMatches={possibleMatches}
      initialSpeakerId={initialSpeakerId}
    />
  )
}

interface InspectorViewProps extends Omit<InspectorPanelProps, 'transcriptId'> {
  transcript: Transcript
  speakers: Speaker[]
  candidates: SpeakerCandidates
}

function InspectorView({ transcript, speakers, candidates, playback, open, onClose, onChooseSpeaker, possibleMatches, initialSpeakerId }: InspectorViewProps) {
  const api = useApi()
  const { id: transcriptId, segments } = transcript
  const assign = useAssignSpeaker()
  const undo = useUndoSpeakerAssignment()
  const clip = useClipPlayback(playback, api.getAudioUrl(transcript))
  const clipState = useClipState(clip)

  // A possible match stays one until it is confirmed, whoever it turns out to be.
  const [confirmed, setConfirmed] = useState<readonly string[]>([])
  const rows = useMemo(() => speakerRows(segments, speakers), [segments, speakers])
  const pending = useMemo(() => {
    const matches = possibleMatches ? Object.keys(candidates).filter(id => speakers.some(speaker => speaker.id === id && speaker.name)) : []
    return pendingReview(segments, speakers, matches).filter(id => !confirmed.includes(id))
  }, [segments, speakers, candidates, possibleMatches, confirmed])

  const [review, setReview] = useState(() => openReview(pending, initialSpeakerId))
  const view = reviewView(review, pending)
  const { currentId, mode } = view
  const [showAll, setShowAll] = useState(false)
  const [picked, setPicked] = useState<{ speakerId: string; candidateId: string | null } | null>(null)

  useEffect(() => { clip.stop() }, [clip, currentId, mode, open])

  const answer = currentId ? candidates[currentId] : undefined
  const current = rows.find(row => row.id === currentId)
  const isPossibleMatch = current?.kind === 'named'
  const selectedId = picked?.speakerId === currentId
    ? picked.candidateId
    : isPossibleMatch ? answer?.candidates.find(candidate => candidate.suggested)?.speaker_id ?? null : null

  const undoAssignment = (speakerId: string, segmentStarts: number[], reviewed: boolean) => {
    undo.mutate({ transcriptId, segmentStarts, speakerId }, {
      onSuccess: () => {
        setConfirmed(ids => ids.filter(id => id !== speakerId))
        if (reviewed) setReview(state => selectSpeaker(state, speakerId))
      },
      onError: error => { toast({ message: `Failed to undo: ${error.message}`, type: 'error' }) },
    })
  }

  // All segments of a voice. Rejects if it fails: whoever asked says so in its own place.
  const assignVoice = async (speakerId: string, target: SpeakerTarget) => {
    const segmentStarts = segments.filter(segment => effectiveSpeaker(segment) === speakerId).map(segment => segment.start)
    const reviewed = pending.includes(speakerId)
    await assign.mutateAsync({ transcriptId, fromSpeakerId: speakerId, target })
    if (isPossibleMatch && speakerId === currentId) setConfirmed(ids => [...ids, speakerId])
    // An undo brings the card back with nothing chosen, like any other.
    setPicked(null)
    const name = 'id' in target ? speakers.find(speaker => speaker.id === target.id)?.name : target.name
    toast({
      message: `Assigned to ${name}`,
      action: { label: 'Undo', onClick: () => undoAssignment(speakerId, segmentStarts, reviewed) },
    })
  }

  const assignPicked = () => {
    if (!currentId || !selectedId) return
    assignVoice(currentId, { id: selectedId }).catch((error: Error) => {
      toast({ message: `Failed to assign the speaker: ${error.message}`, type: 'error' })
    })
  }

  const ask = (speakerId: string, start: SpeakerRequest['start'], preselected: string | null = null) => {
    onChooseSpeaker?.({ transcriptId, speakerId, start, preselected, onAssign: target => assignVoice(speakerId, target) })
  }

  const renderRow = (row: SpeakerRowData) => {
    const key = `row:${row.id}`
    const first = firstSegmentOf(segments, row.id)
    return (
      <SpeakerRow
        key={row.id}
        speaker={row}
        time={row.time}
        selected={mode === 'on' && row.id === currentId}
        onSelect={pending.includes(row.id) ? () => setReview(state => selectSpeaker(state, row.id)) : undefined}
        onPlay={row.kind === 'unassigned' || !first ? undefined : () => clip.toggle(key, first.start, first.end)}
        playing={clipState.key === key && clipState.playing}
        playDisabled={!clipState.ready}
        onAssign={() => ask(row.id, 'choose')}
      />
    )
  }

  const { visible, hidden } = splitRows(rows, mode === 'on' ? currentId : null)
  const collapsible = mode !== 'off' && hidden.length > 0
  const shown = collapsible && !showAll ? visible : rows

  const dock: InspectorReview = mode === 'off'
    ? { mode }
    : mode === 'collapsed'
      ? { mode, left: view.left, onResume: () => setReview(state => resumeReview(state, pending)) }
      : {
          mode,
          counter: `${view.position} of ${view.total}`,
          card: current && (
            <ReviewCard
              key={current.id}
              speaker={current}
              possibleMatch={isPossibleMatch}
              initialTextExpanded={isPossibleMatch}
              clip={answer?.clip && {
                duration: formatDuration(answer.clip.end - answer.clip.start),
                text: answer.clip.text,
                playing: clipState.key === `clip:${current.id}` && clipState.playing,
                progress: clipState.key === `clip:${current.id}` ? clipState.progress : 0,
                disabled: !clipState.ready,
                onToggle: () => clip.toggle(`clip:${current.id}`, answer.clip!.start, answer.clip!.end),
              }}
              candidates={(answer?.candidates ?? []).map(candidate => ({
                id: candidate.speaker_id,
                name: candidate.name,
                colorIndex: speakers.find(speaker => speaker.id === candidate.speaker_id)?.color_index ?? 0,
                score: candidate.score,
                suggested: candidate.suggested,
              }))}
              selectedId={selectedId}
              busy={assign.isPending}
              onSelect={id => setPicked({ speakerId: current.id, candidateId: id === selectedId ? null : id })}
              onSearch={() => ask(current.id, 'choose', selectedId)}
              onAddNew={() => ask(current.id, 'new')}
              onSkip={() => setReview(state => skipSpeaker(state, pending))}
              onAssign={assignPicked}
              onClose={() => setReview(closeReview)}
            />
          ),
        }

  return (
    <Inspector review={dock} onClose={onClose}>
      {rows.length === 0
        ? <span className={styles.message}>No speakers</span>
        : (
          <>
            <TalkTime total={formatDuration(talkTotal(rows))} segments={rows} />
            <Stack gap="half">
              {shown.map(renderRow)}
              {collapsible && (
                <SpeakerRow
                  kind="show-more"
                  count={hidden.length}
                  expanded={showAll}
                  onToggle={() => setShowAll(all => !all)}
                  stack={<AvatarStack speakers={hidden.map(row => ({ id: row.id, ...avatarOf(row) }))} max={MAX_STACK} />}
                />
              )}
            </Stack>
          </>
        )}
    </Inspector>
  )
}
