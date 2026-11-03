import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { AvatarStack } from '../AvatarStack/AvatarStack'
import { SpeakerRow } from './SpeakerRow'
import styles from './SpeakerRow.stories.module.css'

const ANNA = { name: 'Anna Petrova', color: 5 } as const
const UNKNOWN = { kind: 'unknown', name: 'Unknown speaker 1' } as const
const UNASSIGNED = { kind: 'unassigned', name: 'Unassigned' } as const
const noop = () => {}
const HIDDEN = [
  { id: 'a', name: 'Oliver Grant', color: 3 },
  { id: 'b', name: 'Sofia Ramos', color: 2 },
  { id: 'c', kind: 'unknown' },
] as const

const meta: Meta<typeof SpeakerRow> = {
  component: SpeakerRow,
  decorators: [Story => <div className={styles.panel}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof SpeakerRow>

const STATES = ['Default', 'Hover', 'Focus'] as const

export const Matrix: Story = {
  decorators: [],
  render: () => (
    <StateMatrix
      wideCells
      states={STATES}
      rows={[
        { label: 'Speaker', render: () => <SpeakerRow speaker={ANNA} time="0:19" onPlay={noop} onAssign={noop} /> },
        { label: 'Selected', render: () => <SpeakerRow speaker={UNKNOWN} time="0:09" selected onSelect={noop} onPlay={noop} onAssign={noop} /> },
        { label: 'Unknown', render: () => <SpeakerRow speaker={UNKNOWN} time="0:09" onSelect={noop} onPlay={noop} onAssign={noop} /> },
        { label: 'Unassigned', render: () => <SpeakerRow speaker={UNASSIGNED} time="0:04" onAssign={noop} /> },
        { label: 'Show more', render: () => <SpeakerRow kind="show-more" count={3} onToggle={noop} stack={<AvatarStack speakers={[...HIDDEN]} />} /> },
        { label: 'Highlighted', render: () => <SpeakerRow speaker={ANNA} time="0:19" highlighted onPlay={noop} onAssign={noop} /> },
        { label: 'Show more highlighted', render: () => <SpeakerRow kind="show-more" count={3} highlighted onToggle={noop} stack={<AvatarStack speakers={[...HIDDEN]} />} /> },
        { label: 'Show less', render: () => <SpeakerRow kind="show-more" count={3} expanded onToggle={noop} /> },
      ]}
    />
  ),
}

export const Speaker: Story = { args: { speaker: ANNA, time: '0:19', onPlay: noop, onAssign: noop } }
export const Selected: Story = { args: { speaker: UNKNOWN, time: '0:09', selected: true, onSelect: noop, onPlay: noop, onAssign: noop } }
export const Playing: Story = { args: { speaker: ANNA, time: '0:19', playing: true, onPlay: noop, onAssign: noop } }
export const NoAudio: Story = { args: { speaker: ANNA, time: '0:19', playDisabled: true, onPlay: noop, onAssign: noop } }
export const Unassigned: Story = { args: { speaker: UNASSIGNED, time: '0:04', onAssign: noop } }
export const OnlyShows: Story = { args: { speaker: ANNA, time: '0:19' } }
export const LongName: Story = { args: { speaker: { name: 'Alexandra Konstantinopolskaya-Vandenberghe of the Very Long Name', color: 3 }, time: '1:02:05', onPlay: noop, onAssign: noop } }
export const ShowMore: Story = { args: { kind: 'show-more', count: 3, onToggle: noop, stack: <AvatarStack speakers={[...HIDDEN]} /> } }
export const ShowLess: Story = { args: { kind: 'show-more', count: 3, expanded: true, onToggle: noop } }
export const Highlighted: Story = { args: { speaker: ANNA, time: '0:19', highlighted: true, onPlay: noop, onAssign: noop } }
export const SelectedHighlighted: Story = { args: { speaker: UNKNOWN, time: '0:09', selected: true, highlighted: true, onSelect: noop, onPlay: noop, onAssign: noop } }
export const ShowMoreHighlighted: Story = { args: { kind: 'show-more', count: 3, highlighted: true, onToggle: noop, stack: <AvatarStack speakers={[...HIDDEN]} /> } }
