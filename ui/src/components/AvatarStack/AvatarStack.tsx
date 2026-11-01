import { cx } from '../../styles/cx'
import { Avatar, type AvatarSpeaker } from '../Avatar/Avatar'
import styles from './AvatarStack.module.css'

export type StackSpeaker = AvatarSpeaker & { id: string; title?: string }

interface AvatarStackProps {
  speakers: StackSpeaker[]
  size?: 'xs' | 'small'
  max?: number
  className?: string
}

// Overlapping avatars; the first one is on top. Speakers past max become "+N".
export function AvatarStack({ speakers, size = 'small', max = speakers.length, className }: AvatarStackProps) {
  const shown = speakers.slice(0, max)
  const hidden = speakers.length - shown.length
  return (
    <span className={cx(styles.stack, styles[size], className)}>
      {shown.map(({ id, ...speaker }, i) => (
        <Avatar key={id} {...speaker} size={size} style={{ zIndex: shown.length - i }} />
      ))}
      {hidden > 0 && <span className={styles.more}>+{hidden}</span>}
    </span>
  )
}
