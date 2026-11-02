import { render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import { Playhead } from './Playhead'

test('stands at its share of the waveform', () => {
  const { container } = render(<Playhead position={0.25} />)
  expect((container.firstElementChild as HTMLElement).style.left).toBe('25%')
})

test('the default look has no bubble', () => {
  render(<Playhead position={0} time="00:35" name="Anna" />)
  expect(screen.queryByText('00:35')).toBeNull()
})

test('the hover look shows the time and the name', () => {
  render(<Playhead look="hover" position={0} time="00:35" name="Anna Petrova" />)
  expect(screen.getByText('00:35')).toBeTruthy()
  expect(screen.getByText('Anna Petrova')).toBeTruthy()
})
