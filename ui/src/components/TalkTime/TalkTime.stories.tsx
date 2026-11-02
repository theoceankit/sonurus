import type { Meta, StoryObj } from '@storybook/react-vite'
import { TalkTime, type TalkTimeSegment } from './TalkTime'
import styles from './TalkTime.stories.module.css'

const BOARD: TalkTimeSegment[] = [
  { id: 'a', name: 'Anna Petrova', color: 5, seconds: 19 },
  { id: 'b', name: 'Mark Ellis', color: 1, seconds: 11 },
  { id: 'c', name: 'Unknown speaker 1', color: 6, seconds: 9 },
  { id: 'd', name: 'Oliver Grant', color: 3, seconds: 7 },
  { id: 'e', name: 'Sofia Ramos', color: 2, seconds: 4 },
  { id: 'f', name: 'Lena Kovacs', color: 4, seconds: 3 },
]

const meta: Meta<typeof TalkTime> = {
  component: TalkTime,
  decorators: [Story => <div className={styles.panel}><Story /></div>],
  args: { total: '0:53', segments: BOARD },
}
export default meta

type Story = StoryObj<typeof TalkTime>

export const Default: Story = {}
export const OneSpeaker: Story = { args: { total: '0:19', segments: BOARD.slice(0, 1) } }
export const Unassigned: Story = { args: { segments: [...BOARD.slice(0, 4), { id: 'u', name: 'Unassigned', color: 6, seconds: 4 }] } }
export const ManySpeakers: Story = {
  args: {
    total: '1:12:40',
    segments: Array.from({ length: 12 }, (_, i) => ({ id: String(i), name: `Speaker ${i}`, color: ((i % 6) + 1) as TalkTimeSegment['color'], seconds: 120 - i * 9 })),
  },
}
export const VeryShortTurn: Story = { args: { total: '10:01', segments: [{ id: 'a', name: 'Anna', color: 5, seconds: 600 }, { id: 'b', name: 'Mark', color: 1, seconds: 1 }] } }
