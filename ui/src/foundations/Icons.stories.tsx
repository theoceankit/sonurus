import type { Meta, StoryObj } from '@storybook/react-vite'
import { Icon, type IconSize } from '../components/Icon/Icon'
import { iconNames } from '../components/Icon/icon-names'
import { Inline } from '../components/Inline/Inline'
import { Stack } from '../components/Stack/Stack'
import styles from './foundations.module.css'

const meta: Meta = { title: 'Foundations/Icons' }
export default meta

type Story = StoryObj

const SIZES: IconSize[] = [12, 16, 20, 24]

export const All: Story = {
  render: () => (
    <div className={styles.iconGrid} style={{ padding: 'var(--space-4)' }}>
      {iconNames.map(name => (
        <Stack key={name} gap={1} className={styles.iconCell}>
          <span className={styles.name}>{name}</span>
          <Inline gap={3}>
            {SIZES.map(size => <Icon key={size} name={name} size={size} />)}
            {name === 'sparkle' && <Icon name={name} size={14} />}
          </Inline>
        </Stack>
      ))}
    </div>
  ),
}

export const MainSize: Story = {
  render: () => (
    <Inline gap={4} padding={4} wrap>
      {iconNames.map(name => <Icon key={name} name={name} label={name} />)}
    </Inline>
  ),
}
