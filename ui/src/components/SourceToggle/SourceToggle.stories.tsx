import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { StateMatrix } from '../../foundations/StateMatrix'
import { SourceToggle } from './SourceToggle'
import styles from './SourceToggle.stories.module.css'

const MICS = [
  { value: 'default-microphone', label: 'Default microphone' },
  { value: 'maono', label: 'Maono Dynamic Microphone' },
]
const LONG = [{ value: 'hdmi', label: 'AD107 High Definition Audio Controller Digital Stereo (HDMI) [SAMSUNG]' }]
const noop = () => {}

const meta: Meta<typeof SourceToggle> = {
  component: SourceToggle,
  args: { icon: 'microphone', name: 'Microphone', on: true, onToggle: noop, devices: MICS, device: 'default-microphone', onDeviceChange: noop },
  decorators: [Story => <div className={styles.half}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof SourceToggle>

const STATES = ['Default', 'Hover', 'Focus'] as const
const cell = (label: string, props: Partial<Parameters<typeof SourceToggle>[0]>) => ({
  label,
  render: () => <div className={styles.half}><SourceToggle {...meta.args as Parameters<typeof SourceToggle>[0]} {...props} /></div>,
})

export const Matrix: Story = {
  decorators: [Story => <Story />],
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        cell('On', {}),
        cell('Off', { on: false }),
        cell('Unavailable', { icon: 'system-audio', name: 'System audio', devices: [], device: null, unavailable: 'No system audio can be recorded on this computer' }),
        cell('Disabled', { disabled: true }),
      ]}
    />
  ),
}

export const On: Story = {}
export const Off: Story = { args: { on: false } }
// No source the backend can capture: the button is off and the tooltip says why.
export const Unavailable: Story = { args: { icon: 'system-audio', name: 'System audio', devices: [], device: null, unavailable: 'No system audio can be recorded on this computer' } }
// While a recording runs.
export const Disabled: Story = { args: { disabled: true } }
// The device is in the tooltip and the menu; the button keeps its one line.
export const LongDeviceName: Story = { args: { icon: 'system-audio', name: 'System audio', devices: LONG, device: 'hdmi' } }

// Both sources side by side, as in the dialog; a click turns one on or off.
export const Pair: Story = {
  decorators: [Story => <Story />],
  render: function Pair() {
    const [mic, setMic] = useState(true)
    const [system, setSystem] = useState(true)
    const [micDevice, setMicDevice] = useState('default-microphone')
    return (
      <div className={styles.pair}>
        <SourceToggle icon="microphone" name="Microphone" on={mic} onToggle={() => setMic(v => !v)} devices={MICS} device={micDevice} onDeviceChange={setMicDevice} />
        <SourceToggle icon="system-audio" name="System audio" on={system} onToggle={() => setSystem(v => !v)} devices={LONG} device="hdmi" onDeviceChange={noop} />
      </div>
    )
  },
}
