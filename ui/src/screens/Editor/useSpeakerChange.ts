import type { SpeakerTarget } from '../../api/client'
import { useAssignSpeaker, useSpeakers, useUndoSpeakerAssignment } from '../../api/queries'
import { toast } from '../../components/Toast/toast'

export interface SpeakerChange {
  transcriptId: number
  fromSpeakerId: string
  segmentStarts: readonly number[]
  target: SpeakerTarget
}

// Every change of a speaker offers Undo: the last segment of a voice with no name
// takes the voice out of memory, and nothing else brings it back.
export function useSpeakerChange() {
  const { mutateAsync: assign, isPending: busy } = useAssignSpeaker()
  const { mutateAsync: undo } = useUndoSpeakerAssignment()
  const speakers = useSpeakers().data

  // Rejects if it fails: whoever asked says so in its own place. A toast outlives
  // the panel that showed it, so Undo works from another recording too.
  const change = async ({ transcriptId, fromSpeakerId, segmentStarts, target }: SpeakerChange, onUndone?: () => void) => {
    const { speakerId } = await assign({ transcriptId, segmentStarts, target })
    const name = 'id' in target ? speakers?.find(speaker => speaker.id === target.id)?.name : target.name
    toast({
      message: `Assigned to ${name}`,
      action: {
        label: 'Undo',
        onClick: () => {
          undo({ transcriptId, segmentStarts, speakerId: fromSpeakerId, ...('name' in target ? { createdSpeakerId: speakerId } : {}) })
            .then(onUndone, (error: Error) => { toast({ message: `Failed to undo: ${error.message}`, type: 'error' }) })
        },
      },
    })
  }

  return { change, busy }
}
