import type { Meta, StoryObj } from '@storybook/react-vite'
import { ChooseSpeakerModal, type ChooseSpeakerList, type ChooseSpeakerRow } from './ChooseSpeakerModal'

const BEST: ChooseSpeakerRow[] = [
  { id: 'mark', name: 'Mark Ellis', colorIndex: 0, score: 0.82, suggested: true },
  { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, score: 0.41 },
  { id: 'priya', name: 'Priya Shah', colorIndex: 1, score: 0.12 },
]
const OTHERS: ChooseSpeakerRow[] = [
  ['anna', 'Anna Petrova', 4, 8], ['oliver', 'Oliver Grant', 2, 5], ['sofia', 'Sofia Ramos', 1, 3], ['olga', 'Olga Larsen', 2, 1],
  ['daniel', 'Daniel Brooks', 3, 4], ['emma', 'Emma Wilson', 4, 4], ['hugo', 'Hugo Martin', 0, 2], ['ines', 'Ines Costa', 1, 2],
].map(([id, name, colorIndex, recordings]) => ({ id: id as string, name: name as string, colorIndex: colorIndex as number, usage: `${recordings} ${recordings === 1 ? 'recording' : 'recordings'}` }))

const list = (query: string): ChooseSpeakerList => {
  const match = (row: ChooseSpeakerRow) => row.name.toLowerCase().includes(query.trim().toLowerCase())
  const best = BEST.filter(match)
  const others = OTHERS.filter(match)
  return {
    counts: { all: best.length + others.length, best: best.length, recording: others.length && 2 },
    sections: [{ title: 'Best voice matches', rows: best }, { title: 'Other speakers', rows: others }].filter(section => section.rows.length),
  }
}

const meta: Meta<typeof ChooseSpeakerModal> = {
  component: ChooseSpeakerModal,
  args: { list, onAssign: () => {}, onNewSpeaker: () => {}, onClose: () => {}, preview: true },
}
export default meta

type Story = StoryObj<typeof ChooseSpeakerModal>

export const Default: Story = { args: { initialSelectedId: 'mark' } }
export const NothingSelected: Story = {}
export const Searching: Story = { args: { initialQuery: 'Ol', initialSelectedId: 'oliver' } }
export const NoResults: Story = { args: { initialQuery: 'Zoe' } }
export const NoSpeakers: Story = { args: { list: () => ({ counts: { all: 0, best: 0, recording: 0 }, sections: [] }) } }
export const Busy: Story = { args: { initialSelectedId: 'mark', busy: true } }
export const Open: Story = { args: { initialSelectedId: 'mark', preview: false } }
