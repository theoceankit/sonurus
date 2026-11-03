import type { Meta, StoryObj } from '@storybook/react-vite'
import { ALL_HANDS_ID } from '../../api/fixtures/all-hands'
import { DESIGN_REVIEW_ID, PLANNING_CALL_ID, WEEKLY_SYNC_ID } from '../../api/fixtures/data'
import { InspectorPanel } from './InspectorPanel'
import styles from './InspectorPanel.stories.module.css'
import { standing } from './story-helpers'

// The panel at several heights: the rows take the room there is, and the rest go
// behind Show N more.
const HEIGHTS = [360, 480, 600, 760, 960]

function Heights({ transcriptId }: { transcriptId: number }) {
  return (
    <div className={styles.heights}>
      {HEIGHTS.map(height => (
        <div key={height} className={styles.frame}>
          <span>{height} px</span>
          <div className={styles.panel} style={{ height }}>
            <InspectorPanel transcriptId={transcriptId} playback={standing()} />
          </div>
        </div>
      ))}
    </div>
  )
}

const meta: Meta<typeof Heights> = {
  title: 'Screens/Editor/Inspector/Room for the rows',
  component: Heights,
  parameters: { layout: 'fullscreen', api: { board: 'speakerCounts' } },
}
export default meta

type Story = StoryObj<typeof Heights>

export const FifteenSpeakers: Story = { args: { transcriptId: ALL_HANDS_ID } }
export const SixSpeakers: Story = { args: { transcriptId: WEEKLY_SYNC_ID } }
export const LongClip: Story = { args: { transcriptId: DESIGN_REVIEW_ID } }
export const TwoSpeakers: Story = { args: { transcriptId: PLANNING_CALL_ID } }
export const ReviewOver: Story = { args: { transcriptId: WEEKLY_SYNC_ID }, parameters: { api: { board: 'reviewDone' } } }

