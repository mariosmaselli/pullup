import type { ReactNode } from 'react'
import './EmptyState.scss'

interface Props {
  title: string
  children?: ReactNode
  milestone?: string
}

export function EmptyState({ title, children, milestone }: Props) {
  return (
    <div className="empty-state flex flex-col items-center">
      {milestone ? <span className="empty-state__milestone -meta">{milestone}</span> : null}
      <h2 className="-t2">{title}</h2>
      {children ? <div className="empty-state__body -p">{children}</div> : null}
    </div>
  )
}
