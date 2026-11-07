import { fireEvent, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { DropZone } from './DropZone'

const files = (types = ['Files']) => ({ dataTransfer: { types } })

test('asks for files and chooses them on the button', async () => {
  const onChooseFiles = vi.fn()
  render(<DropZone hint="wav or mp3" onChooseFiles={onChooseFiles} />)
  expect(screen.getByText('Drop audio or video files here')).toBeTruthy()
  expect(screen.getByText('wav or mp3')).toBeTruthy()
  await userEvent.click(screen.getByRole('button', { name: 'Choose files' }))
  expect(onChooseFiles).toHaveBeenCalledOnce()
})

test('lights up only while files are over it, across its children', () => {
  const { container } = render(<DropZone hint="wav or mp3" />)
  const zone = container.firstElementChild!
  const lit = () => zone.hasAttribute('data-over')
  fireEvent.dragEnter(zone, files())
  expect(lit()).toBe(true)
  expect(screen.getByText('Drop to add the files')).toBeTruthy()
  fireEvent.dragEnter(screen.getByText('wav or mp3'), files())
  fireEvent.dragLeave(zone, files())
  expect(lit()).toBe(true)
  fireEvent.dragLeave(screen.getByText('wav or mp3'), files())
  expect(lit()).toBe(false)
})

test('a drop puts it out', () => {
  const { container } = render(<DropZone />)
  const zone = container.firstElementChild!
  fireEvent.dragEnter(zone, files())
  fireEvent.drop(zone, files())
  expect(zone.hasAttribute('data-over')).toBe(false)
})

test('a drag of text leaves it as it is', () => {
  const { container } = render(<DropZone />)
  fireEvent.dragEnter(container.firstElementChild!, files(['text/plain']))
  expect(container.firstElementChild!.hasAttribute('data-over')).toBe(false)
})
