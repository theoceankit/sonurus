import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { expect, test, vi } from 'vitest'
import { VoiceClip } from './VoiceClip'
import voiceClipCss from './VoiceClip.module.css?raw'

const CLIP = { duration: '0:04', text: 'That was me.', progress: 0 }

test('the text is folded and opens and closes with the chevron', async () => {
  render(<VoiceClip {...CLIP} />)
  expect(screen.queryByText('That was me.')).toBeNull()
  await userEvent.click(screen.getByRole('button', { name: 'Show text' }))
  expect(screen.getByText('That was me.')).toBeTruthy()
  const hide = screen.getByRole('button', { name: 'Hide text' })
  expect(hide.getAttribute('aria-expanded')).toBe('true')
  await userEvent.click(hide)
  expect(screen.getByRole('button', { name: 'Show text' }).getAttribute('aria-expanded')).toBe('false')
})

test('a story may open with the text shown', () => {
  render(<VoiceClip {...CLIP} initialTextExpanded />)
  expect(screen.getByText('That was me.')).toBeTruthy()
})

test('no text, no button for it', () => {
  render(<VoiceClip {...CLIP} text="" />)
  expect(screen.queryByRole('button', { name: 'Show text' })).toBeNull()
  expect(screen.getByRole('button', { name: 'Play clip' })).toBeTruthy()
})

test('Play calls back, and is off without audio', async () => {
  const onToggle = vi.fn()
  const { rerender } = render(<VoiceClip {...CLIP} onToggle={onToggle} />)
  await userEvent.click(screen.getByRole('button', { name: 'Play clip' }))
  expect(onToggle).toHaveBeenCalledOnce()
  rerender(<VoiceClip {...CLIP} playing progress={0.5} onToggle={onToggle} />)
  expect(screen.getByRole('button', { name: 'Pause clip' })).toBeTruthy()
  rerender(<VoiceClip {...CLIP} disabled onToggle={onToggle} />)
  expect((screen.getByRole('button', { name: 'Play clip' }) as HTMLButtonElement).disabled).toBe(true)
})

test('the clip keeps the heights of its waveform', () => {
  render(<VoiceClip {...CLIP} heights={[0.25, 1]} />)
  const bars = [...screen.getByText('0:04').previousElementSibling!.children] as HTMLElement[]
  expect(bars.map(bar => bar.style.height)).toEqual(['25%', '100%'])
})

test('a long text keeps to a few lines, so what is around stays readable', () => {
  expect(voiceClipCss).toMatch(/\.text \{[^}]*max-height: var\(--size-review-clip-text\);[^}]*overflow-y: auto;/)
})

test('in the inspector only the text gives way', () => {
  expect(voiceClipCss).toMatch(/@container inspector-panel \(min-height: \d+px\) \{[\s\S]*\.voiceClip > \* \{[^}]*flex: none;[\s\S]*\.text \{[^}]*min-height: 0;/)
})
