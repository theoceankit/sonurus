// Which system the window runs on, as far as the keys go: macOS has its own.
export type Os = 'mac' | 'other'

export const currentOs = (): Os => (/mac/i.test(navigator.platform) ? 'mac' : 'other')
