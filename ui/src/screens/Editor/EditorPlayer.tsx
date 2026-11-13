import { useMemo, useState } from 'react'
import { useApi } from '../../api/ApiProvider'
import { useBackendConnected, useSpeakers, useTranscript, useWaveform } from '../../api/queries'
import { effectiveSpeaker, UNASSIGNED, type Segment, type Speaker } from '../../api/types'
import { BAR_COUNT, Player } from '../../components/Player/Player'
import { createKeyStore, useKey, type KeyStore } from '../../media/active-segment'
import { useAudioPlayback, usePlayback, type Playback } from '../../media/playback'
import { useSpaceToggle } from '../../media/space-toggle'
import { timelineDuration, type Turn } from '../../media/timeline'
import { speakerColor, type SpeakerColor } from '../../styles/speaker-colors'

const GRAY: SpeakerColor = 6

// Colours as on the avatars: a speaker without a name is gray.
export function playerTurns(segments: readonly Segment[], speakers: readonly Speaker[]): Turn[] {
  const known = new Map(speakers.map(speaker => [speaker.id, speaker]))
  return segments.map(segment => {
    const { start, end } = segment
    const speaker = effectiveSpeaker(segment)
    const found = known.get(speaker)
    return speaker !== UNASSIGNED && found?.name
      ? { start, end, speaker, name: found.name, color: speakerColor(found.color_index) }
      : { start, end, speaker, name: speaker === UNASSIGNED ? 'Unassigned' : 'Unknown speaker', color: GRAY }
  })
}

// The audio of the open recording. Speed and volume stay when another one opens.
export function useTranscriptPlayback(transcriptId: number | null): Playback {
  const api = useApi()
  const transcript = useTranscript(transcriptId).data
  return useAudioPlayback(transcriptId !== null && transcript ? api.getAudioUrl(transcript) : null, useBackendConnected())
}

interface EditorPlayerProps {
  transcriptId: number | null
  playback: Playback
  // The speaker under the pointer in the inspector: only their bars keep a colour.
  highlight?: KeyStore<string | null>
}

// The player of the open recording.
export function EditorPlayer({ transcriptId, playback, highlight }: EditorPlayerProps) {
  const api = useApi()
  const transcript = useTranscript(transcriptId).data
  const speakers = useSpeakers().data
  const connected = useBackendConnected()
  const state = usePlayback(playback)
  const [ownHighlight] = useState(() => createKeyStore<string | null>(null))
  const highlightedSpeaker = useKey(highlight ?? ownHighlight)
  useSpaceToggle(playback, state.status === 'ready')
  const turns = useMemo(
    () => (transcriptId !== null && transcript ? playerTurns(transcript.segments, speakers ?? []) : []),
    [transcriptId, transcript, speakers],
  )
  // Over the same length as the bars' speakers, also for audio that does not
  // know its length.
  const levels = useWaveform(transcript ? transcriptId : null, {
    bars: BAR_COUNT, start: 0, end: timelineDuration(state.duration, turns),
  }).data

  return (
    <Player
      state={state}
      turns={turns}
      disabled={state.status !== 'ready'}
      notice={transcriptId !== null && transcript && ((state.status === 'error' && connected) || !api.getAudioUrl(transcript)) ? 'Audio file not found' : undefined}
      highlightedSpeaker={highlightedSpeaker}
      heights={levels}
      onToggle={playback.toggle}
      onSeek={playback.seek}
      onRateChange={playback.setRate}
      onVolumeChange={playback.setVolume}
    />
  )
}
