import type { Meta, StoryObj } from '@storybook/react-vite'
import { SectionCard } from '../SectionCard/SectionCard'
import { Stack } from '../Stack/Stack'
import { ModelRow, type DefaultMark } from './ModelRow'

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
export const Failed: Story = { args: { state: 'failed', error: 'Connection to huggingface.co timed out' } }
export const FailedLongError: Story = {
  args: { state: 'failed', error: '401 Client Error: Unauthorized for the pyannote speaker-diarization-3.1 model, the HuggingFace token has no access to this gated model' },
}
export const Diarization: Story = { args: { icon: 'diarization-model', name: 'Pyannote Community-1', meta: ['130 MB'], state: 'installed', onUse: undefined } }
export const Alignment: Story = { args: { icon: 'alignment', name: 'Czech', meta: ['~300 MB'], onUse: undefined } }

const MARKS: { mark: DefaultMark; title: string }[] = [
  { mark: 'badge', title: 'A. Badge next to the name' },
  { mark: 'check', title: 'B. Check and Default in place of Use' },
  { mark: 'tint', title: 'C. Tinted row, Default under the name' },
  { mark: 'radio', title: 'D. Radio on every installed model' },
]

// How the default model could be marked; one will stay.
export const DefaultMarks: Story = {
  decorators: [Story => <div style={{ width: 520 }}><Story /></div>],
  render: () => (
    <Stack gap={4}>
      {MARKS.map(({ mark, title }) => (
        <SectionCard key={mark} title={title}>
          <ModelRow icon="whisper-model" name="Whisper Small" meta={['244 MB', '~4× realtime']} state="installed" defaultMark={mark} onUse={noop} onDelete={noop} />
          <ModelRow icon="whisper-model" name="Whisper Large v3" meta={['1.55 GB', '~1× realtime']} state="installed" selected defaultMark={mark} onUse={noop} onDelete={noop} />
          <ModelRow icon="whisper-model" name="Whisper Medium" meta={['769 MB', '~2× realtime']} state="available" defaultMark={mark} onDownload={noop} />
        </SectionCard>
      ))}
    </Stack>
  ),
}
