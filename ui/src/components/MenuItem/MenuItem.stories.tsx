import type { Meta, StoryObj } from '@storybook/react-vite'
import { StateMatrix } from '../../foundations/StateMatrix'
import { MenuItem, type MenuItemProps } from './MenuItem'

const meta: Meta<typeof MenuItem> = {
  component: MenuItem,
  args: { children: 'Menu item' },
}
export default meta

type Story = StoryObj<typeof MenuItem>

const STATES = ['Default', 'Hover', 'Pressed', 'Focus', 'Disabled'] as const

const row = (label: string, props: Partial<MenuItemProps>) => ({
  label,
  render: (state: (typeof STATES)[number]) => (
    <MenuItem {...(props as MenuItemProps)} disabled={state === 'Disabled'}>Menu item</MenuItem>
  ),
})

export const Matrix: Story = {
  render: () => (
    <StateMatrix
      states={STATES}
      wideCells
      rows={[
        row('None', {}),
        row('None Selected', { selected: true }),
        row('Icon', { icon: 'speakers' }),
        row('Icon Selected', { icon: 'speakers', selected: true }),
        row('None Current', { current: true }),
        row('Icon Current', { icon: 'speakers', current: true }),
        row('Meta', { icon: 'speakers', meta: 'Meta', meta2: 'Meta 2' }),
      ]}
    />
  ),
}

export const Example: Story = { args: { icon: 'settings', children: 'Settings' } }
