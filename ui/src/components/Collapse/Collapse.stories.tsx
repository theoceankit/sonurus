import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../Button/Button'
import { Stack } from '../Stack/Stack'
import { Collapse } from './Collapse'

const meta: Meta<typeof Collapse> = { title: 'Components/Collapse', component: Collapse }
export default meta

type Story = StoryObj<typeof Collapse>

const content = <Stack gap={1}><span>Oliver Grant</span><span>Sofia Ramos</span><span>Lena Klein</span></Stack>

export const Open: Story = { args: { open: true, children: content } }
export const Closed: Story = { args: { open: false, children: content } }

function Toggling() {
  const [open, setOpen] = useState(false)
  return (
    <Stack gap={2}>
      <Button variant="secondary" size="small" onClick={() => setOpen(!open)}>{open ? 'Show less' : 'Show 3 more'}</Button>
      <Collapse open={open}>{content}</Collapse>
      <span>What is under it moves.</span>
    </Stack>
  )
}
export const Moving: Story = { render: () => <Toggling /> }
