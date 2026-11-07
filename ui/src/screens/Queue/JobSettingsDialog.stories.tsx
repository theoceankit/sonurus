import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { QUEUE_JOB, queueSnapshot } from '../../api/fixtures/data'
import type { FixtureClient } from '../../api/fixtures/fixture-client'
import { DEFAULT_INSTALLED, fixtureModels } from '../../api/fixtures/models'
import { Button } from '../../components/Button/Button'
import { Stack } from '../../components/Stack/Stack'
import { NOTHING_PICKED, transcribeChoice } from '../../transcribe/choice'
import type { QueueJob } from '../../api/types'
import { EditJobDialog } from './EditJobDialog'
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

const JOB: QueueJob = { ...QUEUE_JOB, title: 'Weekly product sync', whisper_model: 'small', language: null, status: 'waiting' }

// Until the queue has its cards, a button opens it on the fixtures' queue.
function Live() {
  const [job, setJob] = useState<QueueJob | null>(null)
  const client = useApi() as FixtureClient
  const edit = () => {
    client.playEvents({ steps: [{ afterMs: 0, event: queueSnapshot({ jobs: [JOB] }) }] })
    setJob(JOB)
  }
  return (
    <Stack gap={2} padding={4} align="start">
      <Button onClick={edit}>Edit a waiting job</Button>
      <EditJobDialog job={job} onClose={() => setJob(null)} />
    </Stack>
  )
}

export const InTheApp: Story = { render: () => <Live /> }
