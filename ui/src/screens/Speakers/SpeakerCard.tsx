import { useQueryClient } from '@tanstack/react-query'
import { useEffect, useRef, useState, type MutableRefObject } from 'react'
import { useApi } from '../../api/ApiProvider'
import { queryKeys, useSpeakerSample, useSpeakerTranscripts, useUpdateSpeaker, useWaveform } from '../../api/queries'
import type { Speaker } from '../../api/types'
import { AppearanceRow } from '../../components/AppearanceRow/AppearanceRow'
import { Avatar } from '../../components/Avatar/Avatar'
import { Button } from '../../components/Button/Button'
import { ColorPicker } from '../../components/ColorPicker/ColorPicker'
import { IconButton } from '../../components/IconButton/IconButton'
import { Inline } from '../../components/Inline/Inline'
import { Menu, MenuAction } from '../../components/Menu/Menu'
import { ScrollBar } from '../../components/ScrollBar/ScrollBar'
import { MetaItem } from '../../components/MetaItem/MetaItem'
import { SectionHeader } from '../../components/SectionHeader/SectionHeader'
import { Stack } from '../../components/Stack/Stack'
import { TextField } from '../../components/TextField/TextField'
import { toast } from '../../components/Toast/toast-store'
import { Tooltip } from '../../components/Tooltip/Tooltip'
import { VoiceClip } from '../../components/VoiceClip/VoiceClip'
import { BAR_COUNT } from '../../components/Waveform/bars'
import { SAMPLE_MAX_SECONDS, useSampleState, type SamplePlayback } from '../../media/sample-playback'
import { formatDuration } from '../../media/timeline'
import { markNotImplemented } from '../../not-implemented'
import { ASSIGNABLE_SPEAKER_COLORS, speakerColor } from '../../styles/speaker-colors'
import { hasSpeakerNamed } from '../Editor/new-speaker'
import { formatLastSeen, speakerUsage } from './speakers'
import styles from './SpeakersDialog.module.css'

const NAME_MAX_LENGTH = 128
const MAIN_SAMPLE = 'sample'

interface SpeakerCardProps {
  speaker: Speaker
  // Everyone else, to tell when the name is repeated.
  others: readonly Speaker[]
  sample: SamplePlayback
  // Why the speaker cannot be deleted now, or null.
  deleteBlocked: string | null
  onBack: () => void
  onOpenRecording: (id: number) => void
  onDelete: () => void
  // The dialog asks it first on Escape: true when it only took back an edit of the name.
  cancelEdit: MutableRefObject<() => boolean>
}

const message = (error: unknown) => (error instanceof Error ? error.message : String(error))

function NameField({ speaker, others, cancelEdit }: Pick<SpeakerCardProps, 'speaker' | 'others' | 'cancelEdit'>) {
  const saved = speaker.name ?? ''
  const [draft, setDraft] = useState(saved)
  const [error, setError] = useState<string>()
  const input = useRef<HTMLInputElement>(null)
  const { mutateAsync: update, isPending } = useUpdateSpeaker()

  // A name saved from here or elsewhere shows once it is there.
  useEffect(() => { setDraft(saved) }, [saved])

  const revert = () => {
    setDraft(saved)
    setError(undefined)
  }
  // The blur that follows a taken back edit saves nothing.
  const cancelled = useRef(false)
  cancelEdit.current = () => {
    if (document.activeElement !== input.current || (draft === saved && !error)) return false
    revert()
    cancelled.current = true
    input.current?.blur()
    return true
  }

  const save = async () => {
    if (cancelled.current) {
      cancelled.current = false
      return
    }
    const name = draft.trim()
    // A blank name is not saved: the speaker keeps the one they had.
    if (!name || name === saved) return revert()
    try {
      await update({ speakerId: speaker.id, update: { name } })
      setError(undefined)
    } catch (err) {
      setError(message(err))
    }
  }

  const trimmed = draft.trim()
  const repeated = trimmed && trimmed !== saved && hasSpeakerNamed(others, trimmed) ? `Another speaker is also named "${trimmed}".` : undefined
  const sameAlready = !repeated && speaker.name && hasSpeakerNamed(others, speaker.name) ? `Another speaker is also named "${speaker.name}".` : undefined

  return (
    <TextField
      ref={input}
      label="Name"
      placeholder="Add a name"
      maxLength={NAME_MAX_LENGTH}
      value={draft}
      readOnly={isPending}
      helper={repeated ?? sameAlready}
      error={error}
      onChange={event => {
        setDraft(event.target.value)
        setError(undefined)
      }}
      onBlur={() => { void save() }}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          void save()
        }
      }}
    />
  )
}

function VoiceSample({ speaker, sample }: Pick<SpeakerCardProps, 'speaker' | 'sample'>) {
  const api = useApi()
  const found = useSpeakerSample(speaker.id)
  const state = useSampleState(sample)
  const clip = found.data
  const end = clip ? Math.min(clip.end, clip.start + SAMPLE_MAX_SECONDS) : 0
  const [bars, setBars] = useState(BAR_COUNT.small)
  const levels = useWaveform(clip ? clip.transcript_id : null, { bars, start: clip?.start ?? 0, end })
  const playing = state.key === MAIN_SAMPLE

  if (found.isError || (!found.isPending && !clip)) {
    return (
      <p className={styles.hint}>
        {speaker.transcripts ? 'Audio unavailable: the recordings of this speaker were moved or deleted.' : 'Not in any recording yet.'}
      </p>
    )
  }
  return (
    <VoiceClip
      playing={playing && state.playing}
      progress={playing ? state.progress : 0}
      duration={formatDuration(end - (clip?.start ?? 0))}
      text={clip?.text.trim() ?? ''}
      disabled={!clip}
      heights={levels.data}
      onBarCount={setBars}
      onToggle={() => { if (clip) sample.toggle(MAIN_SAMPLE, api.getRecordingAudioUrl(clip.transcript_id), clip.start, clip.end) }}
    />
  )
}

function AppearsIn({ speaker, sample, onOpenRecording }: Pick<SpeakerCardProps, 'speaker' | 'sample' | 'onOpenRecording'>) {
  const api = useApi()
  const queries = useQueryClient()
  const recordings = useSpeakerTranscripts(speaker.id)
  const state = useSampleState(sample)

  const play = async (transcriptId: number) => {
    const key = `recording:${transcriptId}`
    try {
      const found = await queries.fetchQuery({
        queryKey: queryKeys.sample(speaker.id, transcriptId),
        queryFn: () => api.getSpeakerSample(speaker.id, transcriptId),
      })
      sample.toggle(key, api.getRecordingAudioUrl(transcriptId), found.start, found.end)
    } catch {
      toast({ message: 'The audio of this recording is unavailable.', type: 'error' })
    }
  }

  const rows = recordings.data ?? []
  return (
    <Stack gap={1}>
      <SectionHeader title="Appears in" meta={recordings.data ? String(rows.length) : undefined} />
      {recordings.isError && <p className={styles.hint}>Could not load the recordings: {message(recordings.error)}</p>}
      {recordings.data && rows.length === 0 && <p className={styles.hint}>Not in any recording yet.</p>}
      {rows.map(row => {
        const key = `recording:${row.id}`
        return (
          <AppearanceRow
            key={row.id}
            title={row.title}
            date={formatLastSeen(row.created_at)}
            time={formatDuration(row.duration_sec)}
            audioMissing={!row.has_audio}
            playing={state.key === key && state.playing}
            onPlay={() => {
              // The same sample again pauses it, as a clip does.
              if (state.key === key) sample.toggle(key, api.getRecordingAudioUrl(row.id), 0, 0)
              else void play(row.id)
            }}
            onOpen={() => onOpenRecording(row.id)}
          />
        )
      })}
    </Stack>
  )
}

// One speaker, in place of the list: who they are, how they sound and where they talk.
export function SpeakerCard({ speaker, others, sample, deleteBlocked, onBack, onOpenRecording, onDelete, cancelEdit }: SpeakerCardProps) {
  const { mutate: update } = useUpdateSpeaker()
  const [area, setArea] = useState<HTMLElement | null>(null)
  const usage = speakerUsage(speaker)
  const named = Boolean(speaker.name)
  const color = speakerColor(speaker.color_index)

  const deleteButton = (
    <Button variant="danger" size="small" icon="delete" disabled={Boolean(deleteBlocked)} onClick={onDelete}>Delete speaker…</Button>
  )

  return (
    <>
      <Stack ref={setArea} gap={4} className={styles.card}>
        <Inline justify="between">
          <IconButton icon="arrow-left" label="Back to speakers" onClick={onBack} />
          <Menu align="end" trigger={<IconButton icon="more" label="More" />}>
            <MenuAction icon="assign-speaker" {...markNotImplemented('speaker-card.merge')}>Merge into another speaker…</MenuAction>
          </Menu>
        </Inline>
        <Inline gap={4} align="start">
          {named ? <Avatar name={speaker.name!} color={color} size="large" /> : <Avatar kind="unknown" size="large" />}
          <Stack gap={3} className={styles.fields}>
            <NameField key={speaker.id} speaker={speaker} others={others} cancelEdit={cancelEdit} />
            <TextField label="Handle" prefix="@" placeholder="olivia.brown" readOnly {...markNotImplemented('speaker-card.handle')} />
          </Stack>
        </Inline>
        <Inline gap={4} wrap>
          <MetaItem icon="microphone">{usage.recordings}</MetaItem>
          {usage.time !== null && <MetaItem icon="clock">{formatDuration(usage.time)}</MetaItem>}
          <MetaItem icon="calendar">{`Last seen ${formatLastSeen(speaker.last_seen)}`}</MetaItem>
        </Inline>
        <Stack gap={1}>
          <SectionHeader title="Voice sample" />
          <VoiceSample speaker={speaker} sample={sample} />
        </Stack>
        <Stack gap={1}>
          <SectionHeader title="Colour" />
          {named
            ? <ColorPicker aria-label="Colour" value={color} colors={ASSIGNABLE_SPEAKER_COLORS} onValueChange={next => update({ speakerId: speaker.id, update: { color_index: next - 1 } }, { onError: error => toast({ message: message(error), type: 'error' }) })} />
            : <p className={styles.hint}>Speakers without a name are grey. Add a name to choose a colour.</p>}
        </Stack>
        <AppearsIn speaker={speaker} sample={sample} onOpenRecording={onOpenRecording} />
        <Inline gap={4} justify="between" className={styles.danger}>
          <p className={styles.hint}>Their segments stay in the recordings as Unassigned.</p>
          {deleteBlocked
            // A disabled button gets no pointer events: the tooltip hangs on a wrapper.
            ? <Tooltip text={deleteBlocked}><span className={styles.blocked} tabIndex={0} aria-label={`Delete speaker: ${deleteBlocked}`}>{deleteButton}</span></Tooltip>
            : deleteButton}
        </Inline>
      </Stack>
      <ScrollBar area={area} />
    </>
  )
}
