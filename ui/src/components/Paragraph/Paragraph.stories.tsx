import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Paragraph } from './Paragraph'
import styles from './Paragraph.stories.module.css'

const TEXT = 'Right. The queue work landed, and so far nobody has reported a crash.'

const meta: Meta<typeof Paragraph> = {
  component: Paragraph,
  args: { text: TEXT, color: 1 },
  decorators: [Story => <div className={styles.column}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Paragraph>

// Editing has its own story: its field takes the focus and would scroll the matrix.
const STATES = ['Default', 'Hover', 'Focus', 'Playing'] as const

export const Matrix: Story = {
  decorators: [Story => <div className={styles.matrix}><Story /></div>],
  render: () => (
    <StateMatrix
      wideCells
      states={STATES}
      rows={[{
        label: 'Paragraph',
        render: state => (
          <Paragraph
            text={TEXT}
            color={1}
            showActions={state === 'Hover'}
            playing={state === 'Playing'}
          />
        ),
      }]}
    />
  ),
}

export const Default: Story = {}
export const WithActions: Story = { args: { showActions: true } }
export const Playing: Story = { args: { playing: true } }
export const PlayingUnknown: Story = { args: { playing: true, color: 6 } }
export const Editing: Story = { args: { editing: true } }
export const LongWord: Story = { args: { text: `A word that does not fit ${'x'.repeat(200)}` } }
