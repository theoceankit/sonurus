import { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../../api/ApiProvider'
import { useSpeakers, useTranscripts } from '../../api/queries'
import { Sidebar, type SidebarSection } from '../../components/Sidebar/Sidebar'
import { Titlebar } from '../../components/Titlebar/Titlebar'
import { prefersReducedMotion, useLingering } from '../../presence'
import { cx } from '../../styles/cx'
import { createKeyStore } from '../../media/active-segment'
import { EmptyState } from '../Home/EmptyState'
import { ImportDialog } from '../Home/ImportDialog'
import { pickRecording, useRecentRecordings } from '../Home/last-opened'
import { useImportDialog } from '../Home/useImportDialog'
import { useSettingsDialog } from '../Settings/SettingsProvider'
import { QueueJobPanel } from '../Queue/QueueJobPanel'
import { QueueSection } from '../Queue/QueueSection'
import { SpeakersDialog } from '../Speakers/SpeakersDialog'
import type { Playback } from '../../media/playback'
import { DeleteRecordingDialog, type RecordingToDelete } from './DeleteRecordingDialog'
import { EditorPlayer, useTranscriptPlayback } from './EditorPlayer'
import { InspectorPanel } from './InspectorPanel'
import { INITIAL_PANELS, togglePanel, visiblePanels, type Panel } from './panels'
import { groupRecordings, stackSpeakers } from './recordings'
import { SpeakerDialogs, type SpeakerRequest } from './SpeakerDialogs'
import { TranscriptPanel, type SpeakerMenuTarget } from './TranscriptPanel'
import { useSpeakerChange } from './useSpeakerChange'
import styles from './EditorScreen.module.css'

// A recording to open from elsewhere, such as the toast of a finished job. Each
// request is a new object, so the same recording can be asked for again.
export type RecordingRequest = { id: number }

interface EditorScreenProps {
  openRequest?: RecordingRequest | null
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
  // For a story: a speaker standing highlighted, as if under the pointer.
  initialHighlight?: string
  // For a story: the Speakers window open.
  initialSpeakersOpen?: boolean
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

export function EditorScreen({ openRequest, pinnedIds, initialSelectedId = null, transcript, inspector, player, playback: givenPlayback, possibleMatches, initialSpeakerId, initialHighlight, initialSpeakersOpen = false }: EditorScreenProps) {
  const api = useApi()
  const transcripts = useTranscripts()
  const speakers = useSpeakers()
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  // A job picked in the queue takes the centre; the recording comes back when it goes.
  const [jobId, setJobId] = useState<string | null>(null)
  const shownId = jobId === null ? selectedId : null
  const clearJob = useCallback(() => setJobId(null), [])
  const recent = useRecentRecordings()
  const importer = useImportDialog()
  const settingsDialog = useSettingsDialog()
  const [panels, setPanels] = useState(INITIAL_PANELS)
  const ownPlayback = useTranscriptPlayback(givenPlayback ? null : shownId)
  const playback = givenPlayback ?? ownPlayback
  const [speakerRequest, setSpeakerRequest] = useState<SpeakerRequest | null>(null)
  const [toDelete, setToDelete] = useState<RecordingToDelete | null>(null)
  const [speakersOpen, setSpeakersOpen] = useState(initialSpeakersOpen)
  // Each opening starts on the list.
  const speakersWindow = useLingering(speakersOpen ? true : null)
  // The speaker under the pointer in the inspector, for the transcript and the player.
  // Only they listen to it: the screen renders nothing when it changes.
  const [highlight] = useState(() => createKeyStore<string | null>(initialHighlight ?? null))
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

  // With recordings there is always one open: at startup and after the open one is
  // deleted, the last one opened that is left.
  useEffect(() => {
    if (selectedId !== null || !transcripts.data || recent.ids === null) return
    const next = pickRecording(transcripts.data, recent.ids)
    if (next !== null) setSelectedId(next)
  }, [selectedId, transcripts.data, recent.ids])

  useEffect(() => {
    if (!openRequest) return
    setJobId(null)
    setSelectedId(openRequest.id)
  }, [openRequest])

  const { remember } = recent
  useEffect(() => {
    if (selectedId !== null) remember(selectedId)
  }, [selectedId, remember])

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
        isNew: !item.opened,
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
  // Only an answer with no recordings is empty: loading and failing are the sidebar's to say.
  const noRecordings = transcripts.data?.length === 0
  const center = useMemo(
    () => transcript ?? (jobId !== null
      ? <QueueJobPanel jobId={jobId} onGone={clearJob} />
      : noRecordings
        ? <EmptyState onOpenSettings={() => settingsDialog.open('models')} />
        : <TranscriptPanel transcriptId={selectedId} playback={playback} highlight={highlight} onShowAllSpeakers={showAllSpeakers} onDelete={setToDelete} />),
    [transcript, jobId, clearJob, noRecordings, selectedId, playback, highlight, showAllSpeakers, settingsDialog],
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
        onNewTranscription={importer.open}
        onOpenSettings={() => settingsDialog.open()}
        onOpenSpeakers={() => setSpeakersOpen(true)}
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
              selectedId={shownId}
              onSelect={id => {
                setJobId(null)
                setSelectedId(id)
              }}
              top={<QueueSection selectedJobId={jobId} onSelectJob={setJobId} />}
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
                transcriptId={shownId}
                playback={playback}
                open={visible.inspector}
                onClose={() => toggle('inspector')}
                onChooseSpeaker={setSpeakerRequest}
                possibleMatches={possibleMatches}
                initialSpeakerId={initialSpeakerId}
                highlight={highlight}
              />
            )}
          </div>
        </section>
        <section aria-label="Player" className={cx(styles.panel, styles.player)}>{player ?? <EditorPlayer transcriptId={shownId} playback={playback} highlight={highlight} />}</section>
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
      <ImportDialog {...importer.dialog} />
      {speakersWindow.value && (
        <SpeakersDialog
          key={speakersWindow.key}
          open={speakersWindow.open}
          playback={playback}
          onClose={() => setSpeakersOpen(false)}
          onExited={speakersWindow.exited}
          onOpenRecording={id => {
            setJobId(null)
            setSelectedId(id)
          }}
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
