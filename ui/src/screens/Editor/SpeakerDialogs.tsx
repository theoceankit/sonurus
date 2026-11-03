import { useState } from 'react'
import type { SpeakerTarget } from '../../api/client'
import { useSpeakerCandidates, useSpeakers, useTranscript } from '../../api/queries'
import { effectiveSpeaker } from '../../api/types'
import { ChooseSpeakerModal } from '../../components/ChooseSpeakerModal/ChooseSpeakerModal'
import { NewSpeakerModal } from '../../components/NewSpeakerModal/NewSpeakerModal'
import { toast } from '../../components/Toast/toast'
import { hasSpeakerNamed, leastUsedColorIndex } from './new-speaker'
import { chooseSpeakerList, preselectedSpeaker } from './speaker-search'

// Someone asks who a speaker is: the review, a row of the inspector or a turn.
export interface SpeakerRequest {
  transcriptId: number
  // Whose voice the matches are for.
  speakerId: string
  start: 'choose' | 'new'
  preselected?: string | null
  onAssign: (target: SpeakerTarget) => Promise<void>
}

interface SpeakerDialogsProps {
  request: SpeakerRequest
  open?: boolean
  onClose: () => void
  onExited?: () => void
}

export function SpeakerDialogs({ request, open = true, onClose, onExited }: SpeakerDialogsProps) {
  const { transcriptId, speakerId, start, preselected = null, onAssign } = request
  const speakers = useSpeakers().data ?? []
  const transcript = useTranscript(transcriptId).data
  const candidates = useSpeakerCandidates(transcriptId).data?.[speakerId]?.candidates ?? []
  const [view, setView] = useState<{ name: 'choose'; query: string } | { name: 'new'; speakerName: string }>(
    start === 'choose' ? { name: 'choose', query: '' } : { name: 'new', speakerName: '' },
  )
  const [busy, setBusy] = useState(false)
  // One window turning into the other is not a new window.
  const [swapped, setSwapped] = useState(false)

  if (view.name === 'new') {
    return (
      <NewSpeakerModal
        initialName={view.speakerName}
        initialColorIndex={leastUsedColorIndex(speakers)}
        isNameTaken={name => hasSpeakerNamed(speakers, name)}
        onCreate={async (name, colorIndex) => {
          await onAssign({ name, colorIndex })
          onClose()
        }}
        onBack={() => {
          if (start === 'new') onClose()
          else {
            setSwapped(true)
            setView({ name: 'choose', query: view.speakerName })
          }
        }}
        onClose={onClose}
        open={open}
        onExited={onExited}
        skipEnter={swapped}
      />
    )
  }

  const recordingSpeakers = transcript?.segments.map(effectiveSpeaker) ?? []
  return (
    <ChooseSpeakerModal
      list={(query, category) => chooseSpeakerList({ speakers, candidates, recordingSpeakers, query, category })}
      initialQuery={view.query}
      initialSelectedId={preselectedSpeaker(preselected, candidates)}
      busy={busy}
      onAssign={async id => {
        setBusy(true)
        try {
          await onAssign({ id })
          onClose()
        } catch (error) {
          setBusy(false)
          toast({ message: `Failed to assign the speaker: ${(error as Error).message}`, type: 'error' })
        }
      }}
      onNewSpeaker={name => {
        setSwapped(true)
        setView({ name: 'new', speakerName: name })
      }}
      onClose={onClose}
      open={open}
      onExited={onExited}
      skipEnter={swapped}
    />
  )
}
