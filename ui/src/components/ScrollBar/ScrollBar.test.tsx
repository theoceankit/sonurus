import { act, fireEvent, render, screen } from '@testing-library/react'
import { expect, test } from 'vitest'
import baseCss from '../../styles/base.css?raw'
import { ScrollBar } from './ScrollBar'

const area = (scrollHeight: number, clientHeight = 200) => {
  const node = document.createElement('div')
  Object.defineProperty(node, 'scrollHeight', { value: scrollHeight, configurable: true })
  Object.defineProperty(node, 'clientHeight', { value: clientHeight, configurable: true })
  Object.defineProperty(node, 'offsetHeight', { value: clientHeight, configurable: true })
  return node
}

const thumb = () => screen.queryByTestId('scroll-thumb')

test('nothing to scroll, no bar', () => {
  render(<ScrollBar area={area(200)} />)
  expect(thumb()).toBeNull()
})

test('the thumb is as long as the visible share and follows the scroll', () => {
  const node = area(1000)
  render(<ScrollBar area={node} />)
  expect(thumb()!.style.height).toBe('40px')
  expect(thumb()!.style.transform).toBe('translateY(0px)')
  node.scrollTop = 800
  act(() => { fireEvent.scroll(node) })
  expect(thumb()!.style.transform).toBe('translateY(160px)')
})

test('a very long area keeps a thumb that can be caught', () => {
  render(<ScrollBar area={area(100000)} />)
  expect(thumb()!.style.height).toBe('24px')
})

test('dragging the thumb scrolls the area', () => {
  const node = area(1000)
  render(<ScrollBar area={node} />)
  fireEvent.pointerDown(thumb()!, { clientY: 10, pointerId: 1 })
  fireEvent.pointerMove(thumb()!, { clientY: 50, pointerId: 1 })
  expect(node.scrollTop).toBe(200)
  fireEvent.pointerUp(thumb()!, { pointerId: 1 })
  fireEvent.pointerMove(thumb()!, { clientY: 90, pointerId: 1 })
  expect(node.scrollTop).toBe(200)
})

test('it says when the area is scrolling, so the bar shows without a pointer', () => {
  const node = area(1000)
  render(<ScrollBar area={node} />)
  const bar = thumb()!.parentElement!
  expect(bar.dataset.scrolling).toBeUndefined()
  act(() => { fireEvent.scroll(node) })
  expect(bar.dataset.scrolling).toBe('')
})

test('the system bar with its arrows is off everywhere', () => {
  expect(baseCss).toMatch(/\* \{\s*scrollbar-width: none;/)
})
