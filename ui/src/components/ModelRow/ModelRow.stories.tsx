import type { Meta, StoryObj } from '@storybook/react-vite'
import { ModelRow } from './ModelRow'

const noop = () => {}

const meta: Meta<typeof ModelRow> = {
  component: ModelRow,
  args: {
    icon: 'whisper-model',
    name: 'Whisper Small',
    meta: ['244 MB', '~4× realtime'],
    state: 'available',
    onDownload: noop,
    onCancel: noop,
    onUse: noop,
    onDelete: noop,
  },
  decorators: [Story => <div style={{ width: 500 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof ModelRow>

export const NotDownloaded: Story = {}
export const Downloading: Story = { args: { state: 'downloading', pct: 42 } }
export const Installed: Story = { args: { state: 'installed' } }
export const Default: Story = { args: { state: 'installed', selected: true } }
export const InstalledHover: Story = { args: { state: 'installed' }, parameters: { pseudo: { hover: true } } }
export const DeleteBlocked: Story = { args: { state: 'installed', selected: true, deleteBlocked: 'In use by the running transcription' } }
export const Failed: Story = { args: { state: 'failed', error: 'No connection to HuggingFace. Check the internet connection and try again.' } }
export const FailedLongError: Story = {
  args: { state: 'failed', error: "Your HuggingFace token has no access to this model. Accept the model's terms in your HuggingFace account and try again, or check the token in API Keys." },
}
export const FailedWithoutReason: Story = { args: { state: 'failed' } }
export const Diarization: Story = { args: { icon: 'diarization-model', name: 'Pyannote Community 1', meta: ['130 MB'], state: 'installed', onUse: undefined } }
export const Alignment: Story = { args: { icon: 'alignment', name: 'Czech', meta: ['~300 MB'], onUse: undefined } }

