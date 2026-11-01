import * as RadioGroup from '@radix-ui/react-radio-group'
import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { ColorSwatch } from './ColorSwatch'

const inGroup = (swatch: React.ReactNode, value = '1') => <RadioGroup.Root value={value}>{swatch}</RadioGroup.Root>

test('is a radio named by its label, drawn in its speaker colour', () => {
  render(inGroup(<ColorSwatch color={3} label="Lilac" />))
  const radio = screen.getByRole('radio', { name: 'Lilac' })
  expect((radio.firstElementChild as HTMLElement).style.background).toBe('var(--color-speaker-3-mid)')
})

test('says whether it is the chosen one', () => {
  render(inGroup(<><ColorSwatch color={1} label="Blue" /><ColorSwatch color={2} label="Teal" /></>))
  expect(screen.getByRole('radio', { name: 'Blue' }).getAttribute('aria-checked')).toBe('true')
  expect(screen.getByRole('radio', { name: 'Teal' }).getAttribute('aria-checked')).toBe('false')
})

test('can be disabled', () => {
  render(inGroup(<ColorSwatch color={1} label="Blue" disabled />))
  expect((screen.getByRole('radio') as HTMLButtonElement).disabled).toBe(true)
})
