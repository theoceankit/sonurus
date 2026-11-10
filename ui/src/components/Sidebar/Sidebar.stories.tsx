import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { IconButton } from '../IconButton/IconButton'
import { MenuAction, MenuDivider } from '../Menu/Menu'
import { QueueRow } from '../QueueRow/QueueRow'
import { ScrollBar } from '../ScrollBar/ScrollBar'
import { ScrollFade, useScrollEdges } from '../ScrollFade/ScrollFade'
import { SectionHeader } from '../SectionHeader/SectionHeader'
import { Stack } from '../Stack/Stack'
import { Sidebar, type SidebarRecording, type SidebarSection } from './Sidebar'
import styles from './Sidebar.stories.module.css'

const meta: Meta<typeof Sidebar> = {
  component: Sidebar,
  decorators: [Story => <div className={styles.frame}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Sidebar>

const recording = (id: number, title: string, isNew = false, unknown = false): SidebarRecording => ({
  id,
  title,
  isNew,
  speakers: [
    { id: 'anna', name: 'Anna Petrova', color: 5 },
    unknown ? { id: 'unknown', kind: 'unknown' } : { id: 'mark', name: 'Mark Ellis', color: 1 },
  ],
})

const WEEK: SidebarSection = {
  title: 'This week',
  recordings: [recording(3, 'Interview: onboarding feedback', true, true), recording(4, 'Call with Mark'), recording(5, 'Customer call, Acme')],
}
const PINNED: SidebarSection = {
  title: 'Pinned',
  recordings: [recording(1, 'Weekly product sync', false, true), recording(2, 'Design review', true, true)],
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

// What the app puts in the slot: the queue as a section of the list, padded inside so
// its scroll bar stands at the sidebar's edge.
function QueueSlot({ titles }: { titles: string[] }) {
  const { area, scrollRef, bottom } = useScrollEdges()
  return (
    <Stack as="section" aria-label="Transcription queue" gap="half" align="stretch" className={styles.queue}>
      <Stack paddingX={2}><SectionHeader title="Queue" /></Stack>
      <div className={styles.queueArea}>
        <Stack as="ul" ref={scrollRef} gap="half" paddingX={2} align="stretch" className={styles.queueList}>
          {titles.map((title, i) => (
            <li key={title}>
              <QueueRow
                title={title}
                status={i === 0 ? 'running' : i === 2 ? 'failed' : 'waiting'}
                actions={<IconButton variant="ghost" size="xs" icon="more" label="More" />}
              />
            </li>
          ))}
        </Stack>
        <ScrollBar area={area} />
        {bottom && <ScrollFade edge="bottom" surface="sunken" size="lg" />}
      </div>
    </Stack>
  )
}
const queue = (titles: string[]) => <QueueSlot titles={titles} />

// The transcription queue above the list.
export const WithQueue: Story = { args: { sections: [PINNED, WEEK, earlier(4)], top: queue(['Weekly product sync', 'Design review', 'Old customer call']) } }

// A long queue takes up to 40 % of the height and scrolls with its own bar and fade;
// the list keeps the rest.
export const WithLongQueue: Story = {
  args: {
    sections: [PINNED, WEEK, earlier(30)],
    top: queue(Array.from({ length: 12 }, (_, i) => `Recording to transcribe ${i + 1}`)),
  },
}

const rowMenu = ({ isNew }: SidebarRecording) => (
  <>
    <MenuAction icon="edit">Rename</MenuAction>
    <MenuAction icon="eye">{isNew ? 'Mark as read' : 'Mark as unread'}</MenuAction>
    <MenuAction icon="pin">Pin</MenuAction>
    <MenuDivider />
    <MenuAction icon="delete">Delete recording</MenuAction>
  </>
)

// Right click a row, or focus it and press the Menu key or Shift+F10.
export const WithRowMenu: Story = { args: { sections: [PINNED, WEEK, earlier(4)], selectedId: 1, rowMenu } }

export const Renaming: Story = { args: { sections: [PINNED, WEEK, earlier(4)], selectedId: 1, renamingId: 4 } }
