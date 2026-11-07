import { expect, test } from 'vitest'
import { transcribeDefaults } from './transcribe-defaults'

test('the saved model and language go as they are', () => {
  expect(transcribeDefaults({ transcribeModel: 'large-v3', transcribeLang: 'de' })).toEqual({ whisperModel: 'large-v3', language: 'de' })
})

test('no model, auto language or no settings leave both to the backend', () => {
  expect(transcribeDefaults({ transcribeModel: null, transcribeLang: 'auto' })).toEqual({ whisperModel: null, language: null })
  expect(transcribeDefaults({})).toEqual({ whisperModel: null, language: null })
  expect(transcribeDefaults(undefined)).toEqual({ whisperModel: null, language: null })
})
