import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../../api/ApiProvider'
import { useSpeakers, useTranscripts } from '../../api/queries'
import { Sidebar, type SidebarSection } from '../../components/Sidebar/Sidebar'
import { Titlebar } from '../../components/Titlebar/Titlebar'
import { prefersReducedMotion, useLingering } from '../../presence'
import { cx } from '../../styles/cx'
import type { Playback } from '../../media/playback'
import { DeleteRecordingDialog, type RecordingToDelete } from './DeleteRecordingDialog'
import { EditorPlayer, useTranscriptPlayback } from './EditorPlayer'
import { InspectorPanel } from './InspectorPanel'
import { INITIAL_PANELS, togglePanel, visiblePanels, type Panel } from './panels'
import { groupRecordings, needsReview, stackSpeakers } from './recordings'
import { SpeakerDialogs, type SpeakerRequest } from './SpeakerDialogs'
import { TranscriptPanel, type SpeakerMenuTarget } from './TranscriptPanel'
import { useSpeakerChange } from './useSpeakerChange'
import styles from './EditorScreen.module.css'

interface EditorScreenProps {
  // Nothing in the API says a recording is pinned yet.
  pinnedIds?: number[]
  initialSelectedId?: number | null
  transcript?: ReactNode
  inspector?: ReactNode
  player?: ReactNode
  // For a story: playback standing where the board shows it, with no audio.
  playback?: Playback
  // For a story: what only a board shows.
  possibleMatches?: boolean
  initialSpeakerId?: string
}

// Wide until measured, and a width from the screen itself rather than the window,
// so a story can show any size.
function useWidth() {
  const element = useRef<HTMLDivElement>(null)
  const [width, setWidth] = useState(Infinity)
  useLayoutEffect(() => {
    const node = element.current!
    const measure = () => { if (node.clientWidth > 0) setWidth(node.clientWidth) }
    measure()
    const observer = new ResizeObserver(measure)
    observer.observe(node)
    return () => observer.disconnect()
  }, [])
  return { element, width }
}

export function EditorScreen({ pinnedIds, initialSelectedId = null, transcript, inspector, player, playback: givenPlayback, possibleMatches, initialSpeakerId }: EditorScreenProps) {
  const api = useApi()
  const transcripts = useTranscripts()
  const speakers = useSpeakers()
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [panels, setPanels] = useState(INITIAL_PANELS)
  const ownPlayback = useTranscriptPlayback(givenPlayback ? null : selectedId)
  const playback = givenPlayback ?? ownPlayback
  const [speakerRequest, setSpeakerRequest] = useState<SpeakerRequest | null>(null)
  const [toDelete, setToDelete] = useState<RecordingToDelete | null>(null)
  const speakerDialog = useLingering(speakerRequest)
  const deleteDialog = useLingering(toDelete)
  const { change: changeSpeaker } = useSpeakerChange()
  const latestChange = useRef(changeSpeaker)
  latestChange.current = changeSpeaker
  const { element, width } = useWidth()
  const visible = visiblePanels(panels, width)
  const panelsArea = useRef<HTMLDivElement>(null)
  const stopMoving = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(stopMoving.current), [])

  // On the element and not in state: the frames of this move are the last place for a render.
  const toggle = (panel: Panel) => {
    const area = panelsArea.current!
    if (!prefersReducedMotion()) {
      const duration = parseFloat(getComputedStyle(area).getPropertyValue('--duration-move')) || 0
      area.dataset.moving = ''
      clearTimeout(stopMoving.current)
      stopMoving.current = setTimeout(() => { delete area.dataset.moving }, duration)
    }
    setPanels(current => togglePanel(current, panel, width))
  }

  const sections = useMemo<SidebarSection[]>(() => {
    if (!transcripts.data || !speakers.data) return []
    const known = speakers.data
    return groupRecordings(transcripts.data, api.now(), pinnedIds).map(({ title, items }) => ({
      title,
      recordings: items.map(item => ({
        id: item.id,
        title: item.title,
        speakers: stackSpeakers(item.speakers, known),
        needsReview: needsReview(item.speakers, known),
      })),
    }))
  }, [api, transcripts.data, speakers.data, pinnedIds])

  const showAllSpeakers = useCallback(({ currentId, segmentStarts }: SpeakerMenuTarget) => {
    if (selectedId === null) return
    const transcriptId = selectedId
    setSpeakerRequest({
      transcriptId,
      speakerId: currentId,
      start: 'choose',
      onAssign: target => latestChange.current({ transcriptId, fromSpeakerId: currentId, segmentStarts, target }),
    })
  }, [selectedId])

  // Moving a panel asks nothing new of the transcript, and on a long recording it is the
  // most expensive thing to render.
  const center = useMemo(
    () => transcript ?? <TranscriptPanel transcriptId={selectedId} playback={playback} onShowAllSpeakers={showAllSpeakers} onDelete={setToDelete} />,
    [transcript, selectedId, playback, showAllSpeakers],
  )

  // A refresh that fails leaves what was loaded on the screen.
  const failed = (transcripts.isError && !transcripts.data) || (speakers.isError && !speakers.data)
  const ready = transcripts.data && speakers.data

  return (
    <div ref={element} className={styles.screen}>
      <Titlebar
        sidebarOpen={visible.sidebar}
        onToggleSidebar={() => toggle('sidebar')}
        inspectorOpen={visible.inspector}
        onOpenInspector={() => toggle('inspector')}
      />
      <div
        ref={panelsArea}
        className={cx(styles.panels, !visible.sidebar && styles.noSidebar, !visible.inspector && styles.noInspector)}
      >
        <aside aria-label="Recordings" inert={!visible.sidebar} className={cx(styles.slot, styles.sidebarSlot)}>
          <div className={styles.sidebar}>
            <Sidebar
              state={failed ? 'error' : ready ? 'ready' : 'loading'}
              sections={sections}
              selectedId={selectedId}
              onSelect={setSelectedId}
              onRetry={() => {
                if (transcripts.isError) transcripts.refetch()
                if (speakers.isError) speakers.refetch()
              }}
            />
          </div>
        </aside>
        <main aria-label="Transcript" className={cx(styles.panel, styles.center)}>{center}</main>
        <section aria-label="Inspector" inert={!visible.inspector} className={cx(styles.slot, styles.inspectorSlot)}>
          <div className={cx(styles.panel, styles.inspector)}>
            {inspector ?? (
              <InspectorPanel
                transcriptId={selectedId}
                playback={playback}
                open={visible.inspector}
                onClose={() => toggle('inspector')}
                onChooseSpeaker={setSpeakerRequest}
                possibleMatches={possibleMatches}
                initialSpeakerId={initialSpeakerId}
              />
            )}
          </div>
        </section>
        <section aria-label="Player" className={cx(styles.panel, styles.player)}>{player ?? <EditorPlayer transcriptId={selectedId} playback={playback} />}</section>
      </div>
      {speakerDialog.value && (
        <SpeakerDialogs
          key={speakerDialog.key}
          request={speakerDialog.value}
          open={speakerDialog.open}
          onClose={() => setSpeakerRequest(null)}
          onExited={speakerDialog.exited}
        />
      )}
      {deleteDialog.value && (
        <DeleteRecordingDialog
          key={deleteDialog.key}
          recording={deleteDialog.value}
          open={deleteDialog.open}
          onDeleted={() => setSelectedId(null)}
          onClose={() => setToDelete(null)}
          onExited={deleteDialog.exited}
        />
      )}
    </div>
  )
}
