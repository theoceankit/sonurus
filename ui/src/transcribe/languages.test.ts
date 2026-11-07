import { expect, test } from 'vitest'
import { ALIGNMENT_MODELS, alignmentModel, apiLanguage, languageName, LANGUAGES } from './languages'

test('languages: detect first, names for the user, auto is null to the API', () => {
  expect(LANGUAGES[0].code).toBe('auto')
  expect(languageName('ru')).toBe('Русский')
  expect(languageName('xx')).toBe('xx')
  expect(apiLanguage('auto')).toBeNull()
  expect(apiLanguage('de')).toBe('de')
})

test('alignmentModel: the catalog row, or the id alone', () => {
  expect(alignmentModel('cs')).toEqual({ id: 'cs', name: 'Czech', nativeName: 'Čeština', size: '~300 MB' })
  expect(alignmentModel('xx')).toEqual({ id: 'xx', name: 'xx', nativeName: '', size: '' })
})
