import { Inline } from '../../components/Inline/Inline'
import { Modal } from '../../components/Modal/Modal'
import { ModalBody } from '../../components/ModalBody/ModalBody'
import { ModalFooter } from '../../components/ModalFooter/ModalFooter'
import { ModalHeader } from '../../components/ModalHeader/ModalHeader'
import { Select, type SelectOption } from '../../components/Select/Select'
import { Stack } from '../../components/Stack/Stack'
import { TextField } from '../../components/TextField/TextField'
import type { Refusal } from '../../transcribe/refusals'
import { RefusalNote } from '../../transcribe/RefusalNote'
import { TITLE_MAX_LENGTH } from '../../api/types'
import type { JobForm } from './job-settings'

export interface JobSettingsDialogProps {
  open: boolean
  form: JobForm
  modelOptions: readonly SelectOption[]
  languageOptions: readonly SelectOption[]
  // What is wrong with the title.
  error: string | null
  // The backend's refusal to save, above the buttons. A job that has started cannot
  // be saved any more.
  refusal: Refusal | null
  onOpenSettings?: (section: 'models' | 'alignment') => void
  saving: boolean
  onChange: (form: JobForm) => void
  onSave: () => void
  onClose: () => void
  onExited?: () => void
  preview?: boolean
}

// The title, model and language of a job waiting in the queue or failed.
export function JobSettingsDialog({
  open, form, modelOptions, languageOptions, error, refusal, saving, onChange, onSave, onOpenSettings, onClose, onExited, preview,
}: JobSettingsDialogProps) {
  return (
    <Modal open={open} preview={preview} onExited={onExited} onOpenChange={next => { if (!next) onClose() }}>
      <ModalHeader title="Transcription settings" />
      <ModalBody>
        <Stack gap={3}>
          <TextField
            label="Title"
            value={form.title}
            maxLength={TITLE_MAX_LENGTH}
            error={error ?? undefined}
            disabled={saving}
            data-modal-start
            onChange={event => onChange({ ...form, title: event.target.value })}
            onKeyDown={event => {
              if (event.key !== 'Enter') return
              event.preventDefault()
              onSave()
            }}
          />
          <Inline gap={3} align="start">
            <Select label="Model" value={form.model} options={modelOptions} disabled={saving} onValueChange={model => onChange({ ...form, model })} />
            <Select label="Language" value={form.language} options={languageOptions} disabled={saving} onValueChange={language => onChange({ ...form, language })} />
          </Inline>
          {refusal && <RefusalNote refusal={refusal} onOpenSettings={onOpenSettings} />}
        </Stack>
      </ModalBody>
      <ModalFooter confirm={{ children: 'Save', loading: saving, disabled: refusal?.code === 'job_running', onClick: onSave }} />
    </Modal>
  )
}
