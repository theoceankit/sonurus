import * as Popover from '@radix-ui/react-popover'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { waitFor } from '../../screens/Editor/story-helpers'
import { IconButton } from '../IconButton/IconButton'
import { NoteLinkPopover } from './NoteLinkPopover'

const meta: Meta<typeof NoteLinkPopover> = { component: NoteLinkPopover }
export default meta

type Story = StoryObj<typeof NoteLinkPopover>

function Shown({ href }: { href?: string }) {
  const [open, setOpen] = useState(true)
  return (
    <div style={{ height: 180, display: 'flex', justifyContent: 'center' }}>
      <NoteLinkPopover open={open} onOpenChange={setOpen} href={href} onApply={() => setOpen(false)} onRemove={() => setOpen(false)} onClosed={() => {}}>
        <Popover.Trigger asChild><IconButton icon="link" label="Link" /></Popover.Trigger>
      </NoteLinkPopover>
    </div>
  )
}

// A new link.
export const NewLink: Story = { render: () => <Shown /> }
// The cursor on a link: its address, and a way to remove it.
export const EditLink: Story = { render: () => <Shown href="https://localhost/spec" /> }
// An address that cannot open, applied.
export const InvalidAddress: Story = {
  render: () => <Shown />,
  play: async () => {
    const apply = await waitFor(() => [...document.querySelectorAll('button')].find(node => node.textContent?.trim() === 'Apply'))
    apply.click()
    await waitFor(() => [...document.querySelectorAll('form *')].find(node => node.textContent === 'Enter a web or mailto address'))
  },
}
