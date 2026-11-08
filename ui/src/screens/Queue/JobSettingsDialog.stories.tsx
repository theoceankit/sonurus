import type { Meta, StoryObj } from '@storybook/react-vite'
import { DEFAULT_INSTALLED, fixtureModels } from '../../api/fixtures/models'
import { NOTHING_PICKED, transcribeChoice } from '../../transcribe/choice'
import { JobSettingsDialog, type JobSettingsDialogProps } from './JobSettingsDialog'

const noop = () => {}
const choice = transcribeChoice(fixtureModels(DEFAULT_INSTALLED), { transcribeModel: null, transcribeModelHistory: [], transcribeLang: 'auto' }, NOTHING_PICKED)

const meta: Meta<typeof JobSettingsDialog> = {
  title: 'Screens/Queue/Job settings dialog',
  component: JobSettingsDialog,
  args: {
    open: true,
    preview: true,
    form: { title: 'Weekly product sync', model: 'small', language: 'auto' },
    modelOptions: choice.modelOptions,
    languageOptions: choice.languageOptions,
    error: null,
    refusal: null,
    saving: false,
    onChange: noop,
    onSave: noop,
    onClose: noop,
  } satisfies JobSettingsDialogProps,
}
export default meta

type Story = StoryObj<typeof JobSettingsDialog>

export const Default: Story = {}
export const BlankTitle: Story = { args: { form: { title: '', model: 'small', language: 'auto' }, error: 'Title cannot be empty.' } }
export const Started: Story = {
  args: { refusal: { message: 'This job has started and can no longer be changed.', code: 'job_running', settingsSection: null } },
}
export const ModelMissing: Story = {
  args: {
    form: { title: 'Weekly product sync', model: 'small', language: 'pl' },
    refusal: { message: 'Alignment model for language "pl" is not installed. Download it in Settings.', code: 'alignment_model_missing', settingsSection: 'alignment' },
  },
}
export const Saving: Story = { args: { saving: true } }

// In the app, the edit button of a queue card opens it: Screens/Editor, With queue.
