import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Badge } from '../Badge/Badge'
import { FieldRow } from '../FieldRow/FieldRow'
import { Toggle } from '../Toggle/Toggle'
import { SectionCard } from './SectionCard'

const meta: Meta<typeof SectionCard> = {
  component: SectionCard,
  decorators: [Story => <div style={{ width: 520 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof SectionCard>

function Rows() {
  const [timestamps, setTimestamps] = useState(true)
  const [speakers, setSpeakers] = useState(false)
  return (
    <>
      <FieldRow label="Timestamps" hint="Before each paragraph."><Toggle label="Timestamps" checked={timestamps} onChange={setTimestamps} /></FieldRow>
      <FieldRow label="Speaker labels"><Toggle label="Speaker labels" checked={speakers} onChange={setSpeakers} /></FieldRow>
    </>
  )
}

export const Default: Story = {
  args: { title: 'Include in export', description: 'Applies to every export format.' },
  render: args => <SectionCard {...args}><Rows /></SectionCard>,
}

export const WithAction: Story = {
  args: { title: 'GPU acceleration', description: 'Faster transcription on an NVIDIA graphics card.', action: <Badge tone="success">On</Badge> },
  render: args => <SectionCard {...args}><Rows /></SectionCard>,
}

export const WithFooter: Story = {
  args: { title: 'Alignment models', footer: 'Not needed for English, French, German or Spanish.' },
  render: args => <SectionCard {...args}><Rows /></SectionCard>,
}

export const WithoutTitle: Story = {
  render: args => <SectionCard {...args}><Rows /></SectionCard>,
}
