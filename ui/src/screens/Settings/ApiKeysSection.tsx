import { useEffect, useRef, useState } from 'react'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { IconButton } from '../../components/IconButton/IconButton'
import { Inline } from '../../components/Inline/Inline'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { TextField } from '../../components/TextField/TextField'
import { settingsStore, useSettings } from '../../platform/settings'
import styles from './Settings.module.css'

// The HuggingFace token, hidden until shown. Saved when the field changes and is left,
// on Enter, and when the field goes (Settings closed in any way, another section),
// without spaces around it; model downloads send it, and the backend reads it on start.
function HuggingFaceToken({ saved }: { saved: string }) {
  const [token, setToken] = useState(saved)
  const [visible, setVisible] = useState(false)
  useEffect(() => setToken(saved), [saved])
  // What the field holds and what was written last, for the save on the way out.
  const latest = useRef({ token, saved })
  latest.current.token = token
  const save = () => {
    const next = latest.current.token.trim()
    setToken(next)
    if (next === latest.current.saved) return
    latest.current.saved = next
    void settingsStore().patch({ hfToken: next })
  }
  useEffect(() => { latest.current.saved = saved }, [saved])
  const saveRef = useRef(save)
  saveRef.current = save
  useEffect(() => () => saveRef.current(), [])
  return (
    <FieldRow
      label="HuggingFace token"
      hint="Required for speaker diarization (PyAnnote). Create a read token in your HuggingFace account settings, under Access Tokens."
      stacked
    >
      <Inline gap={2} className={styles.stretch}>
        <TextField
          aria-label="HuggingFace token"
          type={visible ? 'text' : 'password'}
          placeholder="hf_…"
          autoComplete="off"
          spellCheck={false}
          value={token}
          onChange={event => setToken(event.target.value)}
          onBlur={save}
          onKeyDown={event => { if (event.key === 'Enter') save() }}
          className={styles.grow}
        />
        <IconButton icon="eye" variant="ghost" label={visible ? 'Hide token' : 'Show token'} selected={visible} onClick={() => setVisible(!visible)} />
      </Inline>
    </FieldRow>
  )
}

export function ApiKeysSection() {
  const settings = useSettings()
  if (!settings) return null
  return (
    <SectionCard title="Credentials" description="For the models that need an account with their provider.">
      <HuggingFaceToken saved={settings.hfToken} />
    </SectionCard>
  )
}
