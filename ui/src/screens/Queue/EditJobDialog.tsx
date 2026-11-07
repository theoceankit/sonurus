import { useEffect, useState } from 'react'
import { useModels, useUpdateQueueJob } from '../../api/queries'
import type { QueueJob } from '../../api/types'
import { NOTHING_PICKED, transcribeChoice } from '../../transcribe/choice'
import { jobEditPatch, jobForm, type JobForm } from './job-settings'
import { JobSettingsDialog } from './JobSettingsDialog'

interface EditJobDialogProps {
  // The job to edit; null while none is. It keeps the last one during its way out.
  job: QueueJob | null
  onClose: () => void
}

// What the edit button of a queue card opens. Only the changed fields are sent; a
// refusal keeps the dialog open with the reason, such as a model not installed.
export function EditJobDialog({ job, onClose }: EditJobDialogProps) {
  const [shown, setShown] = useState(job)
  const [form, setForm] = useState<JobForm | null>(job && jobForm(job))
  const [error, setError] = useState<string | null>(null)
  const models = useModels()
  const update = useUpdateQueueJob()

  useEffect(() => {
    if (!job) return
    setShown(job)
    setForm(jobForm(job))
    setError(null)
  }, [job])

  if (!shown || !form) return null

  // The options of the import dialog, with the job's own model and language kept
  // even when they are gone, until another is picked.
  const choice = transcribeChoice(models.data, { transcribeModel: null, transcribeModelHistory: [], transcribeLang: form.language }, NOTHING_PICKED)
  const modelOptions = [...choice.modelOptions]
  if (!modelOptions.some(option => option.value === shown.whisper_model)) {
    modelOptions.push({ value: shown.whisper_model, label: shown.whisper_model, ...(models.data ? { disabled: true, meta: 'Not installed' } : {}) })
  }

  const save = async () => {
    if (update.isPending) return
    const result = jobEditPatch(shown, form)
    if (result.error) return setError(result.error)
    if (!result.patch) return onClose()
    try {
      await update.mutateAsync({ jobId: shown.id, update: result.patch })
      onClose()
    } catch (refusal) {
      setError(refusal instanceof Error ? refusal.message : String(refusal))
    }
  }

  return (
    <JobSettingsDialog
      open={!!job}
      form={form}
      modelOptions={modelOptions}
      languageOptions={choice.languageOptions}
      error={error}
      saving={update.isPending}
      onChange={next => { setForm(next); setError(null) }}
      onSave={() => void save()}
      onClose={onClose}
      onExited={() => setShown(null)}
    />
  )
}
