import * as RadixToast from '@radix-ui/react-toast'
import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Button } from '../Button/Button'
import { Inline } from '../Inline/Inline'
import { toast } from './toast'
import { Toast } from './Toast'

const meta: Meta<typeof Toast> = { component: Toast }
export default meta

type Story = StoryObj<typeof Toast>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus'] as const

// A viewport of its own in each cell, so the forced states reach the toast.
const InPlace = ({ error, action }: { error?: boolean; action?: boolean }) => (
  <RadixToast.Provider>
    <Toast
      message={error ? 'Could not delete the speaker' : 'Transcript deleted'}
      type={error ? 'error' : 'default'}
      action={action ? { label: 'Undo', onClick: () => {} } : undefined}
      duration={Infinity}
    />
    <RadixToast.Viewport style={{ margin: 0, padding: 0, listStyle: 'none', outline: 'none' }} />
  </RadixToast.Provider>
)

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        { label: 'Default', render: () => <InPlace /> },
        { label: 'Default with action', render: () => <InPlace action /> },
        { label: 'Error', render: () => <InPlace error /> },
        { label: 'Error with action', render: () => <InPlace error action /> },
      ]}
    />
  ),
}

// Real toasts: stacked, on their timers, stopped by the pointer or by focus.
export const Live: Story = {
  render: () => (
    <Inline gap={2}>
      <Button onClick={() => toast({ message: 'Transcript deleted' })}>Default</Button>
      <Button onClick={() => toast({ message: 'Transcript deleted', action: { label: 'Undo', onClick: () => toast({ message: 'Restored' }) } })}>
        With Undo
      </Button>
      <Button onClick={() => toast({ message: 'Could not delete the speaker', type: 'error' })}>Error</Button>
      <Button onClick={() => toast({ message: 'Could not delete the speaker', type: 'error', action: { label: 'Open Settings', onClick: () => {} } })}>
        Error with action
      </Button>
    </Inline>
  ),
}
