import { Button } from '../../components/Button/Button'
import { DropZone } from '../../components/DropZone/DropZone'
import { Icon } from '../../components/Icon/Icon'
import { IconButton } from '../../components/IconButton/IconButton'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { Stack } from '../../components/Stack/Stack'
import { markNotImplemented } from '../../not-implemented'
import { SUPPORTED_EXTENSIONS, type ImportFailure, type ImportFile } from './import-files'
import styles from './ImportDialog.module.css'

const HINT = `${SUPPORTED_EXTENSIONS.slice(0, -1).join(', ')} or ${SUPPORTED_EXTENSIONS.at(-1)}`

export interface ImportDialogProps {
  open: boolean
  // Files over the drop zone without a drag, for a story.
  over?: boolean
  files: readonly ImportFile[]
  failure: ImportFailure | null
  importing: boolean
  onChooseFiles: () => void
  onRemove: (path: string) => void
  onImport: () => void
  onClose: () => void
  onExited?: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

// What will become New recording: for now only files, transcribed with the default
// model and language.
export function ImportDialog({
  open, over, files, failure, importing, onChooseFiles, onRemove, onImport, onClose, onExited, preview,
}: ImportDialogProps) {
  return (
    <Modal size="medium" open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="New transcription" />
      <ModalBody>
        <Stack gap={3}>
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
                <Button variant="ghost" size="small" icon="settings" {...markNotImplemented('import.open-settings')}>Open Settings</Button>
              )}
            </Stack>
          )}
        </Stack>
      </ModalBody>
      <ModalFooter confirm={{ children: 'Import', disabled: files.length === 0, loading: importing, onClick: onImport }} />
    </Modal>
  )
}
