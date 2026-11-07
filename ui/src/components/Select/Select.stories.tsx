import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { Modal } from '../Modal/Modal'
import { ModalBody } from '../ModalBody/ModalBody'
import { ModalFooter } from '../ModalFooter/ModalFooter'
import { ModalHeader } from '../ModalHeader/ModalHeader'
import { Stack } from '../Stack/Stack'
import { Select, type SelectOption } from './Select'

const MODELS: SelectOption[] = [
  { value: 'tiny', label: 'Whisper Tiny', meta: 'Not installed', disabled: true },
  { value: 'base', label: 'Whisper Base', meta: 'Not installed', disabled: true },
  { value: 'small', label: 'Whisper Small' },
  { value: 'medium', label: 'Whisper Medium', meta: 'Not installed', disabled: true },
  { value: 'large-v3', label: 'Whisper Large v3' },
]

const LANGUAGES: SelectOption[] = [
  'Detect automatically', 'English', 'Русский', 'Español', 'Deutsch', 'Français', 'Українська', '中文', '日本語',
  'Português', 'Polski', 'Čeština', 'Türkçe', 'Svenska',
].map((label, index) => ({ value: String(index), label }))

const meta: Meta<typeof Select> = {
  component: Select,
  args: { label: 'Model', value: 'small', options: MODELS, onValueChange: () => {} },
  decorators: [Story => <div style={{ width: 280 }}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof Select>

function Controlled(props: Partial<React.ComponentProps<typeof Select>>) {
  const [value, setValue] = useState(props.value ?? 'small')
  return <Select label="Model" options={MODELS} {...props} value={value} onValueChange={setValue} />
}

export const Default: Story = { render: () => <Controlled /> }

// Not installed models are in the list, off, with the reason.
export const DisabledOptions: Story = { render: () => <Controlled /> }

export const Placeholder: Story = { args: { value: '', options: [], placeholder: 'Checking models…' } }

export const Disabled: Story = { args: { disabled: true } }

export const LongList: Story = { render: () => <Controlled label="Language" options={LANGUAGES} value="0" /> }

// The list near the bottom of a window opens upwards or scrolls, and stays in the window.
export const AtTheBottomOfAModal: Story = {
  decorators: [Story => <Story />],
  render: () => {
    const Dialog = () => {
      const [model, setModel] = useState('small')
      const [language, setLanguage] = useState('0')
      return (
        <Modal size="medium" open>
          <ModalHeader title="New transcription" />
          <ModalBody>
            <Stack gap={3}>
              <div style={{ height: 120 }} />
              <Select label="Model" value={model} options={MODELS} onValueChange={setModel} />
              <Select label="Language" value={language} options={LANGUAGES} onValueChange={setLanguage} />
            </Stack>
          </ModalBody>
          <ModalFooter confirm={{ children: 'Import' }} />
        </Modal>
      )
    }
    return <Dialog />
  },
}
