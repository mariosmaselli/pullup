import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppShell } from './components/AppShell/AppShell.tsx'
import { InboxView } from './features/inbox/InboxView.tsx'
import { LibraryView } from './features/library/LibraryView.tsx'
import { ProjectsView } from './features/projects/ProjectsView.tsx'
import { ProjectView } from './features/project/ProjectView.tsx'
import { IdeasView } from './features/ideas/IdeasView.tsx'
import { DraftsView } from './features/drafts/DraftsView.tsx'
import { DraftView } from './features/draft/DraftView.tsx'
import { CalendarView } from './features/calendar/CalendarView.tsx'
import { SettingsView } from './features/settings/SettingsView.tsx'
import { TemplatesView } from './features/templates/TemplatesView.tsx'
import { TemplateStudio } from './features/template/TemplateStudio.tsx'
import { TrashView } from './features/trash/TrashView.tsx'
import { foldedInto } from './lib/frame-templates.ts'

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
const draftRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/drafts/$id',
  component: DraftView,
  // Platforms the AI didn't write when this draft package was created.
  validateSearch: (search: Record<string, unknown>): { skipped?: string } => ({
    skipped: typeof search.skipped === 'string' ? search.skipped : undefined,
  }),
})
const templatesRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates',
  component: TemplatesView,
})
const templateRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/templates/$id',
  component: TemplateStudio,
  // Links to a template folded into Default (text-story, text-reveal…) open Default.
  beforeLoad: ({ params }) => {
    const id = foldedInto(params.id)
    if (id) throw redirect({ to: '/templates/$id', params: { id }, replace: true })
  },
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
const trashRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/trash',
  component: TrashView,
})

const routeTree = rootRoute.addChildren([
  indexRoute,
  inboxRoute,
  libraryRoute,
  projectsRoute,
  projectRoute,
  ideasRoute,
  draftsRoute,
  draftRoute,
  templatesRoute,
  templateRoute,
  calendarRoute,
  settingsRoute,
  trashRoute,
])

export const router = createRouter({ routeTree, defaultPreload: 'intent' })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
