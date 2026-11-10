import { Button } from '../../components/Button/Button'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { SourceToggle } from '../../components/SourceToggle/SourceToggle'
import { Stack } from '../../components/Stack/Stack'
import { TextField } from '../../components/TextField/TextField'
import { TITLE_MAX_LENGTH } from '../../api/types'
import type { TranscribeChoice } from '../../transcribe/choice'
import type { RecordingSetup } from '../../recording/useRecordingSetup'
import { BOTH_OFF } from '../../recording/sources'
import { MissingModelNotice, TranscribeFields } from './TranscribeFields'
import styles from './NewRecordingDialog.module.css'

export interface NewRecordingDialogProps {
  open: boolean
  // Typed by the user; the field shows defaultTitle until then.
  title: string
  defaultTitle: string
  onTitleChange: (title: string) => void
  choice: TranscribeChoice
  onModelChange: (model: string) => void
  onLanguageChange: (language: string) => void
  // The sources and devices of the recording.
  record: RecordingSetup
  onStartRecording: () => void
  // Import files in its place, with the title, model and language picked here.
  onImportFiles: () => void
  onClose: () => void
  // Settings over the dialog, on the section where the missing model is downloaded.
  onOpenSettings?: (section: 'models' | 'alignment') => void
  onExited?: () => void
  // Drawn in place, for a board of states.
  preview?: boolean
}

// New recording: a title, a model and a language for this run, and the sources to
// record. Files go in through Import files, which takes its place.
export function NewRecordingDialog({
  open, title, defaultTitle, onTitleChange, choice, onModelChange, onLanguageChange, record, onStartRecording,
  onImportFiles, onClose, onOpenSettings, onExited, preview,
}: NewRecordingDialogProps) {
  const ready = !choice.checking && !choice.blocked
  return (
    <Modal size="medium" open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="New recording" description="Make sure all participants have agreed to be recorded." />
      <ModalBody>
        <Stack gap={3}>
          <TextField
            label="Title"
            value={title}
            placeholder={defaultTitle}
            maxLength={TITLE_MAX_LENGTH}
            onChange={event => onTitleChange(event.target.value)}
          />
          <TranscribeFields choice={choice} onModelChange={onModelChange} onLanguageChange={onLanguageChange} />
          <Stack gap={1} role="group" aria-label="Record">
            <span className={styles.label}>Record</span>
            {record.recording && <span className={styles.recordingNotice}>A recording is already in progress.</span>}
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
          <MissingModelNotice choice={choice} onOpenSettings={onOpenSettings} />
        </Stack>
      </ModalBody>
      <ModalFooter
        leading={<Button variant="ghost" icon="folder" onClick={onImportFiles}>Import files</Button>}
        // The cross closes it: a Cancel would be the same.
        cancel={null}
        confirm={{ children: 'Start recording', disabled: !!record.blocked || !ready, onClick: onStartRecording }}
      />
    </Modal>
  )
}
