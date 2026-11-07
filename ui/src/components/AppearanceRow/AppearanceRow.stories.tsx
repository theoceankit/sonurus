import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { AppearanceRow } from './AppearanceRow'
import styles from './AppearanceRow.stories.module.css'

const noop = () => {}
const ROW = { title: 'Weekly product sync', date: '4 Oct 2026', onOpen: noop, onPlay: noop }

const meta: Meta<typeof AppearanceRow> = {
  component: AppearanceRow,
  decorators: [Story => <div className={styles.panel}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof AppearanceRow>

export const Matrix: Story = {
  decorators: [],
  render: () => (
    <StateMatrix
      wideCells
      states={['Default', 'Hover', 'Focus'] as const}
      rows={[
        { label: 'Recording', render: () => <AppearanceRow {...ROW} /> },
        { label: 'Playing', render: () => <AppearanceRow {...ROW} playing /> },
        { label: 'Audio unavailable', render: () => <AppearanceRow {...ROW} audioMissing /> },
      ]}
    />
  ),
}

export const Default: Story = { args: ROW }
export const Playing: Story = { args: { ...ROW, playing: true } }
export const AudioUnavailable: Story = { args: { ...ROW, audioMissing: true } }
export const LongTitle: Story = { args: { ...ROW, title: 'Quarterly planning with the whole product and design team, part two of three' } }
