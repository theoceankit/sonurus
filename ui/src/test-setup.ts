import { cleanup } from '@testing-library/react'
import { afterEach } from 'vitest'
import { resetMemorySettings } from './platform/settings'

afterEach(cleanup)
afterEach(resetMemorySettings)

// Radix menus and tooltips measure and scroll; jsdom has none of this.
class NoResizeObserver {
  observe() {}
  unobserve() {}
  disconnect() {}
}
globalThis.ResizeObserver ??= NoResizeObserver
Element.prototype.hasPointerCapture ??= () => false
Element.prototype.releasePointerCapture ??= () => {}
Element.prototype.scrollIntoView ??= () => {}
Range.prototype.getBoundingClientRect ??= () => new DOMRect()
Range.prototype.getClientRects ??= () => [] as unknown as DOMRectList

// Nor does it play media or keep blobs.
HTMLMediaElement.prototype.load = () => {}
HTMLMediaElement.prototype.pause = () => {}
HTMLMediaElement.prototype.play = async () => {}
URL.createObjectURL ??= () => 'blob:test'
