import type { SpeakerTarget } from '../../api/client'
import { useAssignSpeaker, useSetSpeakerPhoto, useSpeakers, useUndoSpeakerAssignment } from '../../api/queries'
import { toast } from '../../components/Toast/toast-store'
import { trackUndoToast } from './speaker-undo-toasts'

export interface SpeakerChange {
  transcriptId: number
  fromSpeakerId: string
  segmentStarts: readonly number[]
  // A new speaker may bring a photo, uploaded once they exist.
  target: SpeakerTarget | (Extract<SpeakerTarget, { name: string }> & { photo?: Blob })
}

// Every change of a speaker offers Undo: the last segment of a voice with no name
// takes the voice out of memory, and nothing else brings it back.
export function useSpeakerChange() {
  const { mutateAsync: assign, isPending: busy } = useAssignSpeaker()
  const { mutateAsync: undo } = useUndoSpeakerAssignment()
  const { mutateAsync: setPhoto } = useSetSpeakerPhoto()
  const speakers = useSpeakers().data

  // Rejects if it fails: whoever asked says so in its own place. A toast outlives
  // the panel that showed it, so Undo works from another recording too.
  const change = async ({ transcriptId, fromSpeakerId, segmentStarts, target: wanted }: SpeakerChange, onUndone?: () => void) => {
    const { photo, ...target } = { photo: undefined, ...wanted }
    const { speakerId } = await assign({ transcriptId, segmentStarts, target })
    // The speaker is there whatever happens to the photo: a failed one is only said.
    if (photo) {
      setPhoto({ speakerId, photo }).catch((error: Error) => {
        toast({ message: `The photo was not saved: ${error.message}`, type: 'error' })
      })
    }
    const name = 'id' in target ? speakers?.find(speaker => speaker.id === target.id)?.name : target.name
    const created = 'name' in target ? { createdSpeakerId: speakerId } : {}
    // Closed by a merge of the speaker the segments would go back to (or of the one
    // made here), who is gone then.
    let forget = () => {}
    const dismiss = toast({
      message: `Assigned to ${name}`,
      action: {
        label: 'Undo',
        onClick: () => {
          forget()
          undo({ transcriptId, segmentStarts, speakerId: fromSpeakerId, ...created })
            .then(onUndone, (error: Error) => { toast({ message: `Failed to undo: ${error.message}`, type: 'error' }) })
        },
      },
    })
    forget = trackUndoToast([fromSpeakerId, ...('name' in target ? [speakerId] : [])], dismiss)
  }

  return { change, busy }
}
