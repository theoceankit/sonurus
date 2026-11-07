import { describe, expect, test } from 'vitest'
import {
  BOTH_OFF, DEFAULT_MIC, captureStartError, formatElapsed, micOptions, pickDevice, sourceSetting, sourcesOf, startBlockReason, systemOptions,
} from './sources'

describe('which sources a recording takes', () => {
  test('the setting turns into the two buttons and back', () => {
    expect(sourcesOf('both')).toEqual({ mic: true, system: true })
    expect(sourcesOf('mic')).toEqual({ mic: true, system: false })
    expect(sourcesOf('system')).toEqual({ mic: false, system: true })
    expect(sourceSetting({ mic: true, system: true })).toBe('both')
    expect(sourceSetting({ mic: true, system: false })).toBe('mic')
    expect(sourceSetting({ mic: false, system: true })).toBe('system')
    expect(sourceSetting({ mic: false, system: false })).toBeNull()
  })

  test('an unknown setting takes both, as the first run does', () => {
    expect(sourcesOf(undefined)).toEqual({ mic: true, system: true })
    expect(sourcesOf('loud' as never)).toEqual({ mic: true, system: true })
  })
})

describe('devices', () => {
  const input = (deviceId: string, label = '') => ({ kind: 'audioinput', deviceId, label }) as MediaDeviceInfo
  test('microphones: the default first, then each input; one without a label by its id', () => {
    expect(micOptions([input('a1b2c3d4e5', 'Maono'), { kind: 'audiooutput', deviceId: 'o', label: 'Speakers' } as MediaDeviceInfo, input('ffeeddccbb')])).toEqual([
      { value: DEFAULT_MIC, label: 'Default microphone' },
      { value: 'a1b2c3d4e5', label: 'Maono' },
      { value: 'ffeeddccbb', label: 'Microphone ffeedd' },
    ])
  })

  test('system audio comes from the backend as it is', () => {
    expect(systemOptions([{ id: 'bt', label: 'WH-1000XM5' }])).toEqual([{ value: 'bt', label: 'WH-1000XM5' }])
  })

  test('a saved device that is gone gives way to the first one; none saved is the first one', () => {
    const options = [{ value: DEFAULT_MIC, label: 'Default microphone' }, { value: 'x', label: 'X' }]
    expect(pickDevice('x', options)).toBe('x')
    expect(pickDevice('gone', options)).toBe(DEFAULT_MIC)
    expect(pickDevice(null, options)).toBe(DEFAULT_MIC)
    expect(pickDevice('x', [])).toBeNull()
  })
})

describe('why Start recording is off', () => {
  const ready = { sources: { mic: true, system: true }, systemAvailable: true, recording: false }
  test('it is on with a source to record', () => {
    expect(startBlockReason(ready)).toBeNull()
    expect(startBlockReason({ ...ready, sources: { mic: false, system: true } })).toBeNull()
  })

  test('both sources off', () => {
    expect(startBlockReason({ ...ready, sources: { mic: false, system: false } })).toBe(BOTH_OFF)
  })

  test('system audio alone where none can be captured', () => {
    expect(startBlockReason({ ...ready, sources: { mic: false, system: true }, systemAvailable: false })).toBe(BOTH_OFF)
    expect(startBlockReason({ ...ready, systemAvailable: false })).toBeNull()
  })

  test('a recording in progress', () => {
    expect(startBlockReason({ ...ready, recording: true })).toBe('A recording is already in progress')
  })
})

test('a refused capture on macOS without Screen Recording access says where to grant it', () => {
  expect(captureStartError('darwin', 'SCStream failed: permission denied')).toMatch(/^Screen Recording access is required/)
  expect(captureStartError('linux', 'parec is not installed')).toBe('parec is not installed')
  expect(captureStartError('linux', '')).toBe('Failed to start system audio capture.')
})

test('elapsed time: minutes and seconds, hours after an hour', () => {
  expect(formatElapsed(0)).toBe('0:00')
  expect(formatElapsed(754)).toBe('12:34')
  expect(formatElapsed(3600 + 62)).toBe('1:01:02')
})
