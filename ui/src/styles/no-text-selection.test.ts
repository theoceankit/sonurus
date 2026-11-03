import { expect, test } from 'vitest'
import inspector from '../components/Inspector/Inspector.module.css?raw'
import metaItem from '../components/MetaItem/MetaItem.module.css?raw'
import speakerRow from '../components/SpeakerRow/SpeakerRow.module.css?raw'
import talkTime from '../components/TalkTime/TalkTime.module.css?raw'

// What is a label rather than content: a drag over it selects nothing.
test.each([
  ['MetaItem', metaItem, '.metaItem'],
  ['SpeakerRow', speakerRow, '.speakerRow'],
  ['TalkTime', talkTime, '.talkTime'],
  ['the head of the review', inspector, '.dockHead'],
  ['the collapsed review', inspector, '.dockCollapsed'],
])('%s cannot be selected', (_name, css, selector) => {
  expect(css).toMatch(new RegExp(`\\${selector} \\{[^}]*user-select: none;`))
})
