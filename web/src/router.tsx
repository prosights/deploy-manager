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
import { NotificationsRoute } from './routes/notifications'
import { RegistriesRoute } from './routes/registries'
import { ProxyRoute } from './routes/proxy'
import { AuditRoute } from './routes/audit'
import { SettingsRoute } from './routes/settings'

const rootRoute = createRootRoute({
  component: AppShell,
  errorComponent: AppError,
  notFoundComponent: AppNotFound,
})

const routeTree = rootRoute.addChildren([
  createRoute({ getParentRoute: () => rootRoute, path: '/', component: OverviewRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/projects', component: ProjectsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/servers', component: ServersRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/applications', component: ApplicationsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/deployments', component: DeploymentsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/credentials', component: CredentialsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/notifications', component: NotificationsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/connectors', component: ConnectorsRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/registries', component: RegistriesRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/proxy', component: ProxyRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/audit', component: AuditRoute }),
  createRoute({ getParentRoute: () => rootRoute, path: '/settings', component: SettingsRoute }),
])

export const router = createRouter({ routeTree })

declare module '@tanstack/react-router' {
  interface Register {
    router: typeof router
  }
}
