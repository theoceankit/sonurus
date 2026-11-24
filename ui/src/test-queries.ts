import { screen, within } from '@testing-library/react'

// A role query looks at every element under it, and after any change to the DOM
// jsdom works out the style of each of them again: over the whole app one
// getByRole costs about a quarter of a second, several times that on a CI
// runner. These find the parts a screen test opens by their label, which costs
// next to nothing, so a test can then query by role inside them
// (docs/docs/ui/electron/development.md, Tests of a whole screen).

// A button of the title bar, such as Settings or Speakers, named by its aria-label.
export const getTitlebarButton = (label: string) => screen.getByLabelText(label, { selector: 'button' })
export const findTitlebarButton = (label: string) => screen.findByLabelText(label, { selector: 'button' })

// A dialog by its accessible name, which Radix gives it from the title.
export const getDialog = (name: string) => screen.getByLabelText(name, { selector: '[role="dialog"]' })
export const queryDialog = (name: string) => screen.queryByLabelText(name, { selector: '[role="dialog"]' })
export const findDialog = (name: string) => screen.findByLabelText(name, { selector: '[role="dialog"]' })

// The toasts, in the region Radix names Notifications with its hotkey.
export const toasts = () => within(screen.getByLabelText(/^Notifications/, { selector: '[role="region"]' }))
