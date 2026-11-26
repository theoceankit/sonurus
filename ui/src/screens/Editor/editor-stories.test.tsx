import { composeStories, setProjectAnnotations } from '@storybook/react-vite'
import { render } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import type { ComponentType, ReactElement } from 'react'
import preview from '../../../.storybook/preview'
import * as inspector from './EditorScreen.inspector.stories'
import * as notes from './EditorScreen.notes.stories'
import styles from './EditorScreen.stories.module.css'
import css from './EditorScreen.stories.module.css?raw'
import * as transcript from './EditorScreen.transcript.stories'

// A play function that throws leaves the story on the plain screen, and Storybook
// only says so in the console; here it fails a test.
setProjectAnnotations(preview)

// A story as composeStories gives it, whatever its component.
type Played = { play?: unknown, run: (context: { canvasElement: HTMLElement }) => Promise<void> }

const files = { transcript, inspector, notes }

// Plays that need a real layout, which jsdom has not: a window narrow enough for one
// side panel, and a selection with a place on the screen for the Quote bar.
const NEEDS_LAYOUT = new Set(['NarrowWindow', 'QuoteInserted', 'QuoteIntoEmptyNote'])

describe.each(Object.entries(files))('the plays of the %s stories', (_, file) => {
  const played = Object.entries(composeStories(file) as Record<string, Played>).filter(([name, story]) => story.play && !NEEDS_LAYOUT.has(name))
  test.each(played)('%s', async (_name, story) => {
    const canvasElement = document.body.appendChild(document.createElement('div'))
    try {
      await story.run({ canvasElement })
    } finally {
      canvasElement.remove()
    }
  })
})

test('the Transcript and Inspector stories have the size of the boards', () => {
  expect(css).toMatch(/\.board \{\s*width: 1200px;\s*height: 800px;\s*\}/)
  for (const { default: meta } of [transcript, inspector]) {
    const [decorator] = meta.decorators as Array<(Story: ComponentType) => ReactElement>
    const { container } = render(decorator(() => null))
    expect(container.firstElementChild?.className).toBe(styles.board)
  }
})
