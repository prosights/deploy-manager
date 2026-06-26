import { createRootRoute, createRoute, createRouter } from '@tanstack/react-router'
import { AppError } from './components/app-error'
import { AppNotFound } from './components/app-not-found'
import { AppShell } from './components/app-shell'
import { OverviewRoute } from './routes/overview'
import { ProjectsRoute } from './routes/projects'
import { ServersRoute } from './routes/servers'
import { ApplicationsRoute } from './routes/applications'
import { DeploymentsRoute } from './routes/deployments'
import { CredentialsRoute } from './routes/credentials'
import { ConnectorsRoute } from './routes/connectors'
import { ProxyRoute } from './routes/proxy'
import { AuditRoute } from './routes/audit'
import { SettingsRoute } from './routes/settings'

const rootRoute = createRootRoute({
  component: AppShell,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
})

const indexRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/',
  component: OverviewRoute,
})

const serversRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/servers',
  component: ServersRoute,
})

const projectsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/projects',
  component: ProjectsRoute,
})

const applicationsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/applications',
  component: ApplicationsRoute,
})

const deploymentsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/deployments',
  component: DeploymentsRoute,
})

const credentialsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/credentials',
  component: CredentialsRoute,
})

const connectorsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/connectors',
  component: ConnectorsRoute,
})

const proxyRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/proxy',
  component: ProxyRoute,
})

const auditRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/audit',
  component: AuditRoute,
})

const settingsRoute = createRoute({
  getParentRoute: () => rootRoute,
  path: '/settings',
  component: SettingsRoute,
})

const routeTree = rootRoute.addChildren([indexRoute, projectsRoute, serversRoute, applicationsRoute, deploymentsRoute, credentialsRoute, connectorsRoute, proxyRoute, auditRoute, settingsRoute])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
