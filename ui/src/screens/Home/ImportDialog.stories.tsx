import type { Meta, StoryObj } from '@storybook/react-vite'
import { NO_MODELS } from '../../api/fixtures/fixture-client'
import { DEFAULT_INSTALLED, fixtureModels } from '../../api/fixtures/models'
import { NOTHING_PICKED, transcribeChoice } from '../../transcribe/choice'
import { ImportDialog, type ImportDialogProps } from './ImportDialog'

const noop = () => {}

const SETTINGS = { transcribeModel: 'large-v3', transcribeModelHistory: ['large-v3'], transcribeLang: 'auto' }
const choiceWith = (installed: readonly string[] | undefined, language = 'auto') => (
  transcribeChoice(installed && fixtureModels(installed), { ...SETTINGS, transcribeLang: language }, NOTHING_PICKED)
)

const meta: Meta<typeof ImportDialog> = {
  title: 'Screens/Home/Import files',
  component: ImportDialog,
  args: {
    open: true,
    preview: true,
    files: [],
    title: '',
    defaultTitle: '5 Oct 14:30 Meeting',
    onTitleChange: noop,
    choice: choiceWith(DEFAULT_INSTALLED),
    onModelChange: noop,
    onLanguageChange: noop,
    failure: null,
    importing: false,
    onChooseFiles: noop,
    onRemove: noop,
    onImport: noop,
    onClose: noop,
  } satisfies ImportDialogProps,
}
export default meta

type Story = StoryObj<typeof ImportDialog>

const FILES = [
  { name: 'Weekly product sync.m4a', path: '/Users/me/Recordings/Weekly product sync.m4a' },
  { name: 'Customer call, Acme.mp3', path: '/Users/me/Recordings/Customer call, Acme.mp3' },
  { name: 'A very long name of a recording made at the offsite planning session in September.wav', path: '/Users/me/offsite.wav' },
]

export const Empty: Story = {}
// Files are over the zone. Over the rest of the window the zone stays as it is.
export const FilesOverZone: Story = { args: { over: true } }
export const WithFiles: Story = { args: { files: FILES } }
export const FilesOverZoneWithList: Story = { args: { files: FILES, over: true } }
export const OneFileWithTitle: Story = { args: { files: FILES.slice(0, 1), title: 'Weekly sync, 5 October' } }
// Until GET /models answers the model waits and Import is off.
export const CheckingModels: Story = { args: { files: FILES, choice: choiceWith(undefined) } }
export const NoWhisperModel: Story = { args: { files: FILES, choice: choiceWith(['diarize']) } }
export const NoDiarizationModel: Story = { args: { files: FILES, choice: choiceWith(['small']) } }
// The default language needs an alignment model that is not downloaded.
export const NoAlignmentModel: Story = { args: { files: FILES, choice: choiceWith(DEFAULT_INSTALLED, 'ru') } }
export const Importing: Story = { args: { files: FILES, importing: true } }
export const MissingModels: Story = { args: { files: FILES, failure: { message: NO_MODELS, code: 'whisper_model_missing', settingsSection: 'models' } } }
export const FileNotReadable: Story = {
  args: { files: FILES.slice(1), failure: { message: '"Customer call, Acme.mp3" could not be read.', code: 'audio_not_readable', settingsSection: null } },
}
export const BackendNotResponding: Story = { args: { files: FILES, failure: { message: 'The backend is not responding.', code: null, settingsSection: null } } }
// With the scrim, focus trap and the way in, as in the app.
export const Open: Story = { args: { files: FILES, preview: false } }

