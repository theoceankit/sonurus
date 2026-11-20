import { markNotImplemented } from '../../not-implemented'
import { Button } from '../Button/Button'
import { Toolbar, ToolbarDivider, ToolbarItem } from '../Toolbar/Toolbar'

interface TextSelectionBarProps {
  onCopy: () => void
  // Without it there is no Quote to notes.
  onQuote?: () => void
}

// What can be done with text selected in the transcript.
export function TextSelectionBar({ onCopy, onQuote }: TextSelectionBarProps) {
  return (
    <Toolbar label="Selected text">
      <ToolbarItem><Button variant="toolbar" icon="copy" onClick={onCopy}>Copy</Button></ToolbarItem>
      {onQuote && <ToolbarItem><Button variant="toolbar" icon="edit" onClick={onQuote}>Quote to notes</Button></ToolbarItem>}
      <ToolbarDivider />
      <ToolbarItem><Button variant="toolbar" icon="highlight" {...markNotImplemented('transcript.highlight')}>Highlight</Button></ToolbarItem>
    </Toolbar>
  )
}
