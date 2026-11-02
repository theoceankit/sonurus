import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Sidebar, type SidebarRecording, type SidebarSection } from './Sidebar'
import styles from './Sidebar.stories.module.css'

const meta: Meta<typeof Sidebar> = {
  component: Sidebar,
  decorators: [Story => <div className={styles.frame}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Sidebar>

const recording = (id: number, title: string, needsReview = false): SidebarRecording => ({
  id,
  title,
  needsReview,
  speakers: [
    { id: 'anna', name: 'Anna Petrova', color: 5 },
    needsReview ? { id: 'unknown', kind: 'unknown' } : { id: 'mark', name: 'Mark Ellis', color: 1 },
  ],
})

const WEEK: SidebarSection = {
  title: 'This week',
  recordings: [recording(3, 'Interview: onboarding feedback', true), recording(4, 'Call with Mark'), recording(5, 'Customer call, Acme')],
}
const PINNED: SidebarSection = {
  title: 'Pinned',
  recordings: [recording(1, 'Weekly product sync', true), recording(2, 'Design review', true)],
}
const earlier = (count: number): SidebarSection => ({
  title: 'Earlier',
  recordings: Array.from({ length: count }, (_, i) => recording(10 + i, `Recording ${i + 1}`)),
})

export const Default: Story = { args: { sections: [WEEK, earlier(4)] } }
export const WithPinned: Story = { args: { sections: [PINNED, WEEK, earlier(4)], selectedId: 1 } }
export const Scrolled: Story = { args: { sections: [PINNED, WEEK, earlier(30)], selectedId: 1 } }
export const LongTitles: Story = {
  args: { sections: [{ title: 'This week', recordings: [recording(1, 'A title long enough that it has to be cut at the end of the row', true)] }] },
}
export const Loading: Story = { args: { state: 'loading' } }
export const Empty: Story = { args: { sections: [] } }
export const Failed: Story = { args: { state: 'error' } }

export const Selecting: Story = {
  render: () => {
    const [selectedId, setSelectedId] = useState<number | null>(null)
    return <Sidebar sections={[PINNED, WEEK]} selectedId={selectedId} onSelect={setSelectedId} />
  },
}
