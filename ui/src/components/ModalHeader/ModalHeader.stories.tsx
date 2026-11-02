import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactElement } from 'react'
import { Modal } from '../Modal/Modal'
import { Stack } from '../Stack/Stack'
import { ModalHeader } from './ModalHeader'

const meta: Meta<typeof ModalHeader> = {
  component: ModalHeader,
  args: { title: 'Modal title' },
}
export default meta

type Story = StoryObj<typeof ModalHeader>

const inModal = (header: ReactElement) => <Modal preview>{header}</Modal>

export const Variants: Story = {
  render: () => (
    <Stack gap={4}>
      {inModal(<ModalHeader title="Modal title" />)}
      {inModal(<ModalHeader title="Modal title" description="Description" />)}
      {inModal(<ModalHeader title="Modal title" icon="alert" />)}
      {inModal(<ModalHeader title="Modal title" description="Description" icon="alert" />)}
      {inModal(<ModalHeader title="A very long title that does not fit on one line of the small window" description="And a description that is long as well, so that it needs two lines" />)}
    </Stack>
  ),
}
