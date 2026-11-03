import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Collapse } from './Collapse'

test('shows its content only while open', () => {
  const { rerender } = render(<Collapse open={false}><span>Oliver</span></Collapse>)
  expect(screen.queryByText('Oliver')).toBeNull()
  rerender(<Collapse open><span>Oliver</span></Collapse>)
  expect(screen.getByText('Oliver')).toBeTruthy()
  rerender(<Collapse open={false}><span>Oliver</span></Collapse>)
  expect(screen.queryByText('Oliver')).toBeNull()
})
