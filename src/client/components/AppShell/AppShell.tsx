import { Outlet } from '@tanstack/react-router'
import { Sidebar } from '../Sidebar/Sidebar.tsx'
import './AppShell.scss'

export function AppShell() {
  return (
    <div className="app-shell flex w-full">
      <Sidebar />
      <main className="app-shell__main flex-1 min-w-0">
        <Outlet />
      </main>
    </div>
  )
}
