import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Button } from '../Button/Button'
import { SpeakerMenu, type SpeakerMenuRow } from './SpeakerMenu'

const ROWS: SpeakerMenuRow[] = [
  { id: 'mark', name: 'Mark Ellis', colorIndex: 0, current: true, time: '0:20' },
  { id: 'anna', name: 'Anna Petrova', colorIndex: 4, current: false, time: '0:19' },
  { id: 'oliver', name: 'Oliver Grant', colorIndex: 2, current: false, time: '0:07' },
  { id: 'sofia', name: 'Sofia Ramos', colorIndex: 1, current: false, time: '0:04' },
  { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, current: false, time: '0:03' },
]

const SAME_NAME: SpeakerMenuRow[] = [
  { id: 'a', name: 'Anna Petrova', colorIndex: 4, current: false, time: '0:19', usage: '3 transcripts, 1:02:05' },
  { id: 'b', name: 'Anna Petrova', colorIndex: 0, current: false, usage: '1 transcript, 0:40' },
]

function Example({ rows = ROWS, section = 'In this recording' as string | null, initialQuery = '' }) {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null)
  const [open, setOpen] = useState(true)
  return (
    <>
      <Button ref={setAnchor} variant="secondary" size="small" onClick={event => { setAnchor(event.currentTarget); setOpen(true) }}>Mark Ellis</Button>
      {anchor && open && (
        <SpeakerMenu
          anchor={anchor}
          allSpeakers={13}
          initialQuery={initialQuery}
          rows={query => ({
            section: query ? null : section,
            rows: rows.filter(row => row.name.toLowerCase().includes(query.trim().toLowerCase())),
          })}
          onSelect={() => setOpen(false)}
          onClose={() => setOpen(false)}
        />
      )}
    </>
  )
}

const meta: Meta<typeof SpeakerMenu> = { component: SpeakerMenu, parameters: { layout: 'padded' } }
export default meta

type Story = StoryObj<typeof SpeakerMenu>

export const Default: Story = { render: () => <Example /> }
export const SameName: Story = { render: () => <Example rows={SAME_NAME} /> }
export const NoResults: Story = { render: () => <Example initialQuery="zz" /> }
export const NoNamedSpeakers: Story = { render: () => <Example rows={[]} section={null} /> }
