import type { DataResetSummary } from '../../api/types'
import type { ElectronSettings } from '../../platform/electron-api'

// Reset to defaults: every preference back to its default, except what is not a
// preference: the HuggingFace token and the recordings opened last.
export function defaultSettingsPatch(defaults: ElectronSettings): Partial<ElectronSettings> {
  const { hfToken: _token, recentTranscriptIds: _recent, ...preferences } = defaults
  return structuredClone(preferences)
}

// Why Delete all data must stay off now, or null when it may run: the backend refuses
// it while a transcription or a live recording runs.
export function dataResetBlockReason(runningJob: boolean, recording: boolean): string | null {
  if (runningJob) return 'Pause the transcription queue first.'
  if (recording) return 'Stop the live recording first.'
  return null
}

export function formatDataResetSummary({ transcripts, speakers, files }: DataResetSummary): string {
  if (!transcripts && !speakers && !files) return 'There was no data to delete.'
  const n = (count: number, word: string) => `${count} ${word}${count === 1 ? '' : 's'}`
  return `Deleted ${n(transcripts, 'transcript')}, ${n(speakers, 'speaker')} and ${n(files, 'file')}.`
}
