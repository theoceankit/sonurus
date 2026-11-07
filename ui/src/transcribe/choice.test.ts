import { expect, test } from 'vitest'
import { DEFAULT_INSTALLED, fixtureModels } from '../api/fixtures/models'
import { NOT_INSTALLED, NOTHING_PICKED, transcribeChoice } from './choice'

const SETTINGS = { transcribeModel: 'large-v3', transcribeModelHistory: ['large-v3'], transcribeLang: 'auto' }

test('before any catalog it is checking: no model, nothing blocked, the saved language', () => {
  const choice = transcribeChoice(undefined, { ...SETTINGS, transcribeLang: 'de' }, NOTHING_PICKED)
  expect(choice).toMatchObject({ checking: true, model: null, language: 'de', blocked: null, modelOptions: [] })
})

test('starts from the defaults; a pick wins while it is installed', () => {
  const models = fixtureModels(DEFAULT_INSTALLED)
  expect(transcribeChoice(models, SETTINGS, NOTHING_PICKED)).toMatchObject({ model: 'large-v3', language: 'auto', blocked: null })
  expect(transcribeChoice(models, SETTINGS, { model: 'small', language: 'en' })).toMatchObject({ model: 'small', language: 'en' })
  // The picked model went: the default takes its place.
  expect(transcribeChoice(fixtureModels(['large-v3', 'diarize']), SETTINGS, { model: 'small', language: null }).model).toBe('large-v3')
})

test('models and languages without their model are off with the reason', () => {
  const choice = transcribeChoice(fixtureModels(DEFAULT_INSTALLED), SETTINGS, NOTHING_PICKED)
  expect(choice.modelOptions.map(option => [option.value, !!option.disabled])).toEqual([
    ['tiny', true], ['base', true], ['small', false], ['medium', true], ['large-v3', false],
  ])
  expect(choice.modelOptions[0].meta).toBe(NOT_INSTALLED)
  const off = choice.languageOptions.filter(option => option.disabled).map(option => option.value)
  expect(off).toEqual(['ru', 'uk', 'zh', 'ja'])
})

test('blocked in the order the backend checks', () => {
  expect(transcribeChoice(fixtureModels([]), SETTINGS, NOTHING_PICKED).blocked).toEqual({ missing: 'whisper' })
  expect(transcribeChoice(fixtureModels(['small']), SETTINGS, NOTHING_PICKED).blocked).toEqual({ missing: 'diarization' })
  expect(transcribeChoice(fixtureModels(DEFAULT_INSTALLED), SETTINGS, { model: null, language: 'ru' }).blocked).toEqual({ missing: 'alignment', language: 'ru' })
})

test('a saved language that is not in the list is still offered', () => {
  const choice = transcribeChoice(fixtureModels(DEFAULT_INSTALLED), { ...SETTINGS, transcribeLang: 'it' }, NOTHING_PICKED)
  expect(choice.languageOptions.at(-1)).toEqual({ value: 'it', label: 'it' })
})
