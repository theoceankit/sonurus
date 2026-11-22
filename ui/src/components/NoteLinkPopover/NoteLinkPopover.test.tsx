import * as Popover from '@radix-ui/react-popover'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { NoteLinkPopover } from './NoteLinkPopover'

const popover = (href?: string) => (
  <NoteLinkPopover open href={href} onOpenChange={() => {}} onApply={() => {}} onRemove={() => {}} onClosed={() => {}}>
    <Popover.Trigger>Link</Popover.Trigger>
  </NoteLinkPopover>
)
const remove = () => screen.queryByRole('button', { name: 'Remove link' })

// Applying puts the cursor on a link while the window is on its way out.
test('a window opened for a new link does not get Remove link as it leaves', async () => {
  const { rerender } = render(popover())
  await screen.findByRole('textbox', { name: 'Link address' })
  rerender(popover('https:' + '//example.com'))
  expect(remove()).toBeNull()
})

test('a window opened on a link keeps Remove link as it leaves', async () => {
  const { rerender } = render(popover('https:' + '//example.com'))
  await screen.findByRole('textbox', { name: 'Link address' })
  rerender(popover())
  expect(remove()).toBeTruthy()
})
