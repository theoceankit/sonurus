import { useEffect, useState } from 'react'
import { useMicWatch } from '../../api/queries'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { Select } from '../../components/Select/Select'
import { Toggle } from '../../components/Toggle/Toggle'
import { Stack } from '../../components/Stack/Stack'
import { markNotImplemented } from '../../not-implemented'
import type { ElectronSettings, MicApp, NotificationRefusal } from '../../platform/electron-api'
import { useMicApps } from '../../platform/mic-apps'
import { useNotificationRefusal } from '../../platform/notification-refusal'
import { settingsStore, useSettings } from '../../platform/settings'
import styles from './Settings.module.css'

const START_APPS: { value: ElectronSettings['promptStartApps']; label: string }[] = [
  { value: 'any', label: 'Any app' },
  { value: 'selected', label: 'Selected apps' },
]

const END_ACTIONS: { value: ElectronSettings['promptEnd']; label: string }[] = [
  { value: 'suggest', label: 'Suggest stopping' },
  { value: 'auto', label: 'Stop recording automatically' },
  { value: 'off', label: 'Do nothing' },
]

const ALL = 'Show notifications'
const TRANSCRIPTIONS = 'When a transcription is ready or fails'
const START = 'Suggest recording when a call seems to start'

const patch = (change: Partial<ElectronSettings>) => void settingsStore().patch(change)

function usePlatform() {
  const [platform, setPlatform] = useState('')
  useEffect(() => {
    let current = true
    window.electronAPI?.getPlatform().then(read => { if (current) setPlatform(read) }).catch(() => {})
    return () => { current = false }
  }, [])
  return platform
}

// The apps seen holding a microphone, and the ones picked that are no longer listed.
function appList(seen: MicApp[], selected: string[]): MicApp[] {
  const missing = selected.filter(id => !seen.some(app => app.id === id)).map(id => ({ id, name: id }))
  return [...seen, ...missing]
}

function SelectedApps({ selected, disabled }: { selected: string[]; disabled: boolean }) {
  const apps = appList(useMicApps(), selected)
  if (apps.length === 0) return <p className={styles.quiet}>Apps appear here once they use a microphone for a call.</p>
  return (
    <>
      {apps.map(app => (
        <FieldRow key={app.id} label={app.name}>
          <Toggle
            label={app.name}
            checked={selected.includes(app.id)}
            disabled={disabled}
            onChange={on => patch({ promptStartSelected: on ? [...selected, app.id] : selected.filter(id => id !== app.id) })}
          />
        </FieldRow>
      ))}
    </>
  )
}

// What the system said when it did not show a notification, and where it allows them.
function refusalText(platform: string): string {
  if (platform === 'darwin') {
    return 'macOS did not show the last notification. Allow notifications for Sonorus in System Settings, under Notifications.'
  }
  if (platform === 'win32') {
    return 'Windows did not show the last notification. Turn on notifications for Sonorus in Windows Settings, under System and Notifications.'
  }
  return 'The system did not show the last notification.'
}

function RefusedNote({ refusal, platform }: { refusal: NotificationRefusal; platform: string }) {
  return (
    <Stack gap={1} role="status" aria-label="Notifications refused" className={styles.refusedNotice}>
      <span>{refusalText(platform)}</span>
      <span className={styles.refusedError}>{refusal.error}</span>
    </Stack>
  )
}

// Notifications of the main process (electron/recording-prompts.js): when another app
// holds a microphone for a while a call may have started, when it lets go or nothing is
// heard during a recording the call may have ended.
export function NotificationsSection() {
  const settings = useSettings()
  const watch = useMicWatch().data
  const platform = usePlatform()
  const refusal = useNotificationRefusal()
  if (!settings) return null
  const all = settings.notifications !== false
  // Until the backend has said, the controls stay as they are.
  const unsupported = watch?.available === false
  const startOn = all && settings.promptStart !== false
  const selected = settings.promptStartSelected ?? []
  const startHint = unsupported && platform === 'linux'
    ? 'Needs pactl, from pulseaudio-utils (libpulse on Arch Linux).'
    : watch?.names === false
      ? 'When another app has used a microphone for 15 seconds. This system does not say which app.'
      : 'When another app has used a microphone for 15 seconds.'
  return (
    <>
      <SectionCard>
        <FieldRow
          label={ALL}
          hint="Notifications of Sonorus, also when its window is closed to the tray."
          note={refusal ? <RefusedNote refusal={refusal} platform={platform} /> : undefined}
        >
          <Toggle label={ALL} checked={all} onChange={on => patch({ notifications: on })} />
        </FieldRow>
      </SectionCard>
      <SectionCard title="Transcriptions" description="A click on a notification opens the recording, or the job that failed.">
        <FieldRow label={TRANSCRIPTIONS} hint="While the Sonorus window is not in front.">
          <Toggle
            label={TRANSCRIPTIONS}
            checked={all && settings.notifyTranscriptions !== false}
            disabled={!all}
            onChange={on => patch({ notifyTranscriptions: on })}
          />
        </FieldRow>
      </SectionCard>
      <SectionCard title="Calls" description="A click on a notification opens Sonorus. Nothing records without you.">
        <FieldRow label={START} hint={startHint}>
          <Toggle
            label={START}
            checked={!unsupported && startOn}
            disabled={!all}
            onChange={on => patch({ promptStart: on })}
            {...(unsupported ? markNotImplemented('settings.call-start-prompts') : {})}
          />
        </FieldRow>
        <FieldRow label="Calls in" hint="Selected apps: only calls in the apps turned on below.">
          <Select
            aria-label="Calls in"
            value={settings.promptStartApps ?? 'any'}
            options={START_APPS}
            disabled={!startOn || unsupported}
            onValueChange={value => patch({ promptStartApps: value as ElectronSettings['promptStartApps'] })}
          />
        </FieldRow>
        {settings.promptStartApps === 'selected' && <SelectedApps selected={selected} disabled={!startOn || unsupported} />}
        <FieldRow
          label="When a call seems to end"
          hint={watch?.names === false
            ? 'During a recording: when nothing is heard for 5 minutes.'
            : 'During a recording: when other apps let go of the microphone for 15 seconds, or nothing is heard for 5 minutes.'}
        >
          <Select
            aria-label="When a call seems to end"
            value={settings.promptEnd ?? 'suggest'}
            options={END_ACTIONS}
            disabled={!all}
            onValueChange={value => patch({ promptEnd: value as ElectronSettings['promptEnd'] })}
          />
        </FieldRow>
      </SectionCard>
    </>
  )
}
