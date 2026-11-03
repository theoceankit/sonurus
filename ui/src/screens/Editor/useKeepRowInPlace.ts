import { useCallback, useLayoutEffect, useRef } from 'react'

// When a speaker changes, a turn header comes or goes above a paragraph. The list
// scrolls by as much, so the paragraph stays where the eye is. Returns the function
// that names the row; a row out of sight or gone is left alone.
export function useKeepRowInPlace(area: HTMLElement | null, version: unknown) {
  const anchor = useRef<number | null>(null)
  const seen = useRef(version)
  const before = useRef<number | null>(null)

  const rowTop = () => {
    if (!area || anchor.current === null) return null
    return area.querySelector(`[data-segment-start="${anchor.current}"]`)?.getBoundingClientRect().top ?? null
  }

  // The render is the last moment the old layout can be read.
  if (seen.current !== version) {
    seen.current = version
    const top = rowTop()
    const bounds = area?.getBoundingClientRect()
    before.current = top !== null && bounds && top >= bounds.top && top < bounds.bottom ? top : null
  }

  useLayoutEffect(() => {
    const top = before.current
    if (top === null || !area) return
    before.current = null
    const settle = () => {
      const now = rowTop()
      if (now !== null) area.scrollTop += now - top
    }
    settle()
    // A new turn has its real height only once the browser has decided to draw it.
    const frame = requestAnimationFrame(settle)
    return () => cancelAnimationFrame(frame)
  }, [version])

  return useCallback((start: number) => { anchor.current = start }, [])
}
