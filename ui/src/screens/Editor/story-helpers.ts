import type { Playback, PlaybackState } from '../../media/playback'

// Playback standing where the boards show it, with no audio and no ticks.
export const standing = (state: Partial<PlaybackState> = {}): Playback => {
  const current: PlaybackState = { currentTime: 28, duration: 53, paused: false, rate: 1, volume: 1, status: 'ready', ...state }
  return {
    getState: () => current,
    subscribe: () => () => {},
    load: () => {},
    reload: () => {},
    toggle: () => {},
    seek: () => {},
    setRate: () => {},
    setVolume: () => {},
  }
}

export const waitFor = async (find: () => Element | null | undefined) => {
  for (let i = 0; i < 100; i++) {
    const found = find()
    if (found) return found as HTMLElement
    await new Promise(resolve => setTimeout(resolve, 20))
  }
  throw new Error('Not found')
}

export const paragraph = (canvas: HTMLElement, text: string) =>
  waitFor(() => [...canvas.querySelectorAll('[data-transcript-text]')].find(node => node.textContent!.includes(text)))
