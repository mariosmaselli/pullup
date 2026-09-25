import { Outlet } from '@tanstack/react-router'
import { Sidebar } from '../Sidebar/Sidebar.tsx'
import { GlobalCapture } from '../GlobalCapture/GlobalCapture.tsx'
import { useServerEvents } from '../../lib/events.ts'
import './AppShell.scss'

export function AppShell() {
  useServerEvents()

  return (
    <div className="app-shell flex w-full">
      <Sidebar />
      <main className="app-shell__main flex-1 min-w-0">
        <Outlet />
      </main>
      <GlobalCapture />
    </div>
  )
}
