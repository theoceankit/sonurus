import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { IconButton, type IconButtonProps } from './IconButton'

const meta: Meta<typeof IconButton> = {
  component: IconButton,
  args: { icon: 'add', label: 'Add', variant: 'ghost', size: 'small' },
}
export default meta

type Story = StoryObj<typeof IconButton>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] as const

const row = (label: string, props: Partial<IconButtonProps>) => ({
  label,
  render: (state: (typeof STATES)[number]) => {
    const forState = { icon: 'add', label: 'Add', ...props, disabled: state === 'Disabled' }
    return <IconButton {...(forState as IconButtonProps)} />
  },
})

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        row('Ghost XS', { size: 'xs' }),
        row('Ghost XS Selected', { size: 'xs', selected: true }),
        row('Ghost Small', { size: 'small' }),
        row('Ghost Small Selected', { size: 'small', selected: true }),
        row('Ghost Medium', { size: 'medium' }),
        row('Ghost Medium Selected', { size: 'medium', selected: true }),
        row('Secondary Small', { variant: 'secondary', size: 'small' }),
        row('Secondary Medium', { variant: 'secondary', size: 'medium' }),
        row('Primary XS', { variant: 'primary', size: 'xs' }),
        row('Primary Small', { variant: 'primary', size: 'small' }),
        row('Inverse Large', { variant: 'inverse', size: 'large' }),
      ]}
    />
  ),
}

export const Example: Story = {}
