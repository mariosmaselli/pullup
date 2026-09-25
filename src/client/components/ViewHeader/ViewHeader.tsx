import type { ReactNode } from 'react'
import './ViewHeader.scss'

interface Props {
  title: string
  description?: string
  actions?: ReactNode
}

export function ViewHeader({ title, description, actions }: Props) {
  return (
    <header className="view-header flex items-end justify-between">
      <div className="flex flex-col">
        <h1 className="-t1">{title}</h1>
        {description ? <p className="view-header__description -p">{description}</p> : null}
      </div>
      {actions ? <div className="flex items-center shrink-0">{actions}</div> : null}
    </header>
  )
}
