import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Badge } from './Badge'

test('a label is neutral by default', () => {
  render(<Badge>Interview</Badge>)
  expect(screen.getByText('Interview').className).toMatch(/\blabel\b/)
  expect(screen.getByText('Interview').className).toMatch(/\bneutral\b/)
})

test.each(['accent', 'success', 'warning', 'danger', 'onAccent'] as const)('tone %s becomes a class', tone => {
  render(<Badge tone={tone}>Text</Badge>)
  expect(screen.getByText('Text').className).toMatch(new RegExp(`\\b${tone}\\b`))
})

test('a count shows also 0', () => {
  render(<Badge variant="count">{0}</Badge>)
  expect(screen.getByText('0').className).toMatch(/\bcount\b/)
})

test('a count in a tone it does not have is a type error', () => {
  // @ts-expect-error count is only neutral or on-accent
  const wrong = () => <Badge variant="count" tone="danger">1</Badge>
  expect(wrong).toBeTypeOf('function')
})
