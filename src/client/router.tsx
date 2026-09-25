import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppShell } from './components/AppShell/AppShell.tsx'
import { InboxView } from './features/inbox/InboxView.tsx'
import { LibraryView } from './features/library/LibraryView.tsx'
import { ProjectsView } from './features/projects/ProjectsView.tsx'
import { ProjectView } from './features/project/ProjectView.tsx'
import { IdeasView } from './features/ideas/IdeasView.tsx'
import { DraftsView } from './features/drafts/DraftsView.tsx'
import { CalendarView } from './features/calendar/CalendarView.tsx'
import { SettingsView } from './features/settings/SettingsView.tsx'

const rootRoute = createRootRoute({ component: AppShell })

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  beforeLoad: () => {
    throw redirect({ to: '/inbox' })
  },
})

const inboxRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/inbox',
  component: InboxView,
})
const libraryRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/library',
  component: LibraryView,
})
const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsView,
})
const projectRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects/$slug',
  component: ProjectView,
})
const ideasRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/ideas',
  component: IdeasView,
})
const draftsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drafts',
  component: DraftsView,
})
const calendarRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/calendar',
  component: CalendarView,
})
const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsView,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  inboxRoute,
  libraryRoute,
  projectsRoute,
  projectRoute,
  ideasRoute,
  draftsRoute,
  calendarRoute,
  settingsRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
