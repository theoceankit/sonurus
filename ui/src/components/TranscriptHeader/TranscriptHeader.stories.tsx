import type { Meta, StoryObj } from '@storybook/react-vite'
import { TranscriptHeader } from './TranscriptHeader'
import styles from './TranscriptHeader.stories.module.css'

const meta: Meta<typeof TranscriptHeader> = {
  component: TranscriptHeader,
  args: { title: 'Weekly product sync', date: '4 Oct 2026, 02:33', language: 'English', onCopy: () => {} },
  decorators: [Story => <div className={styles.panel}><Story /></div>],
}
export default meta

type Story = StoryObj<typeof TranscriptHeader>

export const Default: Story = {}
export const Sticky: Story = { args: { sticky: true } }
export const Renaming: Story = { args: { initialRenaming: true } }
export const NoLanguage: Story = { args: { language: undefined } }
export const LongTitle: Story = { args: { title: 'Quarterly planning with the whole product team, the partners from the Acme account and everyone else who could come' } }
export const LongTitleSticky: Story = { args: { ...LongTitle.args, sticky: true } }
// No speech in the recording: nothing to copy.
export const NothingToCopy: Story = { args: { onCopy: undefined } }
export const NothingToCopySticky: Story = { args: { onCopy: undefined, sticky: true } }
