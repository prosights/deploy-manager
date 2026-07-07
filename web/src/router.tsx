import type { EnsureQueryDataOptions } from '@tanstack/react-query'
import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
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
  credentialsQuery,
  deploymentsQuery,
  dopplerStatusQuery,
  environmentsQuery,
  githubRepositoriesQuery,
  githubStatusQuery,
  projectsQuery,
  proxyRoutesQuery,
  serversQuery,
  settingsQuery,
} from './lib/queries'
import { OverviewRoute } from './routes/overview'
import { ProjectsRoute } from './routes/projects'
import { ProjectDetailRoute } from './routes/project-detail'
import { ServersRoute } from './routes/servers'
import { ApplicationsRoute } from './routes/applications'
import { DeploymentsRoute } from './routes/deployments'
import { CredentialsRoute } from './routes/credentials'
import { ConnectorsRoute } from './routes/connectors'
import { NotificationsRoute } from './routes/notifications'
import { RegistriesRoute } from './routes/registries'
import { ProxyRoute } from './routes/proxy'
import { AuditRoute } from './routes/audit'
import { SettingsRoute } from './routes/settings'

// Fetch a route's queries in the loader so navigation (and hover preloading)
// loads data in parallel with the shell instead of suspending after render.
function load(...queries: Array<{ queryKey: readonly unknown[] }>) {
  return () => Promise.all(queries.map((query) => queryClient.ensureQueryData(query as EnsureQueryDataOptions)))
}

const rootRoute = createRootRoute({
  component: AppShell,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
  loader: load(settingsQuery, projectsQuery, environmentsQuery),
})

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewRoute, loader: load(serversQuery, applicationsQuery, deploymentsQuery, credentialsQuery, connectorsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsRoute, loader: load(projectsQuery, environmentsQuery, applicationsQuery, deploymentsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects/$projectId', component: ProjectDetailRoute, loader: load(projectsQuery, environmentsQuery, applicationsQuery, serversQuery, containerRegistriesQuery, proxyRoutesQuery, githubRepositoriesQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/servers', component: ServersRoute, loader: load(serversQuery, applicationsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/applications', component: ApplicationsRoute, loader: load(applicationsQuery, serversQuery, environmentsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/deployments', component: DeploymentsRoute, loader: load(deploymentsQuery, applicationsQuery, containerRegistriesQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/credentials', component: CredentialsRoute, loader: load(credentialsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/notifications', component: NotificationsRoute, loader: load(connectorsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/connectors', component: ConnectorsRoute, loader: load(githubStatusQuery, dopplerStatusQuery, githubRepositoriesQuery, buildRunsQuery, containerRegistriesQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/registries', component: RegistriesRoute, loader: load(containerRegistriesQuery, projectsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/proxy', component: ProxyRoute, loader: load(proxyRoutesQuery, serversQuery, applicationsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: AuditRoute, loader: load(auditEventsQuery) }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsRoute, loader: load(settingsQuery) }),
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
