import type { Meta, StoryObj } from '@storybook/react-vite'
import { ModelRow } from './ModelRow'

const noop = () => {}

const meta: Meta<typeof ModelRow> = {
  component: ModelRow,
  args: {
    icon: 'whisper-model',
    name: 'Whisper Small',
    meta: ['244 MB', '~4× realtime', 'Good'],
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
export const Recommended: Story = { args: { name: 'Whisper Large v3', meta: ['1.55 GB', '~1× realtime', 'Best'], badges: [{ label: 'Recommended', tone: 'accent' }] } }
export const Downloading: Story = { args: { state: 'downloading', pct: 42 } }
export const Installed: Story = { args: { state: 'installed' } }
export const InUse: Story = { args: { state: 'installed', selected: true, badges: [{ label: 'In use', tone: 'success' }] } }
export const InstalledHover: Story = { args: { state: 'installed' }, parameters: { pseudo: { hover: true } } }
export const DeleteBlocked: Story = { args: { state: 'installed', selected: true, deleteBlocked: 'In use by the running transcription' } }
export const Failed: Story = { args: { state: 'failed', error: 'Connection to huggingface.co timed out' } }
export const FailedLongError: Story = {
  args: { state: 'failed', error: '401 Client Error: Unauthorized for the pyannote speaker-diarization-3.1 model, the HuggingFace token has no access to this gated model' },
}
export const Diarization: Story = { args: { icon: 'diarization-model', name: 'Diarization v2', meta: ['130 MB', 'Speaker separation'], badges: [{ label: 'Diarization' }], state: 'installed', onUse: undefined } }
export const Alignment: Story = { args: { icon: 'alignment', name: 'Czech', nativeName: 'Čeština', meta: ['~300 MB', 'wav2vec2'], onUse: undefined } }
