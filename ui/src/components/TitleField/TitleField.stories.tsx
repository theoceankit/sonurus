import type { Meta, StoryObj } from '@storybook/react-vite'
import { TitleField } from './TitleField'

const meta: Meta<typeof TitleField> = {
  component: TitleField,
  args: { title: 'Weekly product sync', label: 'Recording title', onDone: () => {} },
}
export default meta

type Story = StoryObj<typeof TitleField>

// Unstyled: TranscriptHeader and RecordingRow give it their own look.
export const Default: Story = {}
