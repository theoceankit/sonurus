import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { Button } from '../Button/Button'
import { IconButton } from '../IconButton/IconButton'
import { Toolbar, ToolbarDivider, ToolbarItem } from './Toolbar'

const bar = (onPlay = () => {}) => render(
  <>
    <Toolbar label="Paragraph">
      <ToolbarItem><IconButton icon="play" label="Play" onClick={onPlay} /></ToolbarItem>
      <ToolbarItem><IconButton icon="edit" label="Edit" /></ToolbarItem>
      <ToolbarDivider />
      <ToolbarItem><Button variant="toolbar" icon="copy">Copy</Button></ToolbarItem>
    </Toolbar>
    <button>After</button>
  </>,
)
const button = (name: string) => screen.getByRole('button', { name })

test('it is named', () => {
  bar()
  expect(screen.getByRole('toolbar', { name: 'Paragraph' })).toBeTruthy()
  expect(screen.getByRole('separator')).toBeTruthy()
})

test('it is one stop for Tab', async () => {
  bar()
  await userEvent.tab()
  expect(document.activeElement).toBe(button('Play'))
  await userEvent.tab()
  expect(document.activeElement).toBe(button('After'))
})

test('arrows move between the buttons, across the divider, and wrap', async () => {
  bar()
  await userEvent.tab()
  await userEvent.keyboard('{ArrowRight}')
  expect(document.activeElement).toBe(button('Edit'))
  await userEvent.keyboard('{ArrowRight}')
  expect(document.activeElement).toBe(button('Copy'))
  await userEvent.keyboard('{ArrowRight}')
  expect(document.activeElement).toBe(button('Play'))
})

test('the buttons keep their own handlers', async () => {
  const onPlay = vi.fn()
  bar(onPlay)
  await userEvent.tab()
  await userEvent.keyboard('{Enter}')
  expect(onPlay).toHaveBeenCalledTimes(1)
})
