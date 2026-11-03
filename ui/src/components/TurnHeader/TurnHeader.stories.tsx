import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { TurnHeader, type TurnHeaderSpeaker } from './TurnHeader'
import styles from './TurnHeader.stories.module.css'

const SPEAKERS: Record<string, TurnHeaderSpeaker> = {
  Named: { kind: 'named', name: 'Mark Ellis', color: 1 },
  Unknown: { kind: 'unknown', name: 'Unknown speaker 1', color: 6 },
  Unassigned: { kind: 'unassigned', name: 'Unassigned', color: 6 },
  'Long name': { kind: 'named', name: 'Alexandra Konstantinopolskaya-Vandenberghe of the Very Long Name', color: 3 },
}

const meta: Meta<typeof TurnHeader> = {
  component: TurnHeader,
  args: { speaker: SPEAKERS.Named, time: '00:05' },
}
export default meta

type Story = StoryObj<typeof TurnHeader>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Open'] as const

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={Object.entries(SPEAKERS).map(([label, speaker]) => ({
        label,
        render: state => <div className={styles.narrow}><TurnHeader speaker={speaker} time="00:05" open={state === 'Open'} /></div>,
      }))}
    />
  ),
}

export const Named: Story = {}
export const Unknown: Story = { args: { speaker: SPEAKERS.Unknown } }
export const Unassigned: Story = { args: { speaker: SPEAKERS.Unassigned } }
export const LongName: Story = { args: { speaker: SPEAKERS['Long name'] } }
export const LongNameNarrow: Story = {
  args: { speaker: SPEAKERS['Long name'] },
  decorators: [Story => <div className={styles.narrow}><Story /></div>],
}
