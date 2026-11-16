// The Undo toasts of speaker changes, by the speakers their Undo would bring back.
// A merge takes a speaker away for good: an Undo that would give segments back to
// them closes instead of putting the segments under a speaker who is gone.
const open = new Map<() => void, readonly string[]>()

// Returns the function that forgets the toast, for when its Undo was used.
export function trackUndoToast(speakerIds: readonly string[], dismiss: () => void): () => void {
  open.set(dismiss, speakerIds)
  return () => { open.delete(dismiss) }
}

export function dismissUndoToastsOf(speakerId: string) {
  for (const [dismiss, ids] of open) {
    if (!ids.includes(speakerId)) continue
    open.delete(dismiss)
    dismiss()
  }
}
