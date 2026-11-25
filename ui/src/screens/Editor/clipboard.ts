import { toast } from '../../components/Toast/toast-store'

// Copy on the transcript and Copy notes: through the main process, since it refuses
// navigator.clipboard, and a toast says whether it worked.
export async function copyToClipboard(text: string) {
  try {
    await window.electronAPI.writeClipboard(text)
    toast({ message: 'Copied' })
  } catch {
    toast({ message: 'Copy failed', type: 'error' })
  }
}
