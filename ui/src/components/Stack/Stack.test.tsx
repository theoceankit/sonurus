import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, test } from 'vitest'
import { Stack } from './Stack'

const rendered = (element: React.ReactElement) => render(element).container.firstElementChild as HTMLElement

test('renders a div with its children by default', () => {
  render(<Stack>Text</Stack>)
  expect(screen.getByText('Text').tagName).toBe('DIV')
})

test.each([['half'], [1], [2], [3], [4], [5], [6], [8]] as const)('gap %s comes from the scale', step => {
  expect(rendered(<Stack gap={step} />).style.gap).toBe(`var(--space-${step})`)
})

test('padding sets both axes, and an axis overrides it', () => {
  const both = rendered(<Stack padding={2} />).style
  expect(both.paddingBlock).toBe('var(--space-2)')
  expect(both.paddingInline).toBe('var(--space-2)')

  const axis = rendered(<Stack padding={2} paddingX={4} />).style
  expect(axis.paddingBlock).toBe('var(--space-2)')
  expect(axis.paddingInline).toBe('var(--space-4)')
})

test('sets no spacing unless asked', () => {
  const { style } = rendered(<Stack />)
  expect(style.gap).toBe('')
  expect(style.paddingBlock).toBe('')
})

test('maps alignment to flex values', () => {
  const { style } = rendered(<Stack align="center" justify="between" />)
  expect(style.alignItems).toBe('center')
  expect(style.justifyContent).toBe('space-between')
})

test('takes another element, a class, a ref and other props', () => {
  const ref = createRef<HTMLElement>()
  render(<Stack as="section" ref={ref} className="mine" aria-label="Group" />)
  const element = screen.getByRole('region', { name: 'Group' })
  expect(element.tagName).toBe('SECTION')
  expect(element.className).toContain('mine')
  expect(element.className).toContain('stack')
  expect(ref.current).toBe(element)
})
