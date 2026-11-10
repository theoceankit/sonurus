import { useEffect, useRef, useState } from 'react'
import { DropZone } from '../../components/DropZone/DropZone'
import { Icon } from '../../components/Icon/Icon'
import { IconButton } from '../../components/IconButton/IconButton'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { Stack } from '../../components/Stack/Stack'
import type { TranscribeChoice } from '../../transcribe/choice'
import { TITLE_MAX_LENGTH } from '../../api/types'
import { splitName, SUPPORTED_EXTENSIONS, type ImportFile } from './import-files'
import type { Refusal } from '../../transcribe/refusals'
import { RefusalNote } from '../../transcribe/RefusalNote'
import { MissingModelNotice, TranscribeFields } from './TranscribeFields'
import styles from './ImportDialog.module.css'

const HINT = `${SUPPORTED_EXTENSIONS.slice(0, -1).join(', ')} or ${SUPPORTED_EXTENSIONS.at(-1)}`

export interface ImportDialogProps {
  open: boolean
  // Files over the drop zone without a drag, for a story.
  over?: boolean
  files: readonly ImportFile[]
  // A file renamed in the list; blank names it after the file again.
  onRename: (path: string, title: string) => void
  choice: TranscribeChoice
  onModelChange: (model: string) => void
  onLanguageChange: (language: string) => void
  failure: Refusal | null
  importing: boolean
  onChooseFiles: () => void
  onRemove: (path: string) => void
  onImport: () => void
  onClose: () => void
  // Settings over the dialog, on the section where the missing model is downloaded.
  onOpenSettings?: (section: 'models' | 'alignment') => void
  onExited?: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

// Import files: a model and a language for this run, and the files dropped or chosen,
// each renamed by a click on its name. Opened by files dragged over the window, or
// from New recording.
export function ImportDialog({
  open, over, files, onRename, choice, onModelChange, onLanguageChange,
  failure, importing, onChooseFiles, onRemove, onImport, onClose, onOpenSettings, onExited, preview,
}: ImportDialogProps) {
  const ready = !choice.checking && !choice.blocked
  return (
    <Modal size="medium" open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Import files" />
      <ModalBody>
        <Stack gap={3}>
          <TranscribeFields choice={choice} onModelChange={onModelChange} onLanguageChange={onLanguageChange} disabled={importing} />
          {files.length > 0 && (
            <ul aria-label="Files to import" className={styles.files}>
              {files.map(file => (
                // The row opens in place when it comes: the list grows rather than jumps.
                <li key={file.path} className={styles.file}>
                  <div className={styles.fileClip}>
                    <FileRow file={file} disabled={importing} onRename={title => onRename(file.path, title)} onRemove={() => onRemove(file.path)} />
                  </div>
                </li>
              ))}
            </ul>
          )}
          <DropZone over={over} hint={HINT} disabled={importing} onChooseFiles={onChooseFiles} />
          <MissingModelNotice choice={choice} onOpenSettings={onOpenSettings} />
          {failure && <RefusalNote refusal={failure} onOpenSettings={onOpenSettings} />}
        </Stack>
      </ModalBody>
      <ModalFooter
        confirm={{ children: 'Import', disabled: files.length === 0 || !ready, loading: importing, onClick: onImport }}
      />
    </Modal>
  )
}

interface FileRowProps {
  file: ImportFile
  disabled: boolean
  onRename: (title: string) => void
  onRemove: () => void
}

// A file of the list: its title, which a click on it edits, and its extension, which
// stays as it is and is out of sight while the title is edited.
function FileRow({ file, disabled, onRename, onRemove }: FileRowProps) {
  const [editing, setEditing] = useState(false)
  const { stem, extension } = splitName(file.name)
  const shown = file.title ?? stem
  return (
    <div className={styles.fileRow}>
      <Icon name="waveform" className={styles.fileIcon} />
      {editing ? (
        <span className={styles.fileName}>
          <TitleInput
            title={shown}
            label={`Title of ${file.name}`}
            onDone={next => {
              setEditing(false)
              if (next !== null) onRename(next)
            }}
          />
        </span>
      ) : (
        <button type="button" className={styles.fileName} title={file.path} aria-label={`Rename ${file.name}`} disabled={disabled} onClick={() => setEditing(true)}>
          <span className={styles.stem}>{shown}</span>
          <span className={styles.extension}>{extension}</span>
        </button>
      )}
      <IconButton icon="delete" size="xs" label={`Remove ${file.name}`} disabled={disabled} onClick={onRemove} />
    </div>
  )
}

// Enter or leaving the field keeps what was typed; Escape keeps the title it had and
// leaves the dialog open.
function TitleInput({ title, label, onDone }: { title: string; label: string; onDone: (next: string | null) => void }) {
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  // Taking the field away moves the focus, and that must not finish twice.
  const finished = useRef(false)
  const finish = (next: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(next)
  }
  const latestFinish = useRef(finish)
  latestFinish.current = finish
  useEffect(() => {
    const field = input.current!
    field.select()
    // The dialog takes Escape on the document before the field sees it: taken first
    // here, on the window, it ends the rename and the dialog stays.
    const escape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape' || event.target !== field) return
      event.preventDefault()
      event.stopPropagation()
      latestFinish.current(null)
    }
    window.addEventListener('keydown', escape, true)
    return () => window.removeEventListener('keydown', escape, true)
  }, [])
  return (
    <input
      ref={input}
      autoFocus
      aria-label={label}
      maxLength={TITLE_MAX_LENGTH}
      className={styles.titleInput}
      value={value}
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(value)
        }
      }}
    />
  )
}
