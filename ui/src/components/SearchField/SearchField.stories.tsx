import type { Meta, StoryObj } from '@storybook/react-vite'
import { useState } from 'react'
import { StateMatrix } from '../../foundations/StateMatrix'
import { SearchField } from './SearchField'

const meta: Meta<typeof SearchField> = {
  component: SearchField,
  args: { value: '', placeholder: 'Search speakers', 'aria-label': 'Search speakers', onValueChange: () => {} },
}
export default meta

type Story = StoryObj<typeof SearchField>

const STATES = ['Default', 'Hover', 'Focus', 'Disabled', 'Error'] as const
type State = (typeof STATES)[number]

const row = (label: string, props: object) => ({
  label,
  render: (state: State) => (
    <SearchField
      aria-label="Search speakers"
      placeholder="Search speakers"
      value=""
      onValueChange={() => {}}
      disabled={state === 'Disabled'}
      error={state === 'Error' ? 'Search failed, try again' : undefined}
      {...props}
    />
  ),
})

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      fields
      rows={[
        row('Placeholder', {}),
        row('Filled', { value: 'Anna' }),
        row('Shortcut', { shortcut: ['mod', 'K'] }),
      ]}
    />
  ),
}

function Live() {
  const [value, setValue] = useState('Anna')
  return <SearchField aria-label="Search speakers" placeholder="Search speakers" value={value} onValueChange={setValue} shortcut={['mod', 'K']} />
}

export const Example: Story = { render: () => <Live /> }
