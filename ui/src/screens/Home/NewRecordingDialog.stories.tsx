import type { Meta, StoryObj } from '@storybook/react-vite'
import { FIXTURE_CAPTURE_SOURCES } from '../../api/fixtures/fixture-client'
import { DEFAULT_INSTALLED, fixtureModels } from '../../api/fixtures/models'
import { NOTHING_PICKED, transcribeChoice } from '../../transcribe/choice'
import { BOTH_OFF, DEFAULT_MIC, NO_SYSTEM_AUDIO, micOptions, systemOptions } from '../../recording/sources'
import type { RecordingSetup } from '../../recording/useRecordingSetup'
import { NewRecordingDialog, type NewRecordingDialogProps } from './NewRecordingDialog'

const noop = () => {}

const SETTINGS = { transcribeModel: 'large-v3', transcribeModelHistory: ['large-v3'], transcribeLang: 'auto' }
const choiceWith = (installed: readonly string[] | undefined, language = 'auto') => (
  transcribeChoice(installed && fixtureModels(installed), { ...SETTINGS, transcribeLang: language }, NOTHING_PICKED)
)

const RECORD: RecordingSetup = {
  sources: { mic: true, system: true },
  onToggle: noop,
  micDevices: micOptions([{ kind: 'audioinput', deviceId: 'maono', label: 'Maono Dynamic Microphone' } as MediaDeviceInfo]),
  micDevice: DEFAULT_MIC,
  onMicDeviceChange: noop,
  systemDevices: systemOptions(FIXTURE_CAPTURE_SOURCES),
  systemDevice: FIXTURE_CAPTURE_SOURCES[0].id,
  onSystemDeviceChange: noop,
  recording: false,
  blocked: null,
}

const meta: Meta<typeof NewRecordingDialog> = {
  title: 'Screens/Home/New recording',
  component: NewRecordingDialog,
  args: {
    open: true,
    preview: true,
    title: '',
    defaultTitle: '5 Oct 14:30 Meeting',
    onTitleChange: noop,
    choice: choiceWith(DEFAULT_INSTALLED),
    onModelChange: noop,
    onLanguageChange: noop,
    record: RECORD,
    onStartRecording: noop,
    onImportFiles: noop,
    onClose: noop,
  } satisfies NewRecordingDialogProps,
}
export default meta

type Story = StoryObj<typeof NewRecordingDialog>

export const Default: Story = {}
export const WithTitle: Story = { args: { title: 'Weekly sync, 5 October' } }
export const MicrophoneOnly: Story = { args: { record: { ...RECORD, sources: { mic: true, system: false } } } }
// Start is off with nothing to record.
export const BothSourcesOff: Story = { args: { record: { ...RECORD, sources: { mic: false, system: false }, blocked: BOTH_OFF } } }
export const NoSystemAudio: Story = { args: { record: { ...RECORD, systemDevices: [], systemDevice: null, systemUnavailable: NO_SYSTEM_AUDIO } } }
// While a recording runs only Import files is left.
export const WhileRecording: Story = { args: { record: { ...RECORD, recording: true, blocked: 'A recording is already in progress' } } }
// Until GET /models answers the model waits and Start is off.
export const CheckingModels: Story = { args: { choice: choiceWith(undefined) } }
export const NoWhisperModel: Story = { args: { choice: choiceWith(['diarize']) } }
export const NoAlignmentModel: Story = { args: { choice: choiceWith(DEFAULT_INSTALLED, 'ru') } }
// With the scrim, focus trap and the way in, as in the app.
export const Open: Story = { args: { preview: false } }
