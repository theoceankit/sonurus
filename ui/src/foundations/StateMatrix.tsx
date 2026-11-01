import { Fragment, type ReactNode } from 'react'
import { cx } from '../styles/cx'
import styles from './StateMatrix.module.css'

// Classes of storybook-addon-pseudo-states: they force a state on everything
// inside, so the matrix needs nothing extra in the components' own CSS.
const FORCED: Record<string, string> = {
  Hover: 'pseudo-hover-all',
  Pressed: 'pseudo-hover-all pseudo-active-all',
  Focus: 'pseudo-focus-visible-all',
}
const FORCED_ON_FIELDS: Record<string, string> = { ...FORCED, Focus: 'pseudo-focus-within-all' }

export interface MatrixRow<S extends string> {
  label: string
  render: (state: S) => ReactNode
  // States this row does not have stay empty, as on the Penpot boards.
  skip?: S[]
}

interface StateMatrixProps<S extends string> {
  states: readonly S[]
  rows: MatrixRow<S>[]
  // Rows that fill their cell need a width to fill.
  wideCells?: boolean
  // A field shows focus on its box, not on the buttons inside it.
  fields?: boolean
}

// Rows and columns like a board in Penpot, to compare the two side by side.
export function StateMatrix<S extends string>({ states, rows, wideCells, fields }: StateMatrixProps<S>) {
  return (
    <div className={styles.matrix} style={{ gridTemplateColumns: `max-content repeat(${states.length}, max-content)` }}>
      <span />
      {states.map(state => <span key={state} className={styles.heading}>{state}</span>)}
      {rows.map(row => (
        <Fragment key={row.label}>
          <span className={styles.heading}>{row.label}</span>
          {states.map(state => (
            <div key={state} className={cx(styles.cell, (wideCells || fields) && styles.wideCell, (fields ? FORCED_ON_FIELDS : FORCED)[state])}>
              {!row.skip?.includes(state) && row.render(state)}
            </div>
          ))}
        </Fragment>
      ))}
    </div>
  )
}
