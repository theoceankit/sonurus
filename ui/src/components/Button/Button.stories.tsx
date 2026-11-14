import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { Button, type ButtonProps } from './Button'

const meta: Meta<typeof Button> = {
  component: Button,
  args: { children: 'Button', variant: 'primary', size: 'medium' },
  argTypes: { variant: { control: 'select', options: ['primary', 'secondary', 'ghost', 'danger'] } },
}
export default meta

type Story = StoryObj<typeof Button>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled', 'Loading'] as const
type State = (typeof STATES)[number]

const row = (label: string, props: Partial<ButtonProps>, children = 'Button') => ({
  label,
  skip: props.variant === 'inverse' || props.variant === 'record' ? ['Loading' as State] : [],
  render: (state: State) => {
    const forState = { ...props, disabled: state === 'Disabled', loading: state === 'Loading' || undefined }
    return <Button {...(forState as ButtonProps)}>{children}</Button>
  },
})

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      rows={[
        row('Primary Small', { variant: 'primary', size: 'small' }),
        row('Primary Medium', { variant: 'primary', size: 'medium' }),
        row('Secondary Small', { variant: 'secondary', size: 'small' }),
        row('Secondary Medium', { variant: 'secondary', size: 'medium' }),
        row('Ghost Small', { variant: 'ghost', size: 'small' }),
        row('Ghost Medium', { variant: 'ghost', size: 'medium' }),
        row('Toolbar Small', { variant: 'toolbar' }),
        row('Danger Small', { variant: 'danger', size: 'small' }),
        row('Danger Medium', { variant: 'danger', size: 'medium' }),
        row('Inverse Small', { variant: 'inverse', icon: 'copy' }, 'Copy'),
        row('Record Small', { variant: 'record', timer: '0:42' }, 'Stop'),
      ]}
    />
  ),
}

export const Example: Story = {}
export const WithIcon: Story = { args: { icon: 'add', children: 'New recording' } }
// The spinner shows after --delay-busy, over the icon and the label, so the width stays.
export const Loading: Story = { args: { children: 'Import', loading: true } }
export const LoadingWithIcon: Story = { args: { icon: 'add', children: 'New recording', loading: true } }
