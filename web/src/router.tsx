import type { EnsureQueryDataOptions, QueryClient } from '@tanstack/react-query'
import { createRootRouteWithContext, createRoute, createRouter, redirect, type RouterHistory } from '@tanstack/react-router'
import { AppError } from './components/app-error'
import { AppNotFound } from './components/app-not-found'
import { AppShell } from './components/app-shell'
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
import { DeploymentsRoute } from './routes/deployments'
import { ConnectorsRoute } from './routes/connectors'
import { NotificationsRoute } from './routes/notifications'
import { AuditRoute } from './routes/audit'
import { parseDeploymentsSearch, parseProjectSearch } from './lib/route-search'

type RouterContext = { queryClient: QueryClient }

// Loaders start every query a page needs in parallel, before it renders, so
// components can read them with useSuspenseQuery without waterfalls.
function load(...queries: Array<{ queryKey: readonly unknown[] }>) {
  return ({ context }: { context: RouterContext }) => Promise.all(queries.map((query) => context.queryClient.ensureQueryData(query as EnsureQueryDataOptions)))
}

const rootRoute = createRootRouteWithContext<RouterContext>()({
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
})

// Everything except /login lives under this pathless layout, which renders the
// shell and redirects unauthenticated visitors to the login page.
const appRoute = createRoute({
  getParentRoute: () => rootRoute,
  id: 'app',
  component: AppShell,
  beforeLoad: async ({ context }) => {
    const session = await context.queryClient.ensureQueryData(sessionQuery)
    if (!session.authenticated) throw redirect({ to: '/login' })
  },
})

// Each route is its own const: routes created inline inside addChildren()
// lose their types, which silently turns every route id and search into any.
const loginRoute = createRoute({ getParentRoute: () => rootRoute, path: '/login', component: LoginRoute })
const indexRoute = createRoute({ getParentRoute: () => appRoute, path: '/', beforeLoad: () => { throw redirect({ to: '/projects' }) } })
const projectsRoute = createRoute({ getParentRoute: () => appRoute, path: '/projects', component: ProjectsRoute, loader: load(projectsQuery, environmentsQuery, applicationsQuery, deploymentsQuery) })
const projectRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/projects/$projectId',
  component: ProjectDetailRoute,
  validateSearch: parseProjectSearch,
  loader: load(projectsQuery, environmentsQuery, applicationsQuery, deploymentsQuery, buildRunsQuery, serversQuery, containerRegistriesQuery, proxyRoutesQuery, githubRepositoriesQuery, githubStatusQuery),
})
// The service drawer can open here too, so preload what it reads.
const deploymentsRoute = createRoute({
  getParentRoute: () => appRoute,
  path: '/deployments',
  component: DeploymentsRoute,
  validateSearch: parseDeploymentsSearch,
  loader: load(deploymentsQuery, applicationsQuery, projectsQuery, environmentsQuery, githubRepositoriesQuery, buildRunsQuery, proxyRoutesQuery, serversQuery),
})
const serversRoute = createRoute({ getParentRoute: () => appRoute, path: '/servers', component: ServersRoute, loader: load(serversQuery) })
const notificationsRoute = createRoute({ getParentRoute: () => appRoute, path: '/notifications', component: NotificationsRoute, loader: load(connectorsQuery) })
const connectorsRoute = createRoute({ getParentRoute: () => appRoute, path: '/connectors', component: ConnectorsRoute, loader: load(githubStatusQuery, dopplerStatusQuery, githubRepositoriesQuery, containerRegistriesQuery, connectorsQuery) })
const auditRoute = createRoute({ getParentRoute: () => appRoute, path: '/audit', component: AuditRoute, loader: load(auditEventsQuery) })

const routeTree = rootRoute.addChildren([
  loginRoute,
  appRoute.addChildren([indexRoute, projectsRoute, projectRoute, deploymentsRoute, serversRoute, notificationsRoute, connectorsRoute, auditRoute]),
])

export function createAppRouter(queryClient: QueryClient, history?: RouterHistory) {
  return createRouter({
    routeTree,
    history,
    context: { queryClient },
    // Start loading a page's code and data when the user hovers or focuses its
    // link. React Query owns staleness, so always re-run loaders
    // (ensureQueryData dedupes).
    defaultPreload: 'intent',
    defaultPreloadStaleTime: 0,
  })
}

declare module '@tanstack/react-router' {
  interface Register {
    router: ReturnType<typeof createAppRouter>
  }
}
