import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Toggle } from '../Toggle/Toggle'
import { FieldRow } from './FieldRow'

test('a group named by its label and described by its hint, the control in it', () => {
  render(<FieldRow label="Duplicate on export" hint="Keeps the original."><Toggle label="Duplicate on export" checked /></FieldRow>)
  const group = screen.getByRole('group', { name: 'Duplicate on export' })
  expect(screen.getByRole('group', { description: 'Keeps the original.' })).toBe(group)
  expect(group.contains(screen.getByRole('switch'))).toBe(true)
})

test('no description without a hint, the note under the row', () => {
  render(<FieldRow label="Language" note="Model missing"><span>control</span></FieldRow>)
  expect(screen.getByRole('group').getAttribute('aria-describedby')).toBeNull()
  expect(screen.getByText('Model missing')).toBeTruthy()
})
