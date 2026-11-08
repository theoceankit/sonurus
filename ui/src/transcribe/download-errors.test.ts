import { expect, test } from 'vitest'
import { downloadFailure, downloadFailureText } from './download-errors'

test('each code has its own words, with API Keys for the token', () => {
  expect(downloadFailureText('no_token')).toEqual({ text: 'A HuggingFace token is needed. Add it in', apiKeys: true })
  expect(downloadFailureText('no_access')).toEqual({
    text: "Your HuggingFace token has no access to this model. Accept the model's terms in your HuggingFace account and try again, or check the token in",
    apiKeys: true,
  })
  expect(downloadFailureText('network')).toEqual({ text: 'No connection to HuggingFace. Check the internet connection and try again.', apiKeys: false })
  expect(downloadFailureText('failed')).toEqual({ text: 'The download did not finish. Try again.', apiKeys: false })
})

test('a code it does not know, or none, is failed', () => {
  expect(downloadFailure('no_token')).toBe('no_token')
  expect(downloadFailure('disk_full')).toBe('failed')
  expect(downloadFailure(undefined)).toBe('failed')
})
