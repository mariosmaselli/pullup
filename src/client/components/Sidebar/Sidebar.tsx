import { Link } from '@tanstack/react-router'
import type { SystemInfo } from '@shared/types.ts'
import { useSystem } from '../../lib/queries.ts'
import { useDuePosts } from '../../lib/due.ts'
import { useCapture } from '../../lib/capture.tsx'
import './Sidebar.scss'

type CountKey = keyof SystemInfo['counts'] | 'due'

const NAV: { to: string; label: string; count?: CountKey }[] = [
  { to: '/inbox', label: 'Inbox', count: 'inbox' },
  { to: '/library', label: 'Library' },
  { to: '/projects', label: 'Projects' },
  { to: '/ideas', label: 'Ideas', count: 'ideas' },
  { to: '/drafts', label: 'Drafts', count: 'posts' },
  { to: '/templates', label: 'Templates' },
  { to: '/calendar', label: 'Calendar', count: 'due' }, // posts due now
]

export function Sidebar() {
  const { data: system } = useSystem()
  const { setQuickCaptureOpen } = useCapture()
  const due = useDuePosts()

  return (
    <aside className="sidebar flex flex-col shrink-0">
      <div className="sidebar__brand -t2">Pullup</div>

      <button
        type="button"
        className="sidebar__capture flex items-center justify-between -p"
        onClick={() => setQuickCaptureOpen(true)}
      >
        <span>Capture</span>
        <span className="-meta">⌘K</span>
      </button>

      <nav className="sidebar__nav flex flex-col">
        {NAV.map((item) => {
          const count =
            item.count === 'due' ? due.length : item.count ? system?.counts[item.count] : undefined
          return (
            <Link
              key={item.to}
              to={item.to}
              className="sidebar__link flex items-center justify-between -p"
              activeProps={{ className: 'is-active' }}
            >
              <span>{item.label}</span>
              {count ? (
                <span
                  className="sidebar__count -meta"
                  title={
                    item.count === 'due'
                      ? `${count} scheduled post${count === 1 ? '' : 's'} due`
                      : undefined
                  }
                >
                  {count}
                </span>
              ) : null}
            </Link>
          )
        })}
      </nav>

      <div className="sidebar__footer flex flex-col">
        <Link
          to="/trash"
          className="sidebar__link flex items-center -p"
          activeProps={{ className: 'is-active' }}
        >
          Trash
        </Link>
        <Link
          to="/settings"
          className="sidebar__link flex items-center -p"
          activeProps={{ className: 'is-active' }}
        >
          Settings
        </Link>
      </div>
    </aside>
  )
}
