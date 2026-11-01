import type { Meta, StoryObj } from '@storybook/react-vite'
import { Stack } from '../components/Stack/Stack'
import { parseTokens } from '../styles/tokens'
import css from '../styles/tokens.css?raw'
import styles from './foundations.module.css'

const { type } = parseTokens(css)
const values = new Map(type.map(t => [t.name, t.value]))

const meta: Meta = { title: 'Foundations/Typography' }
export default meta

type Story = StoryObj

// Weight, size and line height of a --font-* token, without the family.
const describe = (value: string) =>
  value.replace(/ var\(--type-family-sans\)/, '').replace(/var\((--[\w-]+)\)/g, (_, name) => values.get(name) ?? name)

export const Fonts: Story = {
  render: () => (
    <Stack gap={6} padding={4}>
      {type.filter(t => t.name.startsWith('--font-')).map(({ name, value }) => (
        <Stack key={name} gap={1}>
          <span className={styles.name}>{name}: {describe(value)}</span>
          <span style={{ font: `var(${name})` }}>The quick brown fox jumps over the lazy dog 0123456789</span>
        </Stack>
      ))}
    </Stack>
  ),
}
