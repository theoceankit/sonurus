import { renderHook } from '@testing-library/react'
import { describe, expect, test, vi } from 'vitest'
import { createMockElectronAPI } from './electron-api-mock'
import { onBeforeClose, runBeforeClose, useBeforeCloseBridge } from './before-close'

describe('before the window closes', () => {
  test('every task runs and is waited for; a failed one does not stop the rest', async () => {
    const done: string[] = []
    const stopA = onBeforeClose(async () => { throw new Error('no') })
    const stopB = onBeforeClose(async () => { await new Promise(resolve => setTimeout(resolve, 5)); done.push('b') })
    await runBeforeClose()
    expect(done).toEqual(['b'])
    stopA()
    stopB()
    await runBeforeClose()
    expect(done).toEqual(['b'])
  })

  test('the bridge answers the main process and a hidden page', async () => {
    let asked: (() => Promise<void>) | undefined
    const stopListening = vi.fn()
    window.electronAPI = createMockElectronAPI({ onWindowClosing: callback => { asked = callback; return stopListening } })
    const task = vi.fn(async () => {})
    const stop = onBeforeClose(task)
    const { unmount } = renderHook(() => useBeforeCloseBridge())
    await asked!()
    expect(task).toHaveBeenCalledTimes(1)
    window.dispatchEvent(new Event('pagehide'))
    expect(task).toHaveBeenCalledTimes(2)
    unmount()
    expect(stopListening).toHaveBeenCalled()
    stop()
  })
})
