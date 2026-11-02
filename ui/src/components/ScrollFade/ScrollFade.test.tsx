import { fireEvent, render, screen, waitFor } from '@testing-library/react'
import { expect, test, vi } from 'vitest'
import { ScrollFade, useScrollEdges } from './ScrollFade'
import css from './ScrollFade.module.css?raw'

let renders = 0

function Area() {
  const { scrollRef, top, bottom } = useScrollEdges()
  renders++
  return (
    <div>
      <div ref={scrollRef} data-testid="area"><p>Row</p></div>
      <output>{`${top} ${bottom}`}</output>
    </div>
  )
}

const measure = (area: HTMLElement, { scrollTop, scrollHeight, clientHeight }: Record<string, number>) => {
  Object.defineProperties(area, {
    scrollHeight: { configurable: true, value: scrollHeight },
    clientHeight: { configurable: true, value: clientHeight },
  })
  area.scrollTop = scrollTop
}
const scrollTo = (area: HTMLElement, scrollTop: number) => {
  area.scrollTop = scrollTop
  fireEvent.scroll(area)
}
const edges = () => screen.getByRole('status').textContent

const setUp = (scrollHeight = 1000, clientHeight = 200) => {
  const view = render(<Area />)
  const area = screen.getByTestId('area')
  measure(area, { scrollTop: 0, scrollHeight, clientHeight })
  fireEvent.scroll(area)
  return { ...view, area }
}

test('at the start only the bottom has more', () => {
  setUp()
  expect(edges()).toBe('false true')
})

test('in the middle both have more', () => {
  const { area } = setUp()
  scrollTo(area, 400)
  expect(edges()).toBe('true true')
})

test('at the end only the top has more, a pixel of rounding included', () => {
  const { area } = setUp()
  scrollTo(area, 799.5)
  expect(edges()).toBe('true false')
})

test('content that fits has no fades', () => {
  setUp(200, 200)
  expect(edges()).toBe('false false')
})

test('scrolling without crossing an edge does not re-render', () => {
  const { area } = setUp()
  scrollTo(area, 100)
  scrollTo(area, 150) // React may render once more before it bails out.
  const before = renders
  for (const y of [200, 300, 400, 500]) scrollTo(area, y)
  expect(renders).toBe(before)
})

test('a new row is noticed without a scroll', async () => {
  const { area } = setUp(200, 200)
  expect(edges()).toBe('false false')
  measure(area, { scrollTop: 0, scrollHeight: 400, clientHeight: 200 })
  area.append(document.createElement('p'))
  await waitFor(() => expect(edges()).toBe('false true'))
})

test('it listens no more after unmounting', () => {
  const { area, unmount } = setUp()
  const remove = vi.spyOn(area, 'removeEventListener')
  unmount()
  expect(remove).toHaveBeenCalledWith('scroll', expect.any(Function))
})

test('the fade takes no clicks and is hidden from assistive technology', () => {
  render(<ScrollFade edge="bottom" data-testid="fade" />)
  expect(screen.getByTestId('fade').getAttribute('aria-hidden')).toBe('true')
  expect(css).toMatch(/\.scrollFade \{[^}]*pointer-events: none/)
})

test.each([
  ['top', 'window', 'md'],
  ['bottom', 'raised', 'lg'],
  ['bottom', 'sunken', 'md'],
] as const)('%s %s %s picks its classes', (edge, surface, size) => {
  render(<ScrollFade edge={edge} surface={surface} size={size} data-testid="fade" />)
  const { className } = screen.getByTestId('fade')
  for (const name of [edge, surface, size]) expect(className).toContain(name)
})

test('each surface fades from its token', () => {
  expect(css).toMatch(/\.window \{\s*--scroll-fade-surface: var\(--color-bg-window\)/)
  expect(css).toMatch(/\.raised \{\s*--scroll-fade-surface: var\(--color-bg-raised\)/)
  expect(css).toMatch(/\.sunken \{\s*--scroll-fade-surface: var\(--color-bg-sunken\)/)
})
