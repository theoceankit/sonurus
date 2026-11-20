import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import portrait from '../../api/fixtures/photos/portrait-1.jpg'
import { mentionList, type MentionCandidate } from './mention-list'
import { MentionList } from './MentionList'

const CANDIDATES: MentionCandidate[] = [
  { id: 'anna', name: 'Anna Petrova', handle: 'anna', color: 5, inRecording: true },
  { id: 'mark', name: 'Mark Ellis', handle: 'mark', color: 1, photo: portrait, inRecording: true },
  { id: 'lena', name: 'Lena Kovacs', handle: 'lena', color: 4, inRecording: true },
  { id: 'daniel', name: 'Daniel Brooks', handle: 'daniel', color: 4, inRecording: false },
  { id: 'hanna', name: 'Hanna Lind', handle: 'hanna', color: 2, inRecording: false },
  { id: 'kate', name: 'Kate Reyes', handle: 'kate', color: 2, inRecording: false },
]

function Shown({ query, active = 0 }: { query: string; active?: number }) {
  const [at, setAt] = useState(active)
  return <MentionList sections={mentionList(CANDIDATES, query).sections} active={at} onHover={setAt} onSelect={() => {}} />
}

const meta: Meta<typeof Shown> = {
  title: 'Components/MentionList',
  component: Shown,
}
export default meta

type Story = StoryObj<typeof Shown>

// Just @: everyone, the recording's speakers first.
export const NothingTyped: Story = { args: { query: '' } }
// @an: a match in each group, and the text itself last.
export const Search: Story = { args: { query: 'an' } }
export const SearchByHandle: Story = { args: { query: 'dan' } }
// Someone from a chat: only the person as typed.
export const NotInTheBase: Story = { args: { query: 'Slack Person' } }
export const LastOptionActive: Story = { args: { query: 'an', active: 3 } }
