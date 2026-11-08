import { TITLE_MAX_LENGTH, type QueueJob, type QueueJobUpdate } from '../../api/types'
import { apiLanguage, AUTO_LANGUAGE } from '../../transcribe/languages'

export type JobForm = { title: string; model: string; language: string }

// Every job but the running one: the backend refuses to change that.
export const canEditJob = (job: QueueJob) => job.status !== 'running'

export const jobForm = (job: QueueJob): JobForm => ({ title: job.title, model: job.whisper_model, language: job.language ?? AUTO_LANGUAGE })

// Only the fields that changed, the title trimmed; null when nothing did. A title
// that is blank or too long is an error instead.
export function jobEditPatch(job: QueueJob, form: JobForm): { patch: QueueJobUpdate | null; error?: never } | { error: string; patch?: never } {
  const title = form.title.trim()
  if (!title) return { error: 'Title cannot be empty.' }
  if (title.length > TITLE_MAX_LENGTH) return { error: `Title is longer than ${TITLE_MAX_LENGTH} characters.` }
  const language = apiLanguage(form.language)
  const patch: QueueJobUpdate = {}
  if (title !== job.title) patch.title = title
  if (form.model !== job.whisper_model) patch.whisper_model = form.model
  if (language !== job.language) patch.language = language
  return { patch: Object.keys(patch).length > 0 ? patch : null }
}
