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
