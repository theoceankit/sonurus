import { expect, test } from 'vitest'
import { parseNoteLink } from './note-link'

const HTTPS = 'https:' + '//'
const HTTP = 'http:' + '//'

test.each([
  [HTTPS + 'example.com/a?b=1', HTTPS + 'example.com/a?b=1'],
  [HTTP + 'example.com', HTTP + 'example.com'],
  ['mailto:team@example.com', 'mailto:team@example.com'],
  ['  ' + HTTPS + 'example.com  ', HTTPS + 'example.com'],
  ['example.com', HTTPS + 'example.com'],
  ['example.com/path', HTTPS + 'example.com/path'],
  ['example.com:8080/a', HTTPS + 'example.com:8080/a'],
  ['team@example.com', 'mailto:team@example.com'],
  ['  team.lead@mail.example.com ', 'mailto:team.lead@mail.example.com'],
  ['localhost:3000', HTTPS + 'localhost:3000'],
])('%s is kept as %s', (value, href) => {
  expect(parseNoteLink(value)).toEqual({ href })
})

test.each([
  '', '   ', 'javascript:alert(1)', 'JAVASCRIPT:alert(1)', 'file:///etc/passwd', 'data:text/html,x', 'tel:123', 'ftp://example.com',
  'two words.com', 'word', 'team@example', 'team@example.com/path', 'a@b@example.com', 'https://', 'mailto:',
])('%s is refused', value => {
  expect(parseNoteLink(value).error).toBeTruthy()
})
