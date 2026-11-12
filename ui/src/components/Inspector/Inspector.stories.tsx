import type { Meta, StoryObj } from '@storybook/react-vite'
import { ReviewCard } from '../ReviewCard/ReviewCard'
import { SpeakerRow } from '../SpeakerRow/SpeakerRow'
import { Stack } from '../Stack/Stack'
import { TalkTime } from '../TalkTime/TalkTime'
import styles from './Inspector.stories.module.css'
import { Inspector } from './Inspector'

const CONTENT = (
  <>
    <TalkTime total="0:53" segments={[{ id: 'a', name: 'Anna Petrova', color: 5, seconds: 19, time: '0:19' }, { id: 'b', name: 'Mark Ellis', color: 1, seconds: 11, time: '0:11' }, { id: 'c', name: 'Unknown speaker 1', color: 6, seconds: 9, time: '0:09' }]} />
    <Stack>
      <SpeakerRow speaker={{ name: 'Anna Petrova', color: 5 }} time="0:19" />
      <SpeakerRow speaker={{ name: 'Mark Ellis', color: 1 }} time="0:11" />
      <SpeakerRow speaker={{ kind: 'unknown', name: 'Unknown speaker 1' }} time="0:09" selected />
    </Stack>
  </>
)
const CARD = (
  <ReviewCard
    speaker={{ kind: 'unknown', name: 'Unknown speaker 1' }}
    clip={{ duration: '0:04', text: 'That was me.', progress: 0 }}
    candidates={[{ id: 'mark', name: 'Mark Ellis', colorIndex: 0, score: 0.82, suggested: true }, { id: 'lena', name: 'Lena Kovacs', colorIndex: 3, score: 0.41, suggested: false }]}
  />
)

const meta: Meta<typeof Inspector> = {
  component: Inspector,
  decorators: [Story => <div className={styles.panel}><Story /></div>],
  args: { children: CONTENT },
}
export default meta

type Story = StoryObj<typeof Inspector>

export const ReviewOn: Story = { args: { review: { mode: 'on', counter: '1 of 4', card: CARD } } }
export const ReviewCollapsed: Story = { args: { review: { mode: 'collapsed', left: 4 } } }
export const ReviewOff: Story = {}
export const Empty: Story = { args: { children: undefined } }
// The pointer on Close inspector: the line of its icon moves towards the frame.
export const CloseHover: Story = { parameters: { pseudo: { hover: ['button[aria-label="Close inspector"]'] } } }
