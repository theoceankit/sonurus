import { useQueryClient } from '@tanstack/react-query'
import { useCallback, useEffect, useLayoutEffect, useMemo, useReducer, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../../api/ApiProvider'
import { queryKeys, useSetOpened, useSpeakers, useTranscripts, useUpdateTranscriptTitle } from '../../api/queries'
import { MenuAction, MenuDivider } from '../../components/Menu/Menu'
import { Sidebar, type SidebarRecording, type SidebarSection } from '../../components/Sidebar/Sidebar'
import { toast } from '../../components/Toast/toast-store'
import { markNotImplemented } from '../../not-implemented'
import { Titlebar } from '../../components/Titlebar/Titlebar'
import { returnFocus } from '../../components/Tooltip/Tooltip'
import { prefersReducedMotion, useLingering } from '../../presence'
import { cx } from '../../styles/cx'
import { createKeyStore } from '../../media/active-segment'
import { EmptyState } from '../Home/EmptyState'
import { ImportDialog } from '../Home/ImportDialog'
import { NewRecordingDialog } from '../Home/NewRecordingDialog'
import { pickRecording, useRecentRecordings } from '../Home/last-opened'
import { useNewTranscription } from '../Home/useNewTranscription'
import { useSettingsDialog } from '../Settings/SettingsProvider'
import { QueueJobPanel } from '../Queue/QueueJobPanel'
import { QueueSection } from '../Queue/QueueSection'
import { LiveRecordingPill, LiveRecordingSection } from '../../recording/LiveRecording'
import { SpeakersDialog } from '../Speakers/SpeakersDialog'
import type { Playback } from '../../media/playback'
import { DeleteRecordingDialog, type RecordingToDelete } from './DeleteRecordingDialog'
import { EditorPlayer, useTranscriptPlayback } from './EditorPlayer'
import { InspectorPanel } from './InspectorPanel'
import { INITIAL_PANELS, togglePanel, visiblePanels, type Panel } from './panels'
import { goneFromList, groupRecordings, leftList, stackSpeakers } from './recordings'
import { useEscapeClose } from './escape-close'
import { useHistoryKeys } from './history-keys'
import { canGoBack, canGoForward, initialSelection, needsPick, selectionReducer, shownRecording } from './selection'
import { SpeakerDialogs, type SpeakerRequest } from './SpeakerDialogs'
import { titleToSave } from './transcript'
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
  const queries = useQueryClient()
  const transcripts = useTranscripts()
  const speakers = useSpeakers()
  const [selection, select] = useReducer(selectionReducer, initialSelectedId, initialSelection)
  const { recordingId: selectedId, jobId } = selection
  const shownId = shownRecording(selection)
  const clearJob = useCallback(() => select({ type: 'jobGone' }), [])
  const openRecording = useCallback((id: number) => select({ type: 'open', id }), [])
  const showJob = useCallback((id: string) => select({ type: 'showJob', id }), [])
  const goBack = useCallback(() => select({ type: 'back' }), [])
  const goForward = useCallback(() => select({ type: 'forward' }), [])
  useHistoryKeys(goBack, goForward)
  // Escape closes the recording or the job in the centre, and the sound stops with it.
  useEscapeClose(() => select({ type: 'close' }), selectedId !== null || jobId !== null)
  const recent = useRecentRecordings()
  const newTranscription = useNewTranscription()
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
  const [renamingId, setRenamingId] = useState<number | null>(null)
  const { mutate: rename } = useUpdateTranscriptTitle()
  const { mutate: setOpened } = useSetOpened()

  // The menu of a recording in the sidebar. A right click does not open it.
  const rowMenu = useCallback(({ id, title, isNew }: SidebarRecording) => (
    <>
      <MenuAction icon="edit" onSelect={() => setRenamingId(id)}>Rename</MenuAction>
      <MenuAction
        icon="eye"
        onSelect={() => setOpened({ transcriptId: id, opened: isNew }, {
          onError: error => toast({ message: `Could not mark as ${isNew ? 'read' : 'unread'}: ${error.message}`, type: 'error' }),
        })}
      >
        {isNew ? 'Mark as read' : 'Mark as unread'}
      </MenuAction>
      <MenuAction icon="pin" {...markNotImplemented('sidebar.pin')}>Pin</MenuAction>
      <MenuDivider />
      <MenuAction icon="delete" onSelect={() => setToDelete({ id, title })}>Delete recording</MenuAction>
    </>
  ), [setOpened])
  const renameDone = (id: number, typed: string | null) => {
    setRenamingId(null)
    const current = transcripts.data?.find(item => item.id === id)?.title ?? ''
    const next = typed === null ? null : titleToSave(typed, current)
    if (next) rename({ transcriptId: id, title: next }, { onError: error => toast({ message: `Failed to rename: ${error.message}`, type: 'error' }) })
  }
  const { change: changeSpeaker } = useSpeakerChange()
  const latestChange = useRef(changeSpeaker)
  latestChange.current = changeSpeaker
  const { element, width } = useWidth()
  const visible = visiblePanels(panels, width)
  const panelsArea = useRef<HTMLDivElement>(null)
  const stopMoving = useRef<ReturnType<typeof setTimeout>>(undefined)
  useEffect(() => () => clearTimeout(stopMoving.current), [])

  // A recording deleted elsewhere lets go: nothing of it stays on the screen or in the
  // cache, and the effect below opens another one. Any other one gone from the list
  // leaves the history of Back and Forward.
  const listedIds = useRef<number[] | null>(null)
  useEffect(() => {
    if (!transcripts.data) return
    const ids = transcripts.data.map(item => item.id)
    if (goneFromList(selectedId, listedIds.current, ids)) {
      queries.removeQueries({ queryKey: queryKeys.transcript(selectedId!) })
      queries.removeQueries({ queryKey: ['waveform', selectedId] })
    }
    for (const id of leftList(listedIds.current, ids)) select({ type: 'gone', id })
    listedIds.current = ids
  }, [transcripts.data, selectedId, queries])

  // With recordings there is always one open unless the user closed it: at startup
  // and after the open one is deleted, the last one opened that is left.
  const pickNeeded = needsPick(selection)
  useEffect(() => {
    if (!pickNeeded || !transcripts.data || recent.ids === null) return
    const next = pickRecording(transcripts.data, recent.ids)
    if (next !== null) select({ type: 'pick', id: next })
  }, [pickNeeded, transcripts.data, recent.ids])

  useEffect(() => {
    if (openRequest) openRecording(openRequest.id)
  }, [openRequest, openRecording])

  const { remember, prune } = recent
  useEffect(() => {
    if (selectedId !== null) remember(selectedId)
  }, [selectedId, remember])
  useEffect(() => {
    if (transcripts.data) prune(transcripts.data)
  }, [transcripts.data, prune])

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

  // The inspector's two buttons each go as the panel moves, and the focus they had would
  // go with them. Focus from the keyboard goes on to the one that brings the panel back;
  // after a click there is no focus to keep.
  const focusNext = useRef<{ from: Element; to: string } | null>(null)
  const toggleInspector = () => {
    const from = document.activeElement
    if (from instanceof HTMLButtonElement && from.matches(':focus-visible')) focusNext.current = { from, to: visible.inspector ? 'Show inspector' : 'Close inspector' }
    toggle('inspector')
  }
  // The opening panel stays hidden for the first frame of its move (visibility, which
  // cannot take focus), so the focus waits for it. Anything else taking the focus first wins.
  useEffect(() => {
    const next = focusNext.current
    focusNext.current = null
    const to = next && element.current?.querySelector<HTMLElement>(`button[aria-label="${next.to}"]:not([inert])`)
    if (!next || !to) return
    let frame = 0
    let frames = 0
    const tryFocus = () => {
      const now = document.activeElement
      if (now !== next.from && now !== document.body && now !== null) return
      returnFocus(to)
      if (document.activeElement !== to && ++frames < 30) frame = requestAnimationFrame(tryFocus)
    }
    tryFocus()
    return () => cancelAnimationFrame(frame)
  }, [visible.inspector])

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
  // A recording closed by the user leaves the same: how to make a new one.
  const empty = transcripts.data?.length === 0 || selection.closed
  const center = useMemo(
    () => transcript ?? (jobId !== null
      ? <QueueJobPanel jobId={jobId} onGone={clearJob} />
      : empty
        ? <EmptyState onOpenSettings={() => settingsDialog.open('models')} />
        : <TranscriptPanel transcriptId={selectedId} playback={playback} highlight={highlight} onShowAllSpeakers={showAllSpeakers} onDelete={setToDelete} />),
    [transcript, jobId, clearJob, empty, selectedId, playback, highlight, showAllSpeakers, settingsDialog],
  )

  // A refresh that fails leaves what was loaded on the screen.
  const failed = (transcripts.isError && !transcripts.data) || (speakers.isError && !speakers.data)
  const ready = transcripts.data && speakers.data

  return (
    <div ref={element} className={styles.screen}>
      <Titlebar
        sidebarOpen={visible.sidebar}
        onToggleSidebar={() => toggle('sidebar')}
        canGoBack={canGoBack(selection)}
        canGoForward={canGoForward(selection)}
        onBack={goBack}
        onForward={goForward}
        inspectorOpen={visible.inspector}
        onOpenInspector={toggleInspector}
        onNewTranscription={newTranscription.openRecording}
        onOpenSettings={() => settingsDialog.open()}
        onOpenSpeakers={() => setSpeakersOpen(true)}
        status={!visible.sidebar && <LiveRecordingPill />}
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
              onSelect={openRecording}
              rowMenu={rowMenu}
              renamingId={renamingId}
              onRenameDone={renameDone}
              top={<><LiveRecordingSection /><QueueSection selectedJobId={jobId} onSelectJob={showJob} /></>}
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
                onClose={toggleInspector}
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
      <NewRecordingDialog {...newTranscription.record} />
      <ImportDialog {...newTranscription.importer} />
      {speakersWindow.value && (
        <SpeakersDialog
          key={speakersWindow.key}
          open={speakersWindow.open}
          playback={playback}
          onClose={() => setSpeakersOpen(false)}
          onExited={speakersWindow.exited}
          onOpenRecording={openRecording}
        />
      )}
      {deleteDialog.value && (
        <DeleteRecordingDialog
          key={deleteDialog.key}
          recording={deleteDialog.value}
          open={deleteDialog.open}
          // Another recording than the open one leaves it open.
          onDeleted={() => select({ type: 'gone', id: deleteDialog.value!.id })}
          onClose={() => setToDelete(null)}
          onExited={deleteDialog.exited}
        />
      )}
    </div>
  )
}
