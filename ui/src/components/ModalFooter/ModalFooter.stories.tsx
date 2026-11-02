import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Button } from '../Button/Button'
import { Modal, type ModalType } from '../Modal/Modal'
import { Stack } from '../Stack/Stack'
import { ModalFooter } from './ModalFooter'

const meta: Meta<typeof ModalFooter> = { component: ModalFooter }
export default meta

type Story = StoryObj<typeof ModalFooter>

const confirmOf = (type: ModalType) => ({ children: type === 'danger' ? 'Delete' : 'Confirm' })
const footer = (type: ModalType, leading: boolean) => (
  <Modal preview type={type}>
    <ModalFooter leading={leading ? <Button variant="ghost" icon="add">Action</Button> : undefined} confirm={confirmOf(type)} />
  </Modal>
)

// Rows and columns as on the board.
export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={['Default', 'Danger'] as const}
      rows={[
        { label: 'Leading Off', render: type => footer(type.toLowerCase() as ModalType, false) },
        { label: 'Leading On', render: type => footer(type.toLowerCase() as ModalType, true) },
      ]}
    />
  ),
}

export const OtherActions: Story = {
  render: () => (
    <Stack gap={4}>
      <Modal preview>
        <ModalFooter cancel={{ children: 'Back', icon: 'arrow-left', onClick: () => {} }} confirm={{ children: 'Create and assign' }} />
      </Modal>
      <Modal preview><ModalFooter confirm={{ children: 'Assign', disabled: true }} /></Modal>
      <Modal preview><ModalFooter confirm={{ children: 'Saving', loading: true }} /></Modal>
      <Modal preview type="danger"><ModalFooter confirm={{ children: 'Deleting', loading: true }} /></Modal>
      <Modal preview><ModalFooter cancel={null} confirm={{ children: 'Close' }} /></Modal>
    </Stack>
  ),
}
