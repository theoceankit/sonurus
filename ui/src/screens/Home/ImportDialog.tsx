import { Button } from '../../components/Button/Button'
import { DropZone } from '../../components/DropZone/DropZone'
import { Icon } from '../../components/Icon/Icon'
import { IconButton } from '../../components/IconButton/IconButton'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { Inline } from '../../components/Inline/Inline'
import { Select } from '../../components/Select/Select'
import { Stack } from '../../components/Stack/Stack'
import { TextField } from '../../components/TextField/TextField'
import { markNotImplemented } from '../../not-implemented'
import type { TranscribeChoice } from '../../transcribe/choice'
import { blockMessage } from '../../transcribe/models'
import { SUPPORTED_EXTENSIONS, type ImportFailure, type ImportFile } from './import-files'
import styles from './ImportDialog.module.css'

// The backend takes a title of up to 200 characters (JobUpdateRequest, TranscribeRequest).
const TITLE_MAX_LENGTH = 200

const HINT = `${SUPPORTED_EXTENSIONS.slice(0, -1).join(', ')} or ${SUPPORTED_EXTENSIONS.at(-1)}`

export interface ImportDialogProps {
  open: boolean
  // Files over the drop zone without a drag, for a story.
  over?: boolean
  files: readonly ImportFile[]
  // Typed by the user; the field shows defaultTitle until then.
  title: string
  defaultTitle: string
  onTitleChange: (title: string) => void
  choice: TranscribeChoice
  onModelChange: (model: string) => void
  onLanguageChange: (language: string) => void
  failure: ImportFailure | null
  importing: boolean
  onChooseFiles: () => void
  onRemove: (path: string) => void
  onImport: () => void
  onClose: () => void
  // Closes the dialog for Settings, where the models are downloaded.
  onOpenSettings?: () => void
  onExited?: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

// What New recording was in the old UI, without the recording: files with a title,
// a model and a language for this run.
export function ImportDialog({
  open, over, files, title, defaultTitle, onTitleChange, choice, onModelChange, onLanguageChange,
  failure, importing, onChooseFiles, onRemove, onImport, onClose, onOpenSettings, onExited, preview,
}: ImportDialogProps) {
  const several = files.length > 1
  const ready = !choice.checking && !choice.blocked
  return (
    <Modal size="medium" open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="New transcription" />
      <ModalBody>
        <Stack gap={3}>
          <TextField
            label="Title"
            value={several ? '' : title}
            placeholder={several ? 'Each file keeps its own name' : defaultTitle}
            disabled={several || importing}
            maxLength={TITLE_MAX_LENGTH}
            onChange={event => onTitleChange(event.target.value)}
          />
          <Inline gap={3} align="start">
            <Select
              label="Model"
              value={choice.model ?? ''}
              options={choice.modelOptions}
              placeholder={choice.checking ? 'Checking models…' : 'No model installed'}
              disabled={choice.checking || importing}
              onValueChange={onModelChange}
            />
            <Select
              label="Language"
              value={choice.language}
              options={choice.languageOptions}
              disabled={importing}
              onValueChange={onLanguageChange}
            />
          </Inline>
          <Inline>
            <Button size="small" icon="add" {...markNotImplemented('new-transcription.diarize')}>Diarize speakers</Button>
          </Inline>
          {choice.blocked && (
            <Inline gap={2} justify="between" role="status" className={styles.blockedNotice}>
              <span>{blockMessage(choice.blocked)}</span>
              <Button variant="ghost" size="small" icon="settings" onClick={onOpenSettings}>Download in Settings</Button>
            </Inline>
          )}
          <DropZone over={over} hint={HINT} onChooseFiles={onChooseFiles} />
          {files.length > 0 && (
            <ul aria-label="Files to import" className={styles.files}>
              {files.map(file => (
                // The row opens in place when it comes: the list grows rather than jumps.
                <li key={file.path} className={styles.file}>
                  <div className={styles.fileClip}>
                    <div className={styles.fileRow}>
                      <Icon name="waveform" className={styles.fileIcon} />
                      <span className={styles.fileName} title={file.path}>{file.name}</span>
                      <IconButton icon="delete" size="xs" label={`Remove ${file.name}`} disabled={importing} onClick={() => onRemove(file.path)} />
                    </div>
                  </div>
                </li>
              ))}
            </ul>
          )}
          {failure && (
            <Stack gap={1} align="start" role="alert" className={styles.failure}>
              <span>{failure.message}</span>
              {failure.missingModels && (
                <Button variant="ghost" size="small" icon="settings" onClick={onOpenSettings}>Open Settings</Button>
              )}
            </Stack>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter confirm={{ children: 'Import', disabled: files.length === 0 || !ready, loading: importing, onClick: onImport }} />
    </Modal>
  )
}
