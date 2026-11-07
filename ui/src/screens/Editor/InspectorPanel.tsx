import { useEffect, useLayoutEffect, useMemo, useRef, useState, useSyncExternalStore, type ComponentProps, type FocusEvent, type ReactNode } from 'react'
import { useApi } from '../../api/ApiProvider'
import type { SpeakerTarget } from '../../api/client'
import { useBackendConnected, useSpeakerCandidates, useSpeakers, useTranscript, useWaveform } from '../../api/queries'
import { effectiveSpeaker, type Speaker, type SpeakerCandidates, type Transcript } from '../../api/types'
import { avatarOf } from '../../components/Avatar/Avatar'
import { AvatarStack } from '../../components/AvatarStack/AvatarStack'
import { Button } from '../../components/Button/Button'
import { Collapse } from '../../components/Collapse/Collapse'
import { Inspector, type InspectorReview } from '../../components/Inspector/Inspector'
import { Reveal } from '../../components/Reveal/Reveal'
import { ReviewCard } from '../../components/ReviewCard/ReviewCard'
import { SpeakerRow, type SpeakerRowProps } from '../../components/SpeakerRow/SpeakerRow'
import { TalkTime } from '../../components/TalkTime/TalkTime'
import { toast } from '../../components/Toast/toast-store'
import { BAR_COUNT } from '../../components/Waveform/bars'
import { createKeyStore, useIsKey, useKey, type KeyStore } from '../../media/active-segment'
import { useClipPlayback, useClipState } from '../../media/clip-playback'
import type { Playback } from '../../media/playback'
import { formatDuration } from '../../media/timeline'
import { firstSegmentOf, pendingReview, rowSlots, speakerRows, splitRows, talkTotal, type SpeakerRowData } from './inspector'
import { createHoverIntent, type HoverIntent } from './hover-intent'
import styles from './InspectorPanel.module.css'
import { closeReview, openReview, resumeReview, reviewView, selectSpeaker, skipSpeaker } from './review-queue'
import type { SpeakerRequest } from './SpeakerDialogs'
import { useSpeakerChange } from './useSpeakerChange'

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
  // The speaker under the pointer or the keyboard here, for the transcript and the
  // player to show too.
  highlight?: KeyStore<string | null>
}

// Nothing shows until the recording has loaded, as in the transcript.
export function InspectorPanel({ transcriptId, playback, open = true, onClose, onChooseSpeaker, possibleMatches, initialSpeakerId, highlight }: InspectorPanelProps) {
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
      highlight={highlight}
    />
  )
}

interface InspectorViewProps extends Omit<InspectorPanelProps, 'transcriptId'> {
  transcript: Transcript
  speakers: Speaker[]
  candidates: SpeakerCandidates
}

function InspectorView({ transcript, speakers, candidates, playback, open, onClose, onChooseSpeaker, possibleMatches, initialSpeakerId, highlight: givenHighlight }: InspectorViewProps) {
  const api = useApi()
  const { id: transcriptId, segments } = transcript
  const { change, busy } = useSpeakerChange()
  const clip = useClipPlayback(playback, api.getAudioUrl(transcript), useBackendConnected())
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
  // Opened by hand, the list stays open until the room changes.
  const [rowsBox, setRowsBox] = useState<HTMLElement | null>(null)
  const slots = useRowSlots(rowsBox)
  const [showAll, setShowAll] = useState(false)
  const [openedIn, setOpenedIn] = useState(slots)
  if (openedIn !== slots) {
    setOpenedIn(slots)
    setShowAll(false)
  }
  const [picked, setPicked] = useState<{ speakerId: string; candidateId: string | null } | null>(null)

  useEffect(() => { clip.stop() }, [clip, currentId, mode, open])

  const [ownHighlight] = useState(() => createKeyStore<string | null>(null))
  const highlight = givenHighlight ?? ownHighlight
  const intent = useMemo(() => createHoverIntent(highlight), [highlight])
  useEffect(() => () => intent.cancel(), [intent])
  const { visible, hidden } = splitRows(rows, mode === 'on' ? currentId : null, slots ?? null)
  const collapsible = hidden.length > 0
  useClearedHighlight(highlight, intent, rows, [showAll, mode, open, slots])

  const answer = currentId ? candidates[currentId] : undefined
  const [clipBars, setClipBars] = useState(BAR_COUNT.small)
  const clipLevels = useWaveform(answer?.clip ? transcriptId : null, {
    bars: clipBars, start: answer?.clip?.start ?? 0, end: answer?.clip?.end ?? 0,
  }).data
  const current = rows.find(row => row.id === currentId)
  const isPossibleMatch = current?.kind === 'named'
  const selectedId = picked?.speakerId === currentId
    ? picked.candidateId
    : isPossibleMatch ? answer?.candidates.find(candidate => candidate.suggested)?.speaker_id ?? null : null

  // All segments of a voice. Rejects if it fails: whoever asked says so in its own place.
  const assignVoice = async (speakerId: string, target: SpeakerTarget) => {
    const segmentStarts = segments.filter(segment => effectiveSpeaker(segment) === speakerId).map(segment => segment.start)
    const reviewed = pending.includes(speakerId)
    await change({ transcriptId, fromSpeakerId: speakerId, segmentStarts, target }, () => {
      setConfirmed(ids => ids.filter(id => id !== speakerId))
      if (reviewed) setReview(state => selectSpeaker(state, speakerId))
    })
    if (isPossibleMatch && speakerId === currentId) setConfirmed(ids => [...ids, speakerId])
    // An undo brings the card back with nothing chosen, like any other.
    setPicked(null)
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
    const leave = () => intent.leave(row.id)
    return (
      <HighlightedRow
        key={row.id}
        highlight={highlight}
        speaker={row}
        time={row.time}
        onPointerEnter={() => intent.enter(row.id)}
        onPointerLeave={leave}
        onFocus={() => intent.focus(row.id)}
        onBlur={(event: FocusEvent) => { if (!event.currentTarget.contains(event.relatedTarget)) leave() }}
        selected={mode === 'on' && row.id === currentId}
        onSelect={pending.includes(row.id) ? () => setReview(state => selectSpeaker(state, row.id)) : undefined}
        onPlay={row.kind === 'unassigned' || !first ? undefined : () => clip.toggle(key, first.start, first.end)}
        playing={clipState.key === key && clipState.playing}
        playDisabled={!clipState.ready}
        onAssign={() => ask(row.id, 'choose')}
      />
    )
  }

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
                heights: clipLevels,
                onBarCount: setClipBars,
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
              busy={busy}
              onSelect={id => setPicked({ speakerId: current.id, candidateId: id === selectedId ? null : id })}
              onMore={() => ask(current.id, 'choose', selectedId)}
              onSkip={() => setReview(state => skipSpeaker(state, pending))}
              onAssign={assignPicked}
              onClose={() => setReview(closeReview)}
            />
          ),
        }

  const showMore = collapsible && (
    <ShowMoreRow
      highlight={highlight}
      hiddenIds={showAll ? [] : hidden.map(row => row.id)}
      count={hidden.length}
      expanded={showAll}
      onToggle={() => setShowAll(all => !all)}
      stack={<AvatarStack speakers={hidden.map(row => ({ id: row.id, ...avatarOf(row) }))} max={MAX_STACK} />}
    />
  )

  return (
    <Inspector review={dock} onClose={onClose}>
      {rows.length === 0
        ? <span className={styles.message}>No speakers</span>
        : (
          <>
            <HighlightedTalkTime highlight={highlight} intent={intent} total={formatDuration(talkTotal(rows))} segments={rows} />
            <div ref={setRowsBox} className={styles.rows}>
              {/* Rows fold away and come back as the room changes; the speakers
                  shown stay where they are when the rest open under them. They
                  wait for the first measure, so that nothing folds on opening. */}
              {slots !== undefined && rows.map(row => (
                <Reveal key={row.id} open={visible.includes(row)}>
                  <div className={styles.row}>{renderRow(row)}</div>
                </Reveal>
              ))}
              {slots !== undefined && collapsible && (
                <Collapse open={showAll}>
                  {hidden.map(row => <div key={row.id} className={styles.row}>{renderRow(row)}</div>)}
                </Collapse>
              )}
              {slots !== undefined && showMore}
            </div>
          </>
        )}
    </Inspector>
  )
}

// How many rows the room under talk time holds. The box takes the room whatever is
// in it, so what shows does not change what is measured. Measured before the first
// paint (undefined until then); with no height (not laid out, or hidden) it is not known.
function useRowSlots(box: HTMLElement | null) {
  const [slots, setSlots] = useState<number | null | undefined>(undefined)
  useLayoutEffect(() => {
    if (!box) return
    const measure = () => setSlots(box.clientHeight > 0 ? rowSlots(box.clientHeight) : null)
    measure()
    const resized = new ResizeObserver(measure)
    resized.observe(box)
    return () => resized.disconnect()
  }, [box])
  return slots
}

// A row that goes away under the pointer reports no leaving: so the highlight goes
// with the speaker, with a change of what shows, and with the panel itself.
function useClearedHighlight(highlight: KeyStore<string | null>, intent: HoverIntent, rows: readonly SpeakerRowData[], shown: readonly unknown[]) {
  const last = useRef(shown)
  useEffect(() => {
    const id = highlight.get()
    const changed = shown.some((value, i) => value !== last.current[i])
    last.current = shown
    if (changed) intent.cancel()
    if (id !== null && (changed || !rows.some(row => row.id === id))) highlight.set(null)
  })
  useEffect(() => () => highlight.set(null), [highlight])
}

// The highlight changes as the pointer moves: only what it concerns renders, not the
// panel with its review card.
type Highlighting = { highlight: KeyStore<string | null> }

function HighlightedTalkTime({ highlight, intent, ...props }: Highlighting & { intent: HoverIntent } & Omit<ComponentProps<typeof TalkTime>, 'highlightedId' | 'onHighlight'>) {
  return (
    <TalkTime
      {...props}
      highlightedId={useKey(highlight)}
      onHighlight={id => id === null ? intent.leave() : intent.enter(id)}
    />
  )
}

function HighlightedRow({ highlight, ...props }: Highlighting & Extract<SpeakerRowProps, { time: string }> & { speaker: SpeakerRowData }) {
  return <SpeakerRow {...props} highlighted={useIsKey(highlight, props.speaker.id)} />
}

function ShowMoreRow({ highlight, hiddenIds, ...props }: Highlighting & { hiddenIds: readonly string[]; count: number; expanded: boolean; onToggle: () => void; stack: ReactNode }) {
  const highlighted = useSyncExternalStore(highlight.subscribe, () => hiddenIds.includes(highlight.get() ?? ''))
  return <SpeakerRow kind="show-more" {...props} highlighted={highlighted} />
}
