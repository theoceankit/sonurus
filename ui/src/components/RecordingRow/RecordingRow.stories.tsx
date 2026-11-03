import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Stack } from '../Stack/Stack'
import type { StackSpeaker } from '../AvatarStack/AvatarStack'
import { RecordingRow } from './RecordingRow'
import styles from './RecordingRow.stories.module.css'

const meta: Meta<typeof RecordingRow> = {
  component: RecordingRow,
  args: { title: 'Weekly product sync' },
  decorators: [Story => <div className={styles.column}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof RecordingRow>

const SPEAKERS: StackSpeaker[] = [
  { id: 'anna', name: 'Anna Petrova', color: 5 },
  { id: 'mark', name: 'Mark Ellis', color: 1 },
  { id: 'unknown', kind: 'unknown' },
]
const MANY: StackSpeaker[] = [...SPEAKERS, { id: 'lena', name: 'Lena Kovacs', color: 4 }, { id: 'oliver', name: 'Oliver Grant', color: 3 }]

const STATES = ['Default', 'Hover', 'Focus'] as const

const row = (label: string, props: { isNew?: boolean; selected?: boolean }) => ({
  label,
  render: () => <div className={styles.column}><RecordingRow title="Weekly product sync" speakers={SPEAKERS} {...props} /></div>,
})

export const Matrix: Story = {
  decorators: [Story => <Story />],
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        row('None', {}),
        row('None Selected', { selected: true }),
        row('New', { isNew: true }),
        row('New Selected', { isNew: true, selected: true }),
      ]}
    />
  ),
}

export const Example: Story = { args: { speakers: SPEAKERS } }

export const Contents: Story = {
  render: () => (
    <Stack gap="half" align="stretch">
      <RecordingRow title="No speakers" />
      <RecordingRow title="One speaker" speakers={SPEAKERS.slice(0, 1)} />
      <RecordingRow title="More than three" speakers={MANY} />
      <RecordingRow title="A title long enough that it has to be cut at the end of the row" speakers={MANY} isNew />
    </Stack>
  ),
}
