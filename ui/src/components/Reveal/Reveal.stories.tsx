import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../Button/Button'
import { Stack } from '../Stack/Stack'
import { Reveal } from './Reveal'

const meta: Meta<typeof Reveal> = { title: 'Components/Reveal', component: Reveal }
export default meta

type Story = StoryObj<typeof Reveal>

const content = <Stack gap={1}><span>Review speakers</span><span>Who is Unknown speaker 1?</span><span>Mark Ellis, Lena Kovacs, Priya Shah</span></Stack>

export const Open: Story = { args: { open: true, children: content } }
export const Closed: Story = { args: { open: false, children: content } }

function Toggling({ travel }: { travel?: 'short' | 'long' }) {
  const [open, setOpen] = useState(true)
  return (
    <Stack gap={2}>
      <Button variant="secondary" size="small" onClick={() => setOpen(!open)}>{open ? 'Close' : 'Open'}</Button>
      <Reveal open={open} travel={travel}>{content}</Reveal>
      <span>What is under it moves.</span>
    </Stack>
  )
}
export const Moving: Story = { render: () => <Toggling /> }
export const MovingFar: Story = { render: () => <Toggling travel="long" /> }
