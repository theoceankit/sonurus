import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import type { GpuStatus } from '../../api/types'
import { Button } from '../../components/Button/Button'
import { SettingsDialog, type SettingsDialogProps } from './SettingsDialog'
import { SettingsProvider, useSettingsDialog } from './SettingsProvider'
import type { SettingsSection } from './sections'
import { withSettings } from './story-helpers'

const meta: Meta<typeof SettingsDialog> = {
  title: 'Screens/Settings/Settings dialog',
  component: SettingsDialog,
  args: { open: true, preview: true, section: 'general' } satisfies Partial<SettingsDialogProps>,
  decorators: [withSettings()],
  render: function Render(args) {
    const [section, setSection] = useState<SettingsSection>(args.section)
    return <SettingsDialog {...args} section={section} onSectionChange={setSection} onClose={() => {}} />
  },
}
export default meta

type Story = StoryObj<typeof SettingsDialog>

export const General: Story = {}

export const GeneralAtAnotherScale: Story = { decorators: [withSettings({ scale: 150, transcribeLang: 'de' })] }

// Download starts the model of the language; the fixtures take a few seconds.
export const AlignmentModelMissing: Story = {
  decorators: [withSettings({ transcribeLang: 'cs' })],
  parameters: { api: { downloadStepMs: 1500 } },
}

export const AlignmentDownloadFails: Story = {
  decorators: [withSettings({ transcribeLang: 'cs' })],
  parameters: { api: { downloadStepMs: 500, downloadFails: true } },
}

export const QueueNotAnswering: Story = {
  parameters: { api: { overrides: { getQueue: () => new Promise(() => {}) } } },
}

// In the app: the window over the screen, with its scrim and focus trap.
export const Live: Story = {
  render: () => {
    function Open() {
      const settings = useSettingsDialog()
      return <Button onClick={() => settings.open()}>Open Settings</Button>
    }
    return <SettingsProvider><Open /></SettingsProvider>
  },
}

export const Models: Story = { args: { section: 'models' }, decorators: [withSettings({ transcribeModel: 'large-v3' })] }

export const ModelsNothingInstalled: Story = { args: { section: 'models' }, parameters: { api: { noModels: true, downloadStepMs: 1500 } } }

export const ModelsWithoutDiarization: Story = { args: { section: 'models' }, parameters: { api: { installedModels: ['small'] } } }

// Download any model to see its row fail with the backend's reason and Retry.
export const ModelsDownloadFails: Story = { args: { section: 'models' }, parameters: { api: { installedModels: ['small', 'diarize'], downloadStepMs: 300, downloadFails: true } } }

export const ModelsLoading: Story = { args: { section: 'models' }, parameters: { api: { overrides: { listModels: () => new Promise(() => {}) } } } }

// The devices a new recording starts with; the backend's system audio sources.
export const AudioDevices: Story = { args: { section: 'audio' }, decorators: [withSettings({ recordingSystemDevice: 'bluez_output.58_18_62_38_72_FA.1.monitor' })] }
export const AudioDevicesNoSystemAudio: Story = { args: { section: 'audio' }, parameters: { api: { captureSources: [] } } }
export const Alignment: Story = { args: { section: 'alignment' }, parameters: { api: { installedModels: ['small', 'diarize', 'ru', 'uk'], downloadStepMs: 1500 } } }

// Delete Whisper Small: two jobs in the queue use it, so it asks over Settings.
export const DeleteAskedOverSettings: Story = {
  args: { section: 'models' },
  parameters: {
    api: {
      installedModels: ['small', 'large-v3', 'diarize'],
      overrides: { getQueue: async () => queueSnapshot({ jobs: [{ ...QUEUE_JOB, id: 'a', whisper_model: 'small' }, { ...QUEUE_JOB, id: 'b', whisper_model: 'small' }] }) },
    },
  },
  render: function Render() {
    function Open() {
      const settings = useSettingsDialog()
      return <Button onClick={() => settings.open('models')}>Open Settings on Models</Button>
    }
    return <SettingsProvider><Open /></SettingsProvider>
  },
}

const gpuStory = (gpu: Partial<GpuStatus>, extra: object = {}): Story => ({ args: { section: 'gpu' }, parameters: { api: { gpu, downloadStepMs: 1500, ...extra } } })

// Download goes through the download and install to the restart, and then On.
export const GpuNotInstalled: Story = gpuStory({})
export const GpuDownloadFails: Story = gpuStory({}, { downloadStepMs: 400, downloadFails: true })
export const GpuWaitingToApply: Story = gpuStory({ state: 'pending_restart', pending: 'install' }, { overrides: { requestGpuRestart: async () => ({ status: 'waiting', reason: 'transcription' }) } })
export const GpuOn: Story = gpuStory({ state: 'active', device: 'cuda', torch: '2.8.0+cu128' })
export const GpuCheckFailed: Story = gpuStory({ state: 'error', error: 'CUDA is not available to PyTorch' })
export const GpuUpdateNeeded: Story = gpuStory({ state: 'stale' })
export const GpuDriverTooOld: Story = gpuStory({ blocked_reason: 'driver_too_old', gpu: { name: 'NVIDIA GeForce RTX 4060', driver: '535.183.01', compute_capability: '8.9' } })
export const GpuTooOld: Story = gpuStory({ blocked_reason: 'gpu_too_old', gpu: { name: 'NVIDIA GeForce GTX 1060', driver: '581.29', compute_capability: '6.1' } })
export const GpuNoNvidia: Story = gpuStory({ blocked_reason: 'no_nvidia', gpu: null })
export const GpuDevelopmentBuild: Story = gpuStory({ blocked_reason: 'not_packaged', device: 'cuda', torch: '2.8.0+cu128' })

export const ApiKeys: Story = { args: { section: 'apiKeys' }, decorators: [withSettings({ hfToken: 'hf_storybookExampleToken' })] }

export const ApiKeysEmpty: Story = { args: { section: 'apiKeys' } }

export const Export: Story = { args: { section: 'export' } }

export const Data: Story = { args: { section: 'data' } }

export const DataWhileTranscribing: Story = {
  args: { section: 'data' },
  parameters: { api: { overrides: { getQueue: async () => queueSnapshot({ jobs: [{ ...QUEUE_JOB, id: 'a', status: 'running' }], running_job_id: 'a' }) } } },
}

// Reset… and Delete… ask over Settings, which stays open under the question.
export const DataLive: Story = {
  render: function Render() {
    function Open() {
      const settings = useSettingsDialog()
      return <Button onClick={() => settings.open('data')}>Open Settings on Data</Button>
    }
    return <SettingsProvider><Open /></SettingsProvider>
  },
}

export const Appearance: Story = { args: { section: 'appearance' }, decorators: [withSettings({ scale: 125 })] }
