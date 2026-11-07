import type { Meta, StoryObj } from '@storybook/react-vite'
import { NO_MODELS } from '../../api/fixtures/fixture-client'
import { ImportDialog, type ImportDialogProps } from './ImportDialog'

const noop = () => {}

const meta: Meta<typeof ImportDialog> = {
  title: 'Screens/Home/Import dialog',
  component: ImportDialog,
  args: {
    open: true,
    preview: true,
    files: [],
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
export const Importing: Story = { args: { files: FILES, importing: true } }
export const MissingModels: Story = { args: { files: FILES, failure: { message: NO_MODELS, missingModels: true } } }
export const FileNotReadable: Story = {
  args: { files: FILES.slice(1), failure: { message: 'audio_path not readable: /Users/me/Recordings/Customer call, Acme.mp3', missingModels: false } },
}
export const BackendNotResponding: Story = { args: { files: FILES, failure: { message: 'The backend is not responding.', missingModels: false } } }
// With the scrim, focus trap and the way in, as in the app.
export const Open: Story = { args: { files: FILES, preview: false } }
