import { useEffect, useMemo, useRef, useState } from 'react'
import { useDeleteSpeaker, useQueue, useSpeakers, useUpdateSpeaker } from '../../api/queries'
import type { Speaker } from '../../api/types'
import { Button } from '../../components/Button/Button'
import { Candidate } from '../../components/Candidate/Candidate'
import { MenuItem } from '../../components/MenuItem/MenuItem'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { ScrollBar } from '../../components/ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../../components/ScrollFade/ScrollFade'
import { SearchField } from '../../components/SearchField/SearchField'
import { SectionHeader } from '../../components/SectionHeader/SectionHeader'
import { toast } from '../../components/Toast/toast-store'
import type { Playback } from '../../media/playback'
import { useSamplePlayback } from '../../media/sample-playback'
import { formatDuration } from '../../media/timeline'
import { markNotImplemented } from '../../not-implemented'
import { useLingering } from '../../presence'
import { speakerColor } from '../../styles/speaker-colors'
import { DeleteSpeakerDialog } from './DeleteSpeakerDialog'
import { DiscardChangesDialog } from './DiscardChangesDialog'
import { SpeakerCard } from './SpeakerCard'
import {
  categoryCounts, deleteBlockReason, draftChanges, draftDirty, duplicateNameIds, filterSpeakers, speakerAfter, speakerDisplayName,
  speakerDraft, speakerUsage, type SpeakerDraft, type SpeakersCategory,
} from './speakers'
import styles from './SpeakersDialog.module.css'

const CATEGORIES: { id: SpeakersCategory; label: string; icon: 'speakers' | 'check' | 'info' }[] = [
  { id: 'all', label: 'All speakers', icon: 'speakers' },
  { id: 'named', label: 'Recognized', icon: 'check' },
  { id: 'unnamed', label: 'Unnamed', icon: 'info' },
]

export interface SpeakersDialogProps {
  open: boolean
  onClose: () => void
  onExited?: () => void
  // Opens a recording in the Editor; the window closes first.
  onOpenRecording: (id: number) => void
  // The Editor's player: a voice sample pauses it.
  playback: Playback
  // For a story: a speaker open, a category, a search, the window in place.
  initialSpeakerId?: string | null
  initialCategory?: SpeakersCategory
  initialQuery?: string
  preview?: boolean
}

function SpeakerList({ speakers, query, category, onOpen }: { speakers: Speaker[]; query: string; category: SpeakersCategory; onOpen: (id: string) => void }) {
  const { area, scrollRef, bottom } = useScrollEdges()
  const duplicates = useMemo(() => duplicateNameIds(speakers), [speakers])
  const shown = filterSpeakers(speakers, query, category)
  const typed = query.trim()
  return (
    <div className={styles.listArea}>
      <div ref={scrollRef} className={styles.list} aria-label="Speakers">
        {shown.map(speaker => {
          const usage = speakerUsage(speaker)
          return (
            <Candidate
              key={speaker.id}
              speaker={speaker.name ? { name: speaker.name, color: speakerColor(speaker.color_index) } : { kind: 'unknown', name: speakerDisplayName(speaker) }}
              badge={duplicates.has(speaker.id) ? 'same name' : undefined}
              usage={usage.recordings}
              time={usage.time === null ? undefined : formatDuration(usage.time)}
              onClick={() => onOpen(speaker.id)}
            />
          )
        })}
        {shown.length === 0 && (
          <SectionHeader title={
            speakers.length === 0 ? 'No speakers yet. They appear here after a transcription.'
              : typed ? `No speakers match "${typed}"`
                : 'No speakers here yet'
          } />
        )}
      </div>
      <ScrollBar area={area} />
      {bottom && <ScrollFade edge="bottom" surface="raised" />}
    </div>
  )
}

// Everyone the app knows, by category, and one of them at a time in place of the list.
// A card's name and colour are saved with Save; leaving a card with edits asks first.
export function SpeakersDialog({
  open, onClose, onExited, onOpenRecording, playback, initialSpeakerId = null, initialCategory = 'all', initialQuery = '', preview,
}: SpeakersDialogProps) {
  const speakers = useSpeakers()
  const queue = useQueue()
  const sample = useSamplePlayback(playback)
  const [category, setCategory] = useState<SpeakersCategory>(initialCategory)
  const [query, setQuery] = useState(initialQuery)
  const [openId, setOpenId] = useState<string | null>(initialSpeakerId)
  const [toDelete, setToDelete] = useState<Speaker | null>(null)
  const deleting = useLingering(toDelete)
  const { mutateAsync: remove, isPending: removing } = useDeleteSpeaker()
  const cancelEdit = useRef<() => boolean>(() => false)
  const [edited, setEdited] = useState<SpeakerDraft | null>(null)
  const [saveError, setSaveError] = useState<string>()
  const { mutateAsync: update, isPending: saving } = useUpdateSpeaker()
  // Where to go once the edits are discarded.
  const [leaving, setLeaving] = useState<{ go: () => void } | null>(null)
  const asking = useLingering(leaving)

  const rows = speakers.data ?? []
  const current = rows.find(speaker => speaker.id === openId) ?? null
  const counts = categoryCounts(rows)
  const blocked = deleteBlockReason(queue.data)
  const draft = current ? (edited?.id === current.id ? edited : speakerDraft(current)) : null
  const dirty = Boolean(current && draft && draftDirty(draft, current))
  const changes = current && draft ? draftChanges(draft, current) : null

  const revert = () => {
    setEdited(null)
    setSaveError(undefined)
  }
  // Leaving a card with edits asks first; without them it just goes.
  const leave = (go: () => void) => {
    if (!dirty) return go()
    setLeaving({ go })
  }
  const save = async () => {
    if (!current || !changes || saving) return
    try {
      // Resolves once the speakers are read again, so the card shows what was saved.
      await update({ speakerId: current.id, update: changes })
      revert()
    } catch (error) {
      const text = (error as Error).message
      if (changes.name) setSaveError(text)
      else toast({ message: `Could not save: ${text}`, type: 'error' })
    }
  }

  // A speaker that went (deleted here or elsewhere, or all data reset) leaves the list.
  useEffect(() => {
    if (openId !== null && speakers.data && !current) setOpenId(null)
  }, [openId, speakers.data, current])

  // Edits belong to the card they were made in.
  useEffect(() => { revert() }, [openId])

  // A sample stops with the speaker it belongs to, and with the window.
  useEffect(() => { sample.stop() }, [sample, openId, open])

  const confirmDelete = async () => {
    const speaker = toDelete!
    // Who comes next is who was next when the delete was asked for.
    const next = speakerAfter(filterSpeakers(rows, query, category).map(row => row.id), speaker.id)
    try {
      await remove(speaker.id)
      setOpenId(next)
      toast({ message: speaker.name ? `Deleted "${speaker.name}".` : 'Deleted the speaker.' })
    } catch (error) {
      toast({ message: `Could not delete: ${(error as Error).message}`, type: 'error' })
    }
    setToDelete(null)
  }

  return (
    <>
      <Modal
        size="large"
        open={open}
        onExited={onExited}
        preview={preview}
        onOpenChange={next => {
          // Escape in the name field takes back the edits first.
          if (!next && !cancelEdit.current()) leave(onClose)
        }}
      >
        <ModalHeader title="Speakers" />
        <ModalBody className={styles.body}>
          <nav aria-label="Categories" className={styles.rail}>
            {CATEGORIES.map(({ id, label, icon }) => (
              <MenuItem
                key={id}
                icon={icon}
                meta={speakers.data ? String(counts[id]) : undefined}
                current={category === id}
                onClick={() => leave(() => {
                  setCategory(id)
                  setOpenId(null)
                })}
              >
                {label}
              </MenuItem>
            ))}
            <MenuItem icon="clock" {...markNotImplemented('speakers.recently-added')}>Recently added</MenuItem>
          </nav>
          <div className={styles.pane}>
            {current && draft ? (
              <SpeakerCard
                key={current.id}
                speaker={current}
                others={rows.filter(speaker => speaker.id !== current.id)}
                sample={sample}
                draft={draft}
                dirty={dirty}
                saving={saving}
                saveError={saveError}
                onDraftChange={next => {
                  setEdited(next)
                  setSaveError(undefined)
                }}
                onSave={() => void save()}
                onRevert={revert}
                deleteBlocked={blocked}
                cancelEdit={cancelEdit}
                onBack={() => leave(() => setOpenId(null))}
                onOpenRecording={id => leave(() => {
                  onClose()
                  onOpenRecording(id)
                })}
                onDelete={() => setToDelete(current)}
              />
            ) : (
              <>
                <SearchField data-modal-start placeholder="Search speakers" aria-label="Search speakers" value={query} onValueChange={setQuery} />
                {speakers.isPending && <SectionHeader title="Loading speakers" />}
                {speakers.isError && !speakers.data && (
                  <SectionHeader title="Could not load the speakers" action={<Button variant="ghost" size="small" onClick={() => void speakers.refetch()}>Retry</Button>} />
                )}
                {speakers.data && <SpeakerList speakers={rows} query={query} category={category} onOpen={setOpenId} />}
              </>
            )}
          </div>
        </ModalBody>
        <ModalFooter
          leading={<Button variant="ghost" icon="add" {...markNotImplemented('speakers.new-speaker')}>New speaker</Button>}
          cancel={current ? { children: 'Cancel', disabled: !dirty || saving, onClick: revert } : null}
          confirm={current ? { children: 'Save', disabled: !changes, loading: saving, onClick: () => void save() } : undefined}
        />
      </Modal>
      {asking.value && (
        <DiscardChangesDialog
          key={asking.key}
          open={asking.open}
          onDiscard={() => {
            const { go } = asking.value!
            setLeaving(null)
            revert()
            go()
          }}
          onClose={() => setLeaving(null)}
          onExited={asking.exited}
        />
      )}
      {deleting.value && (
        <DeleteSpeakerDialog
          key={deleting.key}
          speaker={deleting.value}
          open={deleting.open}
          busy={removing}
          onConfirm={() => void confirmDelete()}
          onClose={() => setToDelete(null)}
          onExited={deleting.exited}
        />
      )}
    </>
  )
}
