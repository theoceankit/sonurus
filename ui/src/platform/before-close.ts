import { useEffect } from 'react'

type Task = () => Promise<void>

const tasks = new Set<Task>()

// What must be done before the window goes, such as saving a note typed a moment
// ago. Returns what takes it back.
export function onBeforeClose(task: Task): () => void {
  tasks.add(task)
  return () => { tasks.delete(task) }
}

// Every task, together; a failed one does not hold up the rest.
export async function runBeforeClose(): Promise<void> {
  await Promise.allSettled([...tasks].map(task => task()))
}

// The main process asks before it closes the window or quits (electron/window-closing.js);
// a reload or a page left in the browser gets the same, without waiting.
export function useBeforeCloseBridge() {
  useEffect(() => {
    const bridge = typeof window === 'undefined' ? undefined : window.electronAPI
    const stop = bridge?.onWindowClosing?.(runBeforeClose)
    const onPageHide = () => { void runBeforeClose() }
    window.addEventListener('pagehide', onPageHide)
    return () => {
      stop?.()
      window.removeEventListener('pagehide', onPageHide)
    }
  }, [])
}
