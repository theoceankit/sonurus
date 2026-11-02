import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Candidate } from './Candidate'
import styles from './Candidate.stories.module.css'

const MARK = { name: 'Mark Ellis', color: 1 } as const

const meta: Meta<typeof Candidate> = {
  component: Candidate,
  decorators: [Story => <div className={styles.card}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Candidate>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus'] as const

export const Matrix: Story = {
  decorators: [],
  render: () => (
    <StateMatrix
      wideCells
      states={STATES}
      rows={[
        { label: 'Speaker', render: () => <Candidate speaker={MARK} score={0.41} /> },
        { label: 'Suggested', render: () => <Candidate speaker={MARK} score={0.82} suggested /> },
        { label: 'Selected', render: () => <Candidate speaker={MARK} score={0.41} selected /> },
        { label: 'Suggested, selected', render: () => <Candidate speaker={MARK} score={0.82} suggested selected /> },
        { label: 'Recordings', render: () => <Candidate speaker={MARK} usage="8 recordings" /> },
        { label: 'Add new', render: () => <Candidate kind="add">Add a new speaker</Candidate> },
      ]}
    />
  ),
}

export const Speaker: Story = { args: { speaker: MARK, score: 0.41 } }
export const Suggested: Story = { args: { speaker: MARK, score: 0.82, suggested: true } }
export const Selected: Story = { args: { speaker: MARK, score: 0.64, suggested: true, selected: true } }
export const Active: Story = { args: { speaker: MARK, score: 0.41, active: true } }
export const Recordings: Story = { args: { speaker: MARK, usage: '8 recordings' } }
export const AddNew: Story = { args: { kind: 'add', children: 'Add a new speaker' } }
export const LongName: Story = { args: { speaker: { name: 'Alexandra Konstantinopolskaya-Vandenberghe of the Very Long Name', color: 3 }, score: 0.82, suggested: true } }
