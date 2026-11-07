import { Icon } from '../../components/Icon/Icon'
import { Stack } from '../../components/Stack/Stack'
import { markNotImplemented } from '../../not-implemented'
import styles from './EmptyState.module.css'

// The centre of the window when there are no recordings at all. Not while the list
// loads or the backend does not answer: the sidebar says so then.
export function EmptyState() {
  return (
    <div className={styles.emptyState}>
      <Stack gap={2} align="center" className={styles.message}>
        <p className={styles.title}>
          To make a new transcription, press{' '}
          {/* On a chip, as a key in a shortcut hint: the button it stands for. */}
          <span className={styles.plus}><Icon name="add" label="plus" /></span>
          {' '}at the top left.
        </p>
        <p className={styles.note}>
          Transcribing needs models, which are downloaded in{' '}
          <button type="button" className={styles.link} {...markNotImplemented('home.settings')}>Settings</button>.
        </p>
      </Stack>
    </div>
  )
}
