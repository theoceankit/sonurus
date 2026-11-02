import { render } from '@testing-library/react'
import { expect, test } from 'vitest'
import type { ComponentType, ReactElement } from 'react'
import * as speakers from './EditorBoards.speakers.stories'
import * as transcript from './EditorBoards.transcript.stories'
import styles from './EditorScreen.stories.module.css'
import css from './EditorScreen.stories.module.css?raw'

const BOARDS = [
  'Redesign / Editor / Transcript / Change speaker',
  'Redesign / Editor / Transcript / Text selection',
  'Redesign / Editor / Transcript / Editing text',
  'Redesign / Editor / Transcript / Renaming',
  'Redesign / Editor / Transcript / Unassigned',
  'Redesign / Editor / Speakers / Review',
  'Redesign / Editor / Speakers / Review / Possible match',
  'Redesign / Editor / Speakers / Review closed',
  'Redesign / Editor / Speakers / Done',
  'Redesign / Editor / Speakers / Choose speaker',
  'Redesign / Editor / Speakers / Choose speaker / No results',
  'Redesign / Editor / Speakers / New speaker',
  'Redesign / Editor / Speakers / New speaker / Optional details',
]

type StoryFile = { default: { title?: string, decorators?: unknown }, [story: string]: unknown }
const files = [transcript, speakers] as unknown as StoryFile[]

test('every board has a story with its name', () => {
  const names = files.flatMap(({ default: meta, ...stories }) => Object.values(stories)
    .map(story => `${meta.title!.split('/').join(' / ')} / ${(story as { name: string }).name}`))
  expect(names.sort()).toEqual([...BOARDS].sort())
})

test('the stories have the size of the boards', () => {
  expect(css).toMatch(/\.board \{\s*width: 1200px;\s*height: 800px;\s*\}/)
  for (const { default: meta } of files) {
    const [decorator] = meta.decorators as Array<(Story: ComponentType) => ReactElement>
    const { container } = render(decorator(() => null))
    expect(container.firstElementChild?.className).toBe(styles.board)
  }
})
