import type { Meta, StoryObj } from '@storybook/react-vite'
import { NewSpeakerModal } from './NewSpeakerModal'

const meta: Meta<typeof NewSpeakerModal> = {
  component: NewSpeakerModal,
  args: { initialName: 'Olivia Brown', initialColorIndex: 2, suggestedHandle: 'olivia.brown', onCreate: async () => {}, onBack: () => {}, onClose: () => {}, preview: true },
}
export default meta

type Story = StoryObj<typeof NewSpeakerModal>

export const Default: Story = {}
export const EmptyName: Story = { args: { initialName: '' } }
export const RepeatedName: Story = { args: { isNameTaken: () => true, suggestedHandle: 'olivia.brown2' } }
export const TypedHandle: Story = { args: { initialHandle: 'liv' } }
export const TakenHandle: Story = { args: { initialHandle: 'olivia.brown', checkHandle: () => '@olivia.brown is taken by Olivia Brown.' } }
export const EmptiedHandle: Story = { args: { initialHandle: '' } }
export const Failed: Story = { args: { initialError: 'Server error 500' } }
export const LongName: Story = { args: { initialName: 'Alexandra Konstantinopolskaya-Vandenberghe of the Very Long Name' } }
export const Open: Story = { args: { preview: false } }
