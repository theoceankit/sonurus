import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../Button/Button'
import { Select } from '../Select/Select'
import { Slider } from '../Slider/Slider'
import { Toggle } from '../Toggle/Toggle'
import { FieldRow } from './FieldRow'

const meta: Meta<typeof FieldRow> = {
  component: FieldRow,
  args: { label: 'Start transcription', hint: 'Automatically: new imports are transcribed right away.' },
  decorators: [Story => <div style={{ width: 480 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof FieldRow>

const modes = [{ value: 'auto', label: 'Automatically' }, { value: 'manual', label: 'Manually' }]

export const WithSelect: Story = {
  render: args => {
    const [mode, setMode] = useState('auto')
    return <FieldRow {...args}><Select aria-label={args.label} value={mode} options={modes} onValueChange={setMode} /></FieldRow>
  },
}

export const WithToggle: Story = {
  args: { label: 'Duplicate on export', hint: 'Keeps the original and writes a copy.' },
  render: args => {
    const [on, setOn] = useState(true)
    return <FieldRow {...args}><Toggle label={args.label} checked={on} onChange={setOn} /></FieldRow>
  },
}

export const WithoutHint: Story = {
  args: { label: 'Interface language', hint: undefined },
  render: args => <FieldRow {...args}><Button variant="secondary" size="small">Change</Button></FieldRow>,
}

export const Stacked: Story = {
  args: { label: 'Interface scale', hint: 'Affects type sizes and spacing.', stacked: true },
  render: args => {
    const [scale, setScale] = useState(100)
    const marks = [50, 100, 150, 200].map(value => ({ value, label: `${value}%` }))
    return (
      <FieldRow {...args}>
        <Slider label={args.label} orientation="horizontal" min={50} max={200} step={5} value={scale} onChange={setScale} marks={marks} />
      </FieldRow>
    )
  },
}

export const WithNote: Story = {
  args: { label: 'Transcription language', hint: 'Detected from the audio when set to Detect.', note: 'Alignment model for Czech is not installed' },
  render: WithSelect.render,
}

export const LongLabelNarrow: Story = {
  args: { label: 'A setting whose name is much longer than the others', hint: 'And its hint is long too, so that both wrap at a narrow width.' },
  decorators: [Story => <div style={{ width: 320 }}><Story /></div>],
  render: WithSelect.render,
}
