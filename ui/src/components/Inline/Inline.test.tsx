import { render, screen } from '@testing-library/react'
import { createRef } from 'react'
import { expect, test } from 'vitest'
import { Inline } from './Inline'

const rendered = (element: React.ReactElement) => render(element).container.firstElementChild as HTMLElement

test('centres its children across the row by default', () => {
  expect(rendered(<Inline />).style.alignItems).toBe('center')
})

test.each([['half'], [1], [2], [3], [4], [5], [6], [8]] as const)('gap %s comes from the scale', step => {
  expect(rendered(<Inline gap={step} />).style.gap).toBe(`var(--space-${step})`)
})

test('padding sets both axes, and an axis overrides it', () => {
  const { style } = rendered(<Inline padding={2} paddingY={1} />)
  expect(style.paddingInline).toBe('var(--space-2)')
  expect(style.paddingBlock).toBe('var(--space-1)')
})

test('does not wrap unless asked', () => {
  expect(rendered(<Inline />).style.flexWrap).toBe('')
  expect(rendered(<Inline wrap />).style.flexWrap).toBe('wrap')
})

test('maps alignment to flex values', () => {
  const { style } = rendered(<Inline align="baseline" justify="end" />)
  expect(style.alignItems).toBe('baseline')
  expect(style.justifyContent).toBe('flex-end')
})

test('takes another element, a class, a ref and other props', () => {
  const ref = createRef<HTMLElement>()
  render(<Inline as="nav" ref={ref} className="mine" aria-label="Actions" />)
  const element = screen.getByRole('navigation', { name: 'Actions' })
  expect(element.className).toContain('mine')
  expect(ref.current).toBe(element)
})
