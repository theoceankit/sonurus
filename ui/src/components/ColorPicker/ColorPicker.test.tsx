import { render, screen, waitFor } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { useState } from 'react'
import { expect, test, vi } from 'vitest'
import type { SpeakerColor } from '../../styles/speaker-colors'
import { ColorPicker } from './ColorPicker'

function Picker({ initial = 1, onChange }: { initial?: SpeakerColor; onChange?: (color: SpeakerColor) => void }) {
  const [value, setValue] = useState<SpeakerColor>(initial)
  return (
    <ColorPicker
      label="Colour"
      value={value}
      onValueChange={color => {
        setValue(color)
        onChange?.(color)
      }}
    />
  )
}

const checked = () => screen.getAllByRole('radio').filter(radio => radio.getAttribute('aria-checked') === 'true')

test('a named group of six colours with exactly one chosen', () => {
  render(<Picker initial={3} />)
  expect(screen.getByRole('radiogroup', { name: 'Colour' })).toBeTruthy()
  expect(screen.getAllByRole('radio')).toHaveLength(6)
  expect(checked().map(radio => radio.getAttribute('aria-label'))).toEqual(['Lilac'])
})

test('Tab enters at the chosen colour and leaves the group at once', async () => {
  render(<><Picker initial={3} /><button>After</button></>)
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Lilac' }))
  await userEvent.tab()
  expect(document.activeElement).toBe(screen.getByText('After'))
})

// Radix moves focus a tick after the key goes down and chooses on that focus
// while the key is still held, so the key has to stay down as it does by hand.
const press = async (key: string, expected: SpeakerColor, onChange: ReturnType<typeof vi.fn>) => {
  await userEvent.keyboard(`{${key}>}`)
  await waitFor(() => expect(onChange).toHaveBeenLastCalledWith(expected))
  await userEvent.keyboard(`{/${key}}`)
}

test('arrow keys move the choice and wrap around', async () => {
  const onChange = vi.fn()
  render(<Picker initial={1} onChange={onChange} />)
  await userEvent.tab()

  await press('ArrowRight', 2, onChange)
  expect(document.activeElement).toBe(screen.getByRole('radio', { name: 'Teal' }))
  expect(checked()).toHaveLength(1)

  await press('ArrowLeft', 1, onChange)
  await press('ArrowLeft', 6, onChange)
  expect(checked().map(radio => radio.getAttribute('aria-label'))).toEqual(['Gray'])
})

test('a click chooses', async () => {
  const onChange = vi.fn()
  render(<Picker onChange={onChange} />)
  await userEvent.click(screen.getByRole('radio', { name: 'Rose' }))
  expect(onChange).toHaveBeenCalledWith(5)
})

test('without a label there is no caption and aria-label names the group', () => {
  render(<ColorPicker aria-label="Speaker colour" value={1} onValueChange={() => {}} />)
  expect(screen.getByRole('radiogroup', { name: 'Speaker colour' })).toBeTruthy()
})

test('disabled does not change', async () => {
  const onValueChange = vi.fn()
  render(<ColorPicker label="Colour" value={1} onValueChange={onValueChange} disabled />)
  await userEvent.click(screen.getByRole('radio', { name: 'Rose' }))
  expect(onValueChange).not.toHaveBeenCalled()
})
