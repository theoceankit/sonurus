import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { BOARD_HEIGHTS } from '../Waveform/bars'
import { ReviewCard, type ReviewCardCandidate } from './ReviewCard'
import styles from './ReviewCard.stories.module.css'

const UNKNOWN = { kind: 'unknown', name: 'Unknown speaker 1' } as const
const CANDIDATES: ReviewCardCandidate[] = [
  { id: 'mark', name: 'Mark Ellis', colorIndex: 0, score: 0.82, suggested: true },
  { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, score: 0.41, suggested: false },
  { id: 'priya', name: 'Priya Shah', colorIndex: 1, score: 0.12, suggested: false },
]
const CLIP = { duration: '0:04', text: 'That was me. Files over two hours took a long time to copy.', progress: 0, heights: BOARD_HEIGHTS.small }

const meta: Meta<typeof ReviewCard> = {
  component: ReviewCard,
  decorators: [Story => <div className={styles.dock}><Story /></div>],
  args: { speaker: UNKNOWN, clip: CLIP, candidates: CANDIDATES },
}
export default meta

type Story = StoryObj<typeof ReviewCard>

export const Unknown: Story = {}
export const Selected: Story = { args: { selectedId: 'lena' } }
export const TextExpanded: Story = { args: { initialTextExpanded: true } }
export const PossibleMatch: Story = {
  args: {
    speaker: { name: 'Oliver Grant', color: 3 },
    possibleMatch: true,
    selectedId: 'oliver',
    initialTextExpanded: true,
    clip: { ...CLIP, text: 'Let me check the numbers and get back to you by Friday.' },
    candidates: [
      { id: 'oliver', name: 'Oliver Grant', colorIndex: 2, score: 0.64, suggested: true },
      { id: 'mark', name: 'Mark Ellis', colorIndex: 0, score: 0.31, suggested: false },
      { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, score: 0.18, suggested: false },
    ],
  },
}
export const Playing: Story = { args: { clip: { ...CLIP, playing: true, progress: 0.4 } } }
export const NoAudio: Story = { args: { clip: { ...CLIP, disabled: true } } }
export const NoClip: Story = { args: { clip: null } }
export const NoCandidates: Story = { args: { candidates: [] } }
export const LongClip: Story = {
  args: {
    initialTextExpanded: true,
    clip: { ...CLIP, duration: '0:29', text: 'I went through a long meeting with it yesterday, and the part that helped most was hearing a voice before choosing, because names in the list mean little when you have not met everyone, and a short clip tells you more than any percentage.' },
  },
}
export const Busy: Story = { args: { selectedId: 'mark', busy: true } }
export const LongNames: Story = {
  args: {
    speaker: { kind: 'unknown', name: 'Unknown speaker 12' },
    candidates: [{ id: 'long', name: 'Alexandra Konstantinopolskaya-Vandenberghe of the Very Long Name', colorIndex: 2, score: 0.82, suggested: true }],
  },
}

export const ChoosingWorks: Story = {
  render: args => {
    const [selectedId, setSelectedId] = useState<string | null>(null)
    return <ReviewCard {...args} selectedId={selectedId} onSelect={setSelectedId} />
  },
}
