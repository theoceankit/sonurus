import type { Meta, StoryObj } from '@storybook/react-vite'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { StateMatrix } from '../../foundations/StateMatrix'
import { MentionChip, type MentionChipTarget } from './MentionChip'

const ANNA: MentionChipTarget = { kind: 'speaker', name: 'Anna Petrova', color: 4, handle: 'anna' }

const meta: Meta<typeof MentionChip> = {
  component: MentionChip,
  args: { target: ANNA },
}
export default meta

type Story = StoryObj<typeof MentionChip>

const STATES = ['Default', 'Selected'] as const
const TARGETS: { label: string; target: MentionChipTarget }[] = [
  { label: 'Speaker', target: ANNA },
  { label: 'Speaker with a photo', target: { kind: 'speaker', name: 'Mark Ellis', color: 1, photo: portrait, handle: 'mark' } },
  { label: 'Not in the base', target: { kind: 'person', name: 'Slack Person' } },
  { label: 'No name yet', target: { kind: 'unnamed', name: 'Unknown speaker 1' } },
]

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={TARGETS.map(({ label, target }) => ({ label, render: state => <MentionChip target={target} selected={state === 'Selected'} /> }))}
    />
  ),
}

export const Speaker: Story = {}
export const WithPhoto: Story = { args: { target: TARGETS[1].target } }
export const NotInTheBase: Story = { args: { target: TARGETS[2].target } }
// A voice of the base with no name yet, by the label the transcript shows. Named, it
// becomes a Speaker.
export const NoNameYet: Story = { args: { target: TARGETS[3].target } }
// The widest pairs of letters still fit the circle.
export const WideInitials: Story = { args: { target: { kind: 'speaker', name: 'Walter Wong', color: 2 } } }
export const LongName: Story = {
  args: { target: { kind: 'speaker', name: 'Maximiliana Alexandrovna Konstantinopolskaya', color: 3 } },
  decorators: [Story => <div style={{ width: 200 }}><Story /></div>],
}

// In a line of text, at the size of the note's body. A deleted speaker is plain text.
export const InText: Story = {
  render: () => (
    <p style={{ font: 'var(--font-body)', color: 'var(--color-text-primary)', margin: 0, maxWidth: 420 }}>
      <MentionChip target={ANNA} /> takes the import question, <MentionChip target={TARGETS[2].target} /> sends the logs,
      <MentionChip target={TARGETS[3].target} /> asked about large files, and Old Speaker, who was deleted, shows as text.
    </p>
  ),
}
