import type { Meta, StoryObj } from '@storybook/react-vite'
import { NewSpeakerModal } from './NewSpeakerModal'

const meta: Meta<typeof NewSpeakerModal> = {
  component: NewSpeakerModal,
  args: { initialName: 'Olivia Brown', initialColorIndex: 2, onCreate: async () => {}, onBack: () => {}, onClose: () => {}, preview: true },
}
export default meta

type Story = StoryObj<typeof NewSpeakerModal>

export const Default: Story = {}
export const OptionalDetails: Story = { args: { initialDetailsExpanded: true } }
export const EmptyName: Story = { args: { initialName: '' } }
export const RepeatedName: Story = { args: { isNameTaken: () => true } }
export const Failed: Story = { args: { initialError: 'Server error 500' } }
export const LongName: Story = { args: { initialName: 'Alexandra Konstantinopolskaya-Vandenberghe of the Very Long Name' } }
export const Open: Story = { args: { preview: false } }
