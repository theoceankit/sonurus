import type { Meta, StoryObj } from '@storybook/react-vite'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
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

// As in the app, every named speaker has a handle.
const withHandle = (row: ChooseSpeakerRow): ChooseSpeakerRow => ({ ...row, handle: row.name.toLowerCase().replace(' ', '.') })

const list = (query: string): ChooseSpeakerList => {
  const match = (row: ChooseSpeakerRow) => row.name.toLowerCase().includes(query.trim().toLowerCase())
  const best = BEST.filter(match).map(withHandle)
  const others = OTHERS.filter(match).map(withHandle)
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
export const WithPhotos: Story = {
  args: {
    initialSelectedId: 'mark',
    list: query => {
      const found = list(query)
      return { ...found, sections: found.sections.map(section => ({ ...section, rows: section.rows.map(row => (row.id === 'mark' || row.id === 'anna' ? { ...row, photo: portrait } : row)) })) }
    },
  },
}
export const Busy: Story = { args: { initialSelectedId: 'mark', busy: true } }
export const Open: Story = { args: { initialSelectedId: 'mark', preview: false } }

// Another use of the window, choosing who to merge into: its own title, button and
// categories, no New speaker, and speakers without a name among the rows.
type MergeCategory = 'all' | 'named' | 'unnamed'
const UNNAMED: ChooseSpeakerRow[] = [
  { id: 'u1', name: 'Unnamed speaker', unnamed: true, colorIndex: 0, usage: '1 recording' },
  { id: 'u2', name: 'Unnamed speaker', unnamed: true, colorIndex: 0, usage: '2 recordings' },
]
const mergeList = (query: string, category: MergeCategory): ChooseSpeakerList<MergeCategory> => {
  const typed = query.trim().toLowerCase()
  const named = OTHERS.map(withHandle).filter(row => row.name.toLowerCase().includes(typed))
  const unnamed = typed ? [] : UNNAMED
  const rows = category === 'named' ? named : category === 'unnamed' ? unnamed : [...named, ...unnamed]
  const title = { all: 'All speakers', named: 'Recognized', unnamed: 'Unnamed' }[category]
  return { counts: { all: OTHERS.length + UNNAMED.length, named: OTHERS.length, unnamed: UNNAMED.length }, sections: rows.length ? [{ title, rows }] : [] }
}
export const MergeInto: StoryObj<typeof ChooseSpeakerModal<MergeCategory>> = {
  render: () => (
    <ChooseSpeakerModal<MergeCategory>
      preview
      title='Merge "Lena Kovacs" into another speaker'
      confirmLabel="Merge"
      categories={[
        { id: 'all', label: 'All speakers', icon: 'speakers' },
        { id: 'named', label: 'Recognized', icon: 'check' },
        { id: 'unnamed', label: 'Unnamed', icon: 'speaker-unknown' },
      ]}
      list={mergeList}
      initialSelectedId="anna"
      onAssign={() => {}}
      onClose={() => {}}
    />
  ),
}
export const MergeIntoNoResults: StoryObj<typeof ChooseSpeakerModal<MergeCategory>> = {
  render: () => (
    <ChooseSpeakerModal<MergeCategory>
      preview title='Merge "Lena Kovacs" into another speaker' confirmLabel="Merge" initialQuery="Zoe"
      categories={[{ id: 'all', label: 'All speakers', icon: 'speakers' }]}
      list={mergeList} onAssign={() => {}} onClose={() => {}}
    />
  ),
}
