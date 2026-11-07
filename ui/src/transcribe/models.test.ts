import { expect, test } from 'vitest'
import { fixtureModels } from '../api/fixtures/models'
import {
  blockMessage, installedWhisperModels, jobBlockReason, missingAlignmentModel, modelState, pushModelHistory, resolveTranscribeModel,
} from './models'

test('resolveTranscribeModel: nothing installed, no model', () => {
  expect(resolveTranscribeModel({ current: null, history: [], installed: [] })).toBeNull()
  expect(resolveTranscribeModel({ current: 'small', history: ['small'], installed: [] })).toBeNull()
})

test('resolveTranscribeModel: an installed default stays', () => {
  expect(resolveTranscribeModel({ current: 'base', history: ['tiny', 'base'], installed: ['tiny', 'base', 'large-v3'] })).toBe('base')
})

test('resolveTranscribeModel: a deleted default falls back to the latest installed one of the history', () => {
  expect(resolveTranscribeModel({ current: 'base', history: ['tiny', 'base'], installed: ['tiny', 'large-v3'] })).toBe('tiny')
  expect(resolveTranscribeModel({ current: 'medium', history: ['tiny', 'small', 'medium'], installed: ['tiny', 'large-v3'] })).toBe('tiny')
})

test('resolveTranscribeModel: nothing of the history installed, the most accurate installed model', () => {
  expect(resolveTranscribeModel({ current: null, history: [], installed: ['tiny', 'medium'] })).toBe('medium')
  expect(resolveTranscribeModel({ current: 'small', history: ['small'], installed: ['base', 'large-v3'] })).toBe('large-v3')
})

test('pushModelHistory: the latest last, no repeats, at most 5', () => {
  expect(pushModelHistory(undefined, 'tiny')).toEqual(['tiny'])
  expect(pushModelHistory(['tiny', 'base', 'small'], 'tiny')).toEqual(['base', 'small', 'tiny'])
  expect(pushModelHistory(['a', 'b', 'c', 'd', 'e'], 'f')).toEqual(['b', 'c', 'd', 'e', 'f'])
})

test('modelState: the default is worked out from what is installed, a saved one that is not is not used', () => {
  const models = fixtureModels(['tiny', 'medium', 'diarize'])
  expect(installedWhisperModels(models)).toEqual(['tiny', 'medium'])
  expect(modelState(models, { transcribeModel: 'tiny' })).toMatchObject({ model: 'tiny', diarizeInstalled: true })
  expect(modelState(models, { transcribeModel: 'large-v3', transcribeModelHistory: ['tiny', 'large-v3'] }).model).toBe('tiny')
  expect(modelState(models, { transcribeModel: 'large-v3' }).model).toBe('medium')
  expect(modelState(fixtureModels([])).model).toBeNull()
  expect(modelState(fixtureModels(['tiny'])).diarizeInstalled).toBe(false)
})

test('missingAlignmentModel: only languages of the catalog whose model is not installed', () => {
  expect(missingAlignmentModel('ru', fixtureModels([]))?.id).toBe('ru')
  expect(missingAlignmentModel('ru', fixtureModels(['ru']))).toBeNull()
  for (const language of ['en', 'de', 'auto', null]) expect(missingAlignmentModel(language, fixtureModels([]))).toBeNull()
})

test('jobBlockReason: the Whisper model, then diarization, then the language', () => {
  const state = (installed: string[]) => modelState(fixtureModels(installed))
  expect(jobBlockReason(state(['diarize']), 'ru')).toEqual({ missing: 'whisper' })
  expect(jobBlockReason(state(['base']), 'ru')).toEqual({ missing: 'diarization' })
  expect(jobBlockReason(state(['base', 'diarize']), 'ru')).toEqual({ missing: 'alignment', language: 'ru' })
  expect(jobBlockReason(state(['base', 'diarize']), 'en')).toBeNull()
  expect(jobBlockReason(state(['base', 'diarize']), 'auto')).toBeNull()
  expect(jobBlockReason(state(['base', 'diarize', 'ru']), 'ru')).toBeNull()
})

test('blockMessage: what is missing, the language by its name', () => {
  expect(blockMessage({ missing: 'whisper' })).toBe('No transcription model installed')
  expect(blockMessage({ missing: 'diarization' })).toBe('Diarization model not installed')
  expect(blockMessage({ missing: 'alignment', language: 'ru' })).toBe('Alignment model for Русский is not installed')
})

test('no model is the default by itself: the Whisper model always comes from the catalog', () => {
  expect(modelState(fixtureModels(['diarize'])).model).toBeNull()
})
