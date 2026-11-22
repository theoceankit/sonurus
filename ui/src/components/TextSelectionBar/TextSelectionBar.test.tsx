import { render, screen } from '@testing-library/react'
import { describe, expect, test } from 'vitest'
import { TextSelectionBar } from './TextSelectionBar'

describe('TextSelectionBar', () => {
  test('without a note to quote into there is no Quote', () => {
    render(<TextSelectionBar onCopy={() => {}} />)
    expect(screen.getByRole('button', { name: 'Copy' })).toBeTruthy()
    expect(screen.queryByRole('button', { name: 'Quote' })).toBeNull()
  })

  test('with one, it stands between Copy and Highlight', () => {
    render(<TextSelectionBar onCopy={() => {}} onQuote={() => {}} />)
    expect(screen.getAllByRole('button').map(button => button.textContent!.trim())).toEqual(['Copy', 'Quote', 'Highlight'])
  })
})
