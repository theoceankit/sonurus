import type { Meta, StoryObj } from '@storybook/react-vite'
import { useApi } from '../../api/ApiProvider'
import { EVENT_SCRIPTS } from '../../api/fixtures/event-scripts'
import type { FixtureClient } from '../../api/fixtures/fixture-client'
import { useQueueEventsSync } from '../../api/queries'
import { Button } from '../../components/Button/Button'
import { Stack } from '../../components/Stack/Stack'
import { AlignmentDialog, type AlignmentDialogProps } from './AlignmentDialog'
import { useAlignmentDialogs } from './useAlignmentDialogs'

const noop = () => {}

const meta: Meta<typeof AlignmentDialog> = {
  title: 'Screens/Queue/Alignment model dialog',
  component: AlignmentDialog,
  args: {
    open: true,
    preview: true,
    language: 'pt',
    state: 'offer',
    pct: 0,
    retryCount: 0,
    cancelling: false,
    onDownload: noop,
    onCancel: noop,
    onRetry: noop,
    onClose: noop,
  } satisfies AlignmentDialogProps,
}
export default meta

type Story = StoryObj<typeof AlignmentDialog>

export const Offer: Story = {}
export const Downloading: Story = { args: { state: 'downloading', pct: 42 } }
export const Cancelling: Story = { args: { state: 'downloading', pct: 42, cancelling: true } }
export const Ready: Story = { args: { state: 'ready', retryCount: 3 } }
export const ReadyWithOneJob: Story = { args: { state: 'ready', retryCount: 1 } }
// Nothing left to retry, such as after the jobs were deleted.
export const ReadyWithNothingToRetry: Story = { args: { state: 'ready' } }
export const DownloadFailed: Story = { args: { state: 'failed' } }
export const DownloadFailedOffline: Story = { args: { state: 'failed', failure: 'No connection to HuggingFace. Check the internet connection and try again.' } }

function Live() {
  const alignment = useAlignmentDialogs()
  useQueueEventsSync(alignment.onQueueEvent)
  const client = useApi() as FixtureClient
  return (
    <Stack gap={2} padding={4} align="start">
      <Button onClick={() => client.playEvents(EVENT_SCRIPTS.failed)}>Play a job failing on Portuguese</Button>
      {alignment.dialog && <AlignmentDialog key={alignment.dialog.language} {...alignment.dialog} />}
    </Stack>
  )
}

// A job fails on fixtures; Download goes up a quarter a step, then Retry puts it back.
export const InTheApp: Story = { render: () => <Live />, parameters: { api: { downloadStepMs: 600 } } }
export const InTheAppDownloadFails: Story = { render: () => <Live />, parameters: { api: { downloadStepMs: 400, downloadFails: true } } }
