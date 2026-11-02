import { useCallback, useLayoutEffect, useMemo, useRef, useState } from 'react'
import {
  useDeleteSegment, useSpeakers, useTranscript, useTranscripts, useUpdateSegmentText, useUpdateTranscriptTitle,
} from '../../api/queries'
import { effectiveSpeaker, type Speaker, type Transcript } from '../../api/types'
import { Button } from '../../components/Button/Button'
import { ScrollFade, useScrollEdges } from '../../components/ScrollFade/ScrollFade'
import { SpeakerMenu } from '../../components/SpeakerMenu/SpeakerMenu'
import { Stack } from '../../components/Stack/Stack'
import { toast } from '../../components/Toast/toast'
import { Toolbar, ToolbarDivider, ToolbarItem } from '../../components/Toolbar/Toolbar'
import { TranscriptHeader } from '../../components/TranscriptHeader/TranscriptHeader'
import { createKeyStore, useActiveSegment } from '../../media/active-segment'
import type { Playback } from '../../media/playback'
import { markNotImplemented } from '../../not-implemented'
import {
  buildTurns, formatRecordingDate, languageLabel, recordingTitle, speakerMenuRows, talkTimes, titleToSave,
} from './transcript'
import type { RecordingToDelete } from './DeleteRecordingDialog'
import { useSpeakerChange } from './useSpeakerChange'
import { TranscriptList, type MenuKey, type TranscriptRows } from './TranscriptList'
import { useTextSelection } from './useTextSelection'
import styles from './TranscriptPanel.module.css'

export interface SpeakerMenuTarget {
  currentId: string
  segmentStarts: readonly number[]
}

interface TranscriptPanelProps {
  transcriptId: number | null
  playback: Playback
  // Opens the list of all speakers for this turn or paragraph.
  onShowAllSpeakers?: (target: SpeakerMenuTarget) => void
  onDelete?: (recording: RecordingToDelete) => void
}

// Nothing shows until there is a recording and it has loaded: a flash of a spinner
// on data from this machine says less than a moment of an empty panel.
export function TranscriptPanel({ transcriptId, playback, onShowAllSpeakers, onDelete }: TranscriptPanelProps) {
  const transcript = useTranscript(transcriptId)
  const speakers = useSpeakers()

  if (transcriptId === null) return null
  if ((transcript.isError && !transcript.data) || (speakers.isError && !speakers.data)) {
    return (
      <Stack gap={2} align="start" padding={6}>
        <span className={styles.message}>Could not load this recording</span>
        <Button
          variant="secondary"
          size="small"
          onClick={() => {
            if (transcript.isError) transcript.refetch()
            if (speakers.isError) speakers.refetch()
          }}
        >
          Retry
        </Button>
      </Stack>
    )
  }
  if (!transcript.data || !speakers.data) return null
  return (
    <TranscriptView
      key={transcriptId}
      transcript={transcript.data}
      speakers={speakers.data}
      playback={playback}
      onShowAllSpeakers={onShowAllSpeakers}
      onDelete={onDelete}
    />
  )
}

type MenuTarget = { anchor: HTMLElement; currentId: string; segmentStarts: readonly number[] }

interface TranscriptViewProps {
  transcript: Transcript
  speakers: Speaker[]
  playback: Playback
  onShowAllSpeakers?: (target: SpeakerMenuTarget) => void
  onDelete?: (recording: RecordingToDelete) => void
}

async function copyToClipboard(text: string) {
  try {
    await window.electronAPI.writeClipboard(text)
    toast({ message: 'Copied' })
  } catch {
    toast({ message: 'Copy failed', type: 'error' })
  }
}

function TranscriptView({ transcript, speakers, playback, onShowAllSpeakers, onDelete }: TranscriptViewProps) {
  const { id: transcriptId, segments } = transcript
  const listed = useTranscripts().data?.find(item => item.id === transcriptId)
  const { mutate: rename } = useUpdateTranscriptTitle()
  const { mutate: saveText } = useUpdateSegmentText()
  const { mutate: removeSegment } = useDeleteSegment()
  const { change } = useSpeakerChange()

  const playing = useActiveSegment(playback, segments)
  const [editing] = useState(() => createKeyStore<number | null>(null))
  const [menuKey] = useState(() => createKeyStore<MenuKey>(null))
  const [menu, setMenu] = useState<MenuTarget | null>(null)

  const turns = useMemo(() => buildTurns(segments, speakers), [segments, speakers])
  const times = useMemo(() => talkTimes(segments), [segments])
  const title = recordingTitle(transcript, listed?.title)
  const deleteRecording = () => onDelete?.({ id: transcriptId, title })

  const rows = useMemo<TranscriptRows>(() => ({
    playing,
    editing,
    menu: menuKey,
    seek: start => playback.seek(start),
    play: start => {
      if (playback.getState().status !== 'ready') return
      playback.seek(start)
      if (playback.getState().paused) playback.toggle()
    },
    copy: copyToClipboard,
    save: (segmentStart, text) => saveText({ transcriptId, segmentStart, text }, {
      onError: error => toast({ message: `Failed to save edit: ${error.message}`, type: 'error' }),
    }),
    remove: segmentStart => removeSegment({ transcriptId, segmentStart }, {
      onError: error => toast({ message: `Failed to delete segment: ${error.message}`, type: 'error' }),
    }),
    openTurnMenu: (anchor, turn) => {
      menuKey.set(`turn:${turn.start}`)
      setMenu({ anchor, currentId: turn.speaker.id, segmentStarts: turn.segments.map(segment => segment.start) })
    },
    openSegmentMenu: (anchor, segment) => {
      menuKey.set(`segment:${segment.start}`)
      setMenu({ anchor, currentId: effectiveSpeaker(segment), segmentStarts: [segment.start] })
    },
  }), [playing, editing, menuKey, playback, transcriptId, saveText, removeSegment])

  const closeMenu = () => {
    menuKey.set(null)
    setMenu(null)
  }

  // Scrolling
  const { scrollRef, bottom } = useScrollEdges()
  const header = useRef<HTMLDivElement>(null)
  const [stuck, setStuck] = useState(false)
  const onScroll = (event: React.UIEvent<HTMLDivElement>) => {
    setStuck(event.currentTarget.scrollTop > (header.current?.offsetHeight ?? 0))
  }

  // Selection
  const content = useRef<HTMLDivElement>(null)
  const isEditing = useCallback(() => editing.get() !== null, [editing])
  const selection = useTextSelection(content, isEditing)
  const selectionBar = useRef<HTMLDivElement>(null)
  useLayoutEffect(() => {
    const bar = selectionBar.current
    if (!bar || !selection) return
    const half = bar.offsetWidth / 2
    bar.style.left = `${Math.max(half, Math.min(selection.x, content.current!.clientWidth - half))}px`
  }, [selection])

  return (
    <div className={styles.panel}>
      <div ref={scrollRef} data-transcript-scroll="" className={styles.scroll} onScroll={onScroll}>
        <div ref={content} className={styles.content}>
          <div ref={header}>
            <TranscriptHeader
              title={title}
              date={formatRecordingDate(listed?.created_at)}
              language={languageLabel(transcript.language)}
              onDelete={deleteRecording}
              onRename={typed => {
                const next = titleToSave(typed, title)
                if (next) rename({ transcriptId, title: next }, { onError: error => toast({ message: `Failed to rename: ${error.message}`, type: 'error' }) })
              }}
            />
          </div>
          {segments.length === 0 && <div className={styles.noSpeech}>No speech in this recording</div>}
          {segments.length > 0 && <TranscriptList turns={turns} rows={rows} />}
          {selection && (
            <div
              ref={selectionBar}
              className={styles.selectionBar}
              style={{ left: selection.x, top: selection.y }}
              onMouseDown={event => event.preventDefault()}
            >
              <Toolbar label="Selected text">
                <ToolbarItem>
                  <Button
                    variant="toolbar"
                    icon="copy"
                    onClick={() => {
                      const chosen = window.getSelection()
                      void copyToClipboard(chosen?.toString() ?? '')
                      chosen?.removeAllRanges()
                    }}
                  >
                    Copy
                  </Button>
                </ToolbarItem>
                <ToolbarDivider />
                <ToolbarItem><Button variant="toolbar" icon="highlight" {...markNotImplemented('transcript.highlight')}>Highlight</Button></ToolbarItem>
              </Toolbar>
            </div>
          )}
        </div>
      </div>
      {stuck && <TranscriptHeader sticky title={title} onDelete={deleteRecording} className={styles.sticky} />}
      {bottom && <ScrollFade edge="bottom" />}
      {menu && (
        <SpeakerMenu
          anchor={menu.anchor}
          allSpeakers={speakers.filter(speaker => speaker.name).length}
          rows={query => {
            const found = speakerMenuRows(speakers, times, menu.currentId, query)
            return {
              section: found.section,
              rows: found.rows.map(({ speaker, current, time, usage }) => ({
                id: speaker.id, name: speaker.name!, colorIndex: speaker.color_index, current, time, usage,
              })),
            }
          }}
          onSelect={speakerId => {
            change({ transcriptId, fromSpeakerId: menu.currentId, segmentStarts: menu.segmentStarts, target: { id: speakerId } }).catch((error: Error) => {
              toast({ message: `Failed to change speaker: ${error.message}`, type: 'error' })
            })
            closeMenu()
          }}
          onShowAll={() => {
            onShowAllSpeakers?.({ currentId: menu.currentId, segmentStarts: menu.segmentStarts })
            closeMenu()
          }}
          onClose={closeMenu}
        />
      )}
    </div>
  )
}
