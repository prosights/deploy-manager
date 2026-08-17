import type { EnsureQueryDataOptions } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter, redirect } from '@tanstack/react-router'
import { AppError } from './components/app-error'
import { AppNotFound } from './components/app-not-found'
import { AppShell } from './components/app-shell'
import { queryClient } from './lib/query-client'
import {
  applicationsQuery,
  auditEventsQuery,
  buildRunsQuery,
  connectorsQuery,
  containerRegistriesQuery,
  deploymentsQuery,
  dopplerStatusQuery,
  environmentsQuery,
  githubRepositoriesQuery,
  githubStatusQuery,
  projectsQuery,
  proxyRoutesQuery,
  serversQuery,
  sessionQuery,
} from './lib/queries'
import { LoginRoute } from './routes/login'
import { ProjectsRoute } from './routes/projects'
import { ProjectDetailRoute } from './routes/project-detail'
import { ServersRoute } from './routes/servers'
import { ApplicationsRoute } from './routes/applications'
import { DeploymentsRoute } from './routes/deployments'
import { ConnectorsRoute } from './routes/connectors'
import { NotificationsRoute } from './routes/notifications'
import { RegistriesRoute } from './routes/registries'
import { ProxyRoute } from './routes/proxy'
import { AuditRoute } from './routes/audit'

// Fetch a route's queries in the loader so navigation (and hover preloading)
// loads data in parallel with the shell instead of suspending after render.
function load(...queries: Array<{ queryKey: readonly unknown[] }>) {
  return () => Promise.all(queries.map((query) => queryClient.ensureQueryData(query as EnsureQueryDataOptions)))
}

const rootRoute = createRootRoute({
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
})

// Everything except /login lives under this pathless layout, which renders the
// shell and redirects unauthenticated visitors to the login page.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: async () => {
    const session = await queryClient.ensureQueryData(sessionQuery)
    if (!session.authenticated) throw redirect({ to: '/login' })
  },
  loader: load(projectsQuery, environmentsQuery),
})

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginRoute }),
  appRoute.addChildren([
    createRoute({ getParentRoute: () => appRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/projects' }) } }),
    createRoute({ getParentRoute: () => appRoute, path: '/projects', component: ProjectsRoute, loader: load(projectsQuery, environmentsQuery, applicationsQuery, deploymentsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/projects/$projectId', component: ProjectDetailRoute, loader: load(projectsQuery, environmentsQuery, applicationsQuery, deploymentsQuery, buildRunsQuery, serversQuery, containerRegistriesQuery, proxyRoutesQuery, githubRepositoriesQuery, githubStatusQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/servers', component: ServersRoute, loader: load(serversQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/applications', component: ApplicationsRoute, loader: load(applicationsQuery, serversQuery, environmentsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/deployments', component: DeploymentsRoute, loader: load(deploymentsQuery, applicationsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/notifications', component: NotificationsRoute, loader: load(connectorsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/connectors', component: ConnectorsRoute, loader: load(githubStatusQuery, dopplerStatusQuery, githubRepositoriesQuery, buildRunsQuery, containerRegistriesQuery, connectorsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/registries', component: RegistriesRoute, loader: load(containerRegistriesQuery, projectsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/proxy', component: ProxyRoute, loader: load(proxyRoutesQuery, serversQuery, applicationsQuery) }),
    createRoute({ getParentRoute: () => appRoute, path: '/audit', component: AuditRoute, loader: load(auditEventsQuery) }),
  ]),
])

export const router = createRouter({
  routeTree,
  // Start loading a page's code and data when the user hovers or focuses its
  // link, so most navigations render instantly. React Query owns staleness,
  // so tell the router to always re-run loaders (ensureQueryData dedupes).
  defaultPreload: 'intent',
  defaultPreloadStaleTime: 0,
})

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
