// URL search params for routes that open the service drawer. The router
// validates these, so components read typed values with Route.useSearch().

export const serviceTabs = ['deployments', 'variables', 'metrics', 'console', 'settings'] as const
export const deploymentTabs = ['details', 'build-logs', 'deploy-logs'] as const
export type ServiceTab = typeof serviceTabs[number]
export type DeploymentTab = typeof deploymentTabs[number]

// Which service, deployment, and tab the drawer shows. `view` is a service
// tab when no deployment is open and a deployment tab when one is.
export type DrawerSearch = {
  service?: string
  deployment?: string
  view?: ServiceTab | DeploymentTab
}

export type ProjectSearch = DrawerSearch & {
  environment?: string
}

export type DeploymentsSearch = DrawerSearch & {
  project?: string
}

function text(value: unknown): string | undefined {
  return typeof value === 'string' && value ? value : undefined
}

function view(value: unknown): DrawerSearch['view'] {
  return [...serviceTabs, ...deploymentTabs].find((tab) => tab === value)
}

export function parseProjectSearch(search: Record<string, unknown>): ProjectSearch {
  return { environment: text(search.environment), service: text(search.service), deployment: text(search.deployment), view: view(search.view) }
}

export function parseDeploymentsSearch(search: Record<string, unknown>): DeploymentsSearch {
  return { project: text(search.project), service: text(search.service), deployment: text(search.deployment), view: view(search.view) }
}
