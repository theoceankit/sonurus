import { expect, test } from 'vitest'
import { DEFAULT_SETTINGS } from '../../platform/settings'
import { dataResetBlockReason, defaultSettingsPatch, formatDataResetSummary } from './data-reset'

test('defaultSettingsPatch: every default preference', () => {
  const patch = defaultSettingsPatch(DEFAULT_SETTINGS)
  expect(patch).toMatchObject({ scale: 100, transcribeLang: 'auto', transcribeModel: null, transcribeModelHistory: [], exportFormat: 'txt' })
})

test('defaultSettingsPatch: keeps the HuggingFace token and the recordings opened last', () => {
  const patch = defaultSettingsPatch(DEFAULT_SETTINGS)
  expect('hfToken' in patch).toBe(false)
  expect('recentTranscriptIds' in patch).toBe(false)
})

test('defaultSettingsPatch: does not change the defaults', () => {
  const patch = defaultSettingsPatch(DEFAULT_SETTINGS)
  patch.transcribeModelHistory!.push('small')
  expect(DEFAULT_SETTINGS.transcribeModelHistory).toEqual([])
})

test('dataResetBlockReason: off while a transcription or a live recording runs', () => {
  expect(dataResetBlockReason(false, false)).toBeNull()
  expect(dataResetBlockReason(true, false)).toBe('Pause the transcription queue first.')
  expect(dataResetBlockReason(false, true)).toBe('Stop the live recording first.')
})

test('formatDataResetSummary: plural, singular, nothing', () => {
  expect(formatDataResetSummary({ transcripts: 3, speakers: 2, files: 4 })).toBe('Deleted 3 transcripts, 2 speakers and 4 files.')
  expect(formatDataResetSummary({ transcripts: 1, speakers: 1, files: 1 })).toBe('Deleted 1 transcript, 1 speaker and 1 file.')
  expect(formatDataResetSummary({ transcripts: 0, speakers: 0, files: 0 })).toBe('There was no data to delete.')
})
