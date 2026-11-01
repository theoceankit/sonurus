import type { ButtonHTMLAttributes } from 'react'
import styles from './Button.module.css'

export function Button({ type = 'button', ...props }: ButtonHTMLAttributes<HTMLButtonElement>) {
  return <button type={type} className={styles.button} {...props} />
}
