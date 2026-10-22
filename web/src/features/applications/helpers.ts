import type { Application, ComposeService, Deployment, DeploymentSlot, Environment, GitHubRepository, ProjectRuntimeVariable, ProxyRoute } from '../../lib/api'
import { hasControlCharacters } from '../../lib/validation'

export function normalizeProjectRuntimeVariables(variables: ProjectRuntimeVariable[]): ProjectRuntimeVariable[] {
  const normalized = variables.map((variable) => ({ key: variable.key.trim(), value: variable.value }))
  const keys = new Set<string>()
  for (const variable of normalized) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key) || variable.key.length > 128) throw new Error('Variable keys must use letters, numbers, and underscores, and cannot start with a number.')
    if (keys.has(variable.key)) throw new Error(`Variable ${variable.key} is duplicated.`)
    if (variable.value.length > 8192 || hasControlCharacters(variable.value)) throw new Error(`Variable ${variable.key} contains an unsupported value.`)
    keys.add(variable.key)
  }
  return normalized
}

export function applicationComposeServices(application: Application): ComposeService[] {
  return application.compose_services ?? []
}

export function proxyRouteURL(route: ProxyRoute): string {
  return `${route.tls_enabled === false ? 'http' : 'https'}://${route.domain}`
}

export function composeContainerPorts(service: ComposeService, routes: ProxyRoute[] = []): string {
  const ports = [
    ...(service.ports ?? []).map((port) => `:${port.container_port}/${port.protocol ?? 'tcp'}`),
    ...routes.flatMap((route) => route.container_port ? [`:${route.container_port}/tcp`] : []),
  ]
  return [...new Set(ports)].join(', ') || 'none'
}

function composePublishedPorts(service: ComposeService): string {
  return service.ports?.filter((port) => port.published_port).map((port) => `127.0.0.1:${port.published_port}`).join(', ') || ''
}

export function routeTargets(routes: ProxyRoute[], field: 'upstream_url' | 'blue_upstream_url' | 'green_upstream_url'): string {
  const values = [...new Set(routes.flatMap((route) => route[field] ? [route[field]] : []))]
  return values.join(', ') || 'not published'
}

export function activeServiceTargets(service: ComposeService, routes: ProxyRoute[]): string {
  return routes.length > 0 ? routeTargets(routes, 'upstream_url') : composePublishedPorts(service) || 'private'
}

export function environmentOrder(environments: Environment[]): Environment[] {
  const rank = { production: 0, development: 1, preview: 2 }
  return [...environments].sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
}

export function newestFirst<T extends { created_at: string }>(items: T[]): T[] {
  return [...items].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at))
}

export function githubRepositoryForApplication(application: Pick<Application, 'id' | 'repository_url'>, repositories: GitHubRepository[]): GitHubRepository | undefined {
  return repositories.find((repository) => repository.application_id === application.id)
    ?? repositories.find((repository) => !repository.application_id && repository.clone_url === application.repository_url)
}

// A `select` for list queries: keep only the rows that belong to one service.
export function forApplication(applicationID: string) {
  return <T extends { application_id: string | null }>(items: T[]): T[] => items.filter((item) => item.application_id === applicationID)
}

// The live slot wins; before the first slot exists, fall back to the newest success.
export function activeDeploymentID(slots: DeploymentSlot[], deployments: Deployment[]): string | undefined {
  return slots.find((slot) => slot.status === 'active')?.deployment_id
    ?? newestFirst(deployments).find((deployment) => deployment.status === 'succeeded')?.id
    ?? undefined
}

export type ConfigurationSnapshot = {
  application_revision?: number
  project_revision?: number
  repository_url?: string | null
  branch?: string
  compose_path?: string
  health_check_url?: string | null
  doppler_project?: string | null
  doppler_config?: string | null
  configuration_state?: {
    application?: { compose_services?: ComposeService[] }
    project_variables?: ProjectRuntimeVariable[]
    service_runtime_configs?: SnapshotServiceConfig[]
  }
}

export type SnapshotServiceConfig = {
  compose_service: string
  doppler_project?: string | null
  doppler_config?: string | null
  variables?: ProjectRuntimeVariable[]
}

export function deploymentConfigurationSnapshot(deployment: Deployment): ConfigurationSnapshot {
  return (deployment.configuration_snapshot ?? {}) as ConfigurationSnapshot
}

export function repositoryDisplayName(value: string | null | undefined): string {
  return value ? value.replace(/^git@github\.com:/, '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') : 'Manual compose source'
}

export function deploymentDurationSeconds(deployment: Deployment): number | undefined {
  const start = deployment.started_at ?? deployment.created_at
  const end = deployment.finished_at ?? (deployment.status === 'running' ? new Date().toISOString() : undefined)
  if (!start || !end) return undefined
  const milliseconds = Date.parse(end) - Date.parse(start)
  return Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds / 1000)) : undefined
}

export function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}
