import type { Meta, StoryObj } from '@storybook/react-vite'
import { Modal } from '../Modal/Modal'
import { Stack } from '../Stack/Stack'
import { ModalBody } from './ModalBody'

const meta: Meta<typeof ModalBody> = { component: ModalBody }
export default meta

type Story = StoryObj<typeof ModalBody>

export const Content: Story = {
  render: () => (
    <Stack gap={4}>
      <Modal preview><ModalBody>Modal content</ModalBody></Modal>
      <Modal preview><ModalBody><span>First block</span><span>Second block, the gap comes from the body</span></ModalBody></Modal>
    </Stack>
  ),
}
