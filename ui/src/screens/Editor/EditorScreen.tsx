import { useLayoutEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { useApi } from '../../api/ApiProvider'
import { useSpeakers, useTranscripts } from '../../api/queries'
import { Sidebar, type SidebarSection } from '../../components/Sidebar/Sidebar'
import { Titlebar } from '../../components/Titlebar/Titlebar'
import { cx } from '../../styles/cx'
import type { Playback } from '../../media/playback'
import { EditorPlayer, useTranscriptPlayback } from './EditorPlayer'
import { INITIAL_PANELS, togglePanel, visiblePanels, type Panel } from './panels'
import { groupRecordings, needsReview, stackSpeakers } from './recordings'
import { TranscriptPanel } from './TranscriptPanel'
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

export function EditorScreen({ pinnedIds, initialSelectedId = null, transcript, inspector, player, playback: givenPlayback }: EditorScreenProps) {
  const api = useApi()
  const transcripts = useTranscripts()
  const speakers = useSpeakers()
  const [selectedId, setSelectedId] = useState(initialSelectedId)
  const [panels, setPanels] = useState(INITIAL_PANELS)
  const ownPlayback = useTranscriptPlayback(givenPlayback ? null : selectedId)
  const playback = givenPlayback ?? ownPlayback
  const { element, width } = useWidth()
  const visible = visiblePanels(panels, width)
  const toggle = (panel: Panel) => setPanels(current => togglePanel(current, panel, width))

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

  const failed = transcripts.isError || speakers.isError
  const ready = transcripts.data && speakers.data

  return (
    <div ref={element} className={styles.screen}>
      <Titlebar
        sidebarOpen={visible.sidebar}
        onToggleSidebar={() => toggle('sidebar')}
        inspectorOpen={visible.inspector}
        onOpenInspector={() => toggle('inspector')}
      />
      <div className={cx(styles.panels, !visible.sidebar && styles.noSidebar, !visible.inspector && styles.noInspector)}>
        <aside aria-label="Recordings" hidden={!visible.sidebar} className={styles.sidebar}>
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
        </aside>
        <main aria-label="Transcript" className={cx(styles.panel, styles.center)}>{transcript ?? <TranscriptPanel transcriptId={selectedId} playback={playback} />}</main>
        <section aria-label="Inspector" hidden={!visible.inspector} className={cx(styles.panel, styles.inspector)}>{inspector}</section>
        <section aria-label="Player" className={cx(styles.panel, styles.player)}>{player ?? <EditorPlayer transcriptId={selectedId} playback={playback} />}</section>
      </div>
    </div>
  )
}
