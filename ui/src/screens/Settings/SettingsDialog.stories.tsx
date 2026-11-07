import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
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

export const Alignment: Story = { args: { section: 'alignment' }, parameters: { api: { installedModels: ['small', 'diarize', 'ru', 'uk'], downloadStepMs: 1500 } } }
