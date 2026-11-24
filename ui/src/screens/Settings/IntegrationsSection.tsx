import { useMcpEnabled, useSetMcpEnabled } from '../../api/queries'
import { FieldRow } from '../../components/FieldRow/FieldRow'
import { IconButton } from '../../components/IconButton/IconButton'
import { Inline } from '../../components/Inline/Inline'
import { Reveal } from '../../components/Reveal/Reveal'
import { SectionCard } from '../../components/SectionCard/SectionCard'
import { toast } from '../../components/Toast/toast-store'
import { Toggle } from '../../components/Toggle/Toggle'
import styles from './Settings.module.css'

const SWITCH = 'Let AI agents use Sonorus'
// The backend listens on this port only (electron/backend.js).
export const MCP_ADDRESS = 'http://127.0.0.1:8000/mcp'
export const CLAUDE_CODE_COMMAND = `claude mcp add --transport http --scope user sonorus ${MCP_ADDRESS}`

async function copy(text: string) {
  try {
    await window.electronAPI.writeClipboard(text)
    toast({ message: 'Copied' })
  } catch {
    toast({ message: 'Copy failed', type: 'error' })
  }
}

function CopyRow({ label, value, what }: { label: string; value: string; what: string }) {
  return (
    <FieldRow label={label} stacked>
      <Inline gap={2} className={styles.stretch}>
        <code className={styles.connectValue}>{value}</code>
        <IconButton icon="copy" label={`Copy the ${what}`} onClick={() => void copy(value)} />
      </Inline>
    </FieldRow>
  )
}

// The MCP server of the backend (app/mcp/): off until switched on here, then agents on
// this machine reach it at MCP_ADDRESS while Sonorus runs.
export function IntegrationsSection() {
  const { data: enabled } = useMcpEnabled()
  const { mutate, isPending, variables } = useSetMcpEnabled()
  const on = isPending ? !!variables : !!enabled
  const change = (next: boolean) => mutate(next, {
    onError: error => toast({
      message: `Could not turn ${next ? 'on' : 'off'} the MCP server: ${(error as Error).message}`,
      type: 'error',
    }),
  })
  return (
    <>
      <SectionCard title="MCP server">
        <FieldRow
          label={SWITCH}
          hint="Agents such as Claude Code read your recordings, transcripts and notes, and may send what they read to their provider. Works while Sonorus is running, also in the tray."
        >
          <Toggle label={SWITCH} checked={on} disabled={enabled === undefined} onChange={change} />
        </FieldRow>
      </SectionCard>
      <Reveal open={on}>
        <SectionCard title="Connect Claude Code" description="Run the command in a terminal once. Claude Code then reaches Sonorus in every project.">
          <CopyRow label="Address" value={MCP_ADDRESS} what="address" />
          <CopyRow label="Command" value={CLAUDE_CODE_COMMAND} what="command" />
        </SectionCard>
      </Reveal>
    </>
  )
}
