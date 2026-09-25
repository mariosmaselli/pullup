import type { ButtonHTMLAttributes } from 'react'
import './Button.scss'

interface Props extends ButtonHTMLAttributes<HTMLButtonElement> {
  variant?: 'primary' | 'secondary' | 'ghost' | 'danger'
  size?: 's' | 'm'
}

export function Button({ variant = 'secondary', size = 'm', className, ...props }: Props) {
  const classes = ['button', `-${variant}`, `-size-${size}`, size === 's' ? '-p1' : '-p', className]
  return <button type="button" className={classes.filter(Boolean).join(' ')} {...props} />
}
