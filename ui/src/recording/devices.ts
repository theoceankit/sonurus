import { useEffect, useState } from 'react'

// The inputs of this computer. Their labels are empty until the window may use the
// microphone, so it asks first and lets the microphone go at once.
export async function listInputDevices(): Promise<MediaDeviceInfo[]> {
  const media = typeof navigator === 'undefined' ? undefined : navigator.mediaDevices
  if (!media?.enumerateDevices) return []
  try {
    const stream = await media.getUserMedia({ audio: true })
    stream.getTracks().forEach(track => track.stop())
  } catch {
    // Refused or no microphone: the inputs are listed without their names.
  }
  try {
    return await media.enumerateDevices()
  } catch {
    return []
  }
}

// The inputs, listed again each time `active` turns on: a microphone may have come or gone.
export function useInputDevices(active: boolean): MediaDeviceInfo[] {
  const [inputs, setInputs] = useState<MediaDeviceInfo[]>([])
  useEffect(() => {
    if (!active) return
    let current = true
    void listInputDevices().then(devices => { if (current) setInputs(devices) })
    return () => { current = false }
  }, [active])
  return inputs
}
