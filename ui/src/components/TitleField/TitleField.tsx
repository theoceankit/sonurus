import { useEffect, useRef, useState } from 'react'

interface TitleFieldProps {
  title: string
  // What a screen reader calls the field.
  label: string
  // Gets what was typed on Enter or when the field is left, null on Escape; once.
  // Checking it is up to the caller.
  onDone: (next: string | null) => void
  // The look is the caller's: the field stands in place of the title it edits.
  className?: string
}

// The field that renames a recording in place of its title: focused with the title
// selected, saved on Enter or by leaving it, cancelled by Escape.
export function TitleField({ title, label, onDone, className }: TitleFieldProps) {
  const [value, setValue] = useState(title)
  const input = useRef<HTMLInputElement>(null)
  // Taking the field away moves the focus, and that must not finish twice.
  const finished = useRef(false)

  useEffect(() => {
    input.current!.focus()
    input.current!.select()
  }, [])

  const finish = (next: string | null) => {
    if (finished.current) return
    finished.current = true
    onDone(next)
  }

  return (
    <input
      ref={input}
      aria-label={label}
      maxLength={200}
      className={className}
      value={value}
      onChange={event => setValue(event.target.value)}
      onBlur={() => finish(value)}
      onKeyDown={event => {
        if (event.key === 'Enter') {
          event.preventDefault()
          finish(value)
        } else if (event.key === 'Escape') {
          event.preventDefault()
          finish(null)
        }
      }}
    />
  )
}
