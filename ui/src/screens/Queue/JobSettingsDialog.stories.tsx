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
export const Refused: Story = { args: { error: 'The job is running; pause the queue to edit it' } }
export const Saving: Story = { args: { saving: true } }

// In the app, the edit button of a queue card opens it: Screens/Editor, With queue.
