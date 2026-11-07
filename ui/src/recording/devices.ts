// The inputs of this computer. Their labels are empty until the window may use the
// microphone, so it asks first, as the old UI did, and lets the microphone go at once.
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
