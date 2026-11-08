import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, test } from 'vitest'
import { spacingStyle } from '../../styles/space'
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

test('paddingTop pads the start of the column only, such as a slot under a header', () => {
  const { style } = rendered(<Stack paddingX={2} paddingTop={3} />)
  expect(style.paddingBlockStart).toBe('var(--space-3)')
  expect(style.paddingBlock).toBe('')
  expect(style.paddingInline).toBe('var(--space-2)')
})

// jsdom does not expand logical shorthands, so the style object itself is checked:
// in a browser even an empty longhand clears its end of paddingBlock.
test('without paddingTop or paddingBottom there is no longhand to clear paddingY', () => {
  expect(spacingStyle({ paddingY: 4 })).not.toHaveProperty('paddingBlockStart')
  expect(spacingStyle({ paddingY: 4 })).not.toHaveProperty('paddingBlockEnd')
  expect(spacingStyle({ paddingY: 4, paddingTop: 2 }).paddingBlockStart).toBe('var(--space-2)')
  expect(spacingStyle({ paddingBottom: 3 }).paddingBlockEnd).toBe('var(--space-3)')
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
