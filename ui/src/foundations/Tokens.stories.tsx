import type { Meta, StoryObj } from '@storybook/react-vite'
import type { ReactNode } from 'react'
import { Inline } from '../components/Inline/Inline'
import { Stack } from '../components/Stack/Stack'
import { parseTokens, type Token } from '../styles/tokens'
import css from '../styles/tokens.css?raw'
import styles from './foundations.module.css'

const tokens = parseTokens(css)
const THEMES = ['light', 'dark'] as const

const meta: Meta = { title: 'Foundations/Tokens' }
export default meta

type Story = StoryObj

const hueOf = (name: string) => name.slice(2).split('-')[0]
const groupBy = (list: Token[], key: (t: Token) => string) => {
  const groups = new Map<string, Token[]>()
  for (const token of list) groups.set(key(token), [...(groups.get(key(token)) ?? []), token])
  return [...groups]
}
const dark = new Map(tokens.dark.map(t => [t.name, t.value]))
const shortRef = (value: string) => value.replace(/var\(--([\w-]+)\)/g, '$1')

export const Palette: Story = {
  render: () => (
    <Stack gap={6} padding={4}>
      {groupBy(tokens.palette, t => hueOf(t.name)).map(([hue, list]) => (
        <Stack key={hue} gap={2}>
          <span className={styles.heading}>{hue}</span>
          <div className={styles.chips}>
            {list.map(({ name, value }) => (
              <Stack key={name} gap={1}>
                <div className={hue === 'white' ? styles.onInverse : undefined}>
                  <div className={styles.swatch} style={{ background: `var(${name})` }} />
                </div>
                <span className={styles.name}>{name}</span>
                <span className={styles.name}>{value}</span>
              </Stack>
            ))}
          </div>
        </Stack>
      ))}
    </Stack>
  ),
}

const groupOfColor = (t: Token) => t.name.split('-').slice(3, t.name.startsWith('--color-speaker') ? 5 : 4).join(' ')

export const SemanticColors: Story = {
  render: () => (
    <Stack gap={6} padding={4}>
      {groupBy(tokens.light.filter(t => t.name.startsWith('--color-')), groupOfColor).map(([group, list]) => (
        <Stack key={group} gap={2}>
          <span className={styles.heading}>{group}</span>
          {list.map(({ name, value }) => (
            <div key={name} className={styles.row}>
              <span className={styles.name}>{name}</span>
              {THEMES.map(theme => (
                <div key={theme} data-theme={theme} className={styles.themeCell}>
                  <div className={styles.swatch} style={{ background: `var(${name})` }} />
                  <span className={styles.name}>{shortRef(theme === 'light' ? value : dark.get(name)!)}</span>
                </div>
              ))}
            </div>
          ))}
        </Stack>
      ))}
    </Stack>
  ),
}

const scale = (prefix: string) => tokens.scale.filter(t => t.name.startsWith(prefix))

const Measures = ({ title, list, sample }: { title: string; list: Token[]; sample: (name: string) => ReactNode }) => (
  <Stack gap={2}>
    <span className={styles.heading}>{title}</span>
    {list.map(({ name, value }) => (
      <div key={name} className={styles.measureRow}>
        <span className={styles.name}>{name}</span>
        <span className={styles.name}>{value}</span>
        <div>{sample(name)}</div>
      </div>
    ))}
  </Stack>
)

export const Scale: Story = {
  render: () => (
    <Stack gap={6} padding={4}>
      <Measures title="Spacing" list={scale('--space-')} sample={name => (
        <div className={styles.bar} style={{ width: `var(${name})` }} />
      )} />
      <Measures title="Radius" list={scale('--radius-')} sample={name => (
        <div className={styles.square} style={{ width: 'var(--size-avatar-lg)', height: 'var(--size-avatar-lg)', borderRadius: `var(${name})` }} />
      )} />
      <Measures title="Border width" list={scale('--border-width-')} sample={name => (
        <div style={{ borderTop: `var(${name}) solid var(--color-text-primary)` }} />
      )} />
      <Measures title="Opacity" list={scale('--opacity-')} sample={name => (
        <div className={styles.bar} style={{ opacity: `var(${name})` }} />
      )} />
      <Measures title="Size" list={scale('--size-')} sample={name => (
        <div className={styles.square} style={{ width: `var(${name})`, height: `var(${name})` }} />
      )} />
    </Stack>
  ),
}

export const Shadows: Story = {
  render: () => (
    <Stack gap={6} padding={4}>
      {tokens.light.filter(t => t.name.startsWith('--shadow-')).map(({ name }) => (
        <Stack key={name} gap={2}>
          <span className={styles.heading}>{name}</span>
          <Inline gap={2} align="stretch">
            {THEMES.map(theme => (
              <div key={theme} data-theme={theme} className={styles.shadowCell} style={{ flex: 1 }}>
                <div className={styles.shadow} style={{ boxShadow: `var(${name})` }} />
              </div>
            ))}
          </Inline>
        </Stack>
      ))}
    </Stack>
  ),
}
