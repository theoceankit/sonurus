import { Button } from '../../components/Button/Button'
import { DropZone } from '../../components/DropZone/DropZone'
import { Icon } from '../../components/Icon/Icon'
import { IconButton } from '../../components/IconButton/IconButton'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { SourceToggle } from '../../components/SourceToggle/SourceToggle'
import { Stack } from '../../components/Stack/Stack'
import { TextField } from '../../components/TextField/TextField'
import type { TranscribeChoice } from '../../transcribe/choice'
import type { RecordingSetup } from '../../recording/useRecordingSetup'
import { BOTH_OFF } from '../../recording/sources'
import { TITLE_MAX_LENGTH } from '../../api/types'
import { SUPPORTED_EXTENSIONS, type ImportFile } from './import-files'
import type { Refusal } from '../../transcribe/refusals'
import { RefusalNote } from '../../transcribe/RefusalNote'
import { TranscribeFields } from './TranscribeFields'
import styles from './ImportDialog.module.css'

// The backend takes a title of up to 200 characters (JobUpdateRequest, TranscribeRequest).

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
  failure: Refusal | null
  importing: boolean
  onChooseFiles: () => void
  onRemove: (path: string) => void
  onImport: () => void
  onClose: () => void
  // Settings over the dialog, on the section where the missing model is downloaded.
  onOpenSettings?: (section: 'models' | 'alignment') => void
  onExited?: () => void
  // The sources and devices of a live recording, and Start recording.
  record: RecordingSetup
  onStartRecording: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

// New recording: a title, a model and a language for this run, and
// either a live recording of the sources below them or the files dropped or chosen.
export function ImportDialog({
  open, over, files, title, defaultTitle, onTitleChange, choice, onModelChange, onLanguageChange,
  failure, importing, onChooseFiles, onRemove, onImport, onClose, onOpenSettings, onExited, record, onStartRecording, preview,
}: ImportDialogProps) {
  const several = files.length > 1
  const ready = !choice.checking && !choice.blocked
  return (
    <Modal size="medium" open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="New recording" description="Make sure all participants have agreed to be recorded." />
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
          <TranscribeFields
            choice={choice}
            onModelChange={onModelChange}
            onLanguageChange={onLanguageChange}
            disabled={importing}
            onOpenSettings={onOpenSettings}
          >
            <Stack gap={1} role="group" aria-label="Record">
              <span className={styles.label}>Record</span>
              {record.recording && <span className={styles.recordingNotice}>A recording is already in progress. Files can still be imported.</span>}
              <div className={styles.sources}>
                <SourceToggle
                  icon="microphone"
                  name="Microphone"
                  on={record.sources.mic}
                  onToggle={() => record.onToggle('mic')}
                  devices={record.micDevices}
                  device={record.micDevice}
                  onDeviceChange={record.onMicDeviceChange}
                  disabled={record.recording}
                />
                <SourceToggle
                  icon="system-audio"
                  name="System audio"
                  on={record.sources.system}
                  onToggle={() => record.onToggle('system')}
                  devices={record.systemDevices}
                  device={record.systemDevice}
                  onDeviceChange={record.onSystemDeviceChange}
                  disabled={record.recording}
                  unavailable={record.systemUnavailable}
                />
              </div>
              {record.blocked === BOTH_OFF && <span className={styles.hint}>{BOTH_OFF}</span>}
            </Stack>
          </TranscribeFields>
          <DropZone over={over} hint={HINT} disabled={importing} onChooseFiles={onChooseFiles} />
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
          {failure && <RefusalNote refusal={failure} onOpenSettings={onOpenSettings} />}
        </Stack>
      </ModalBody>
      <ModalFooter
        cancel={{ children: 'Import', disabled: files.length === 0 || !ready, loading: importing, onClick: onImport }}
        confirm={{ children: 'Start recording', disabled: !!record.blocked || !ready || importing, onClick: onStartRecording }}
      />
    </Modal>
  )
}
