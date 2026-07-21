import { queryOptions } from '@tanstack/react-query'
import { api, getDopplerStatus, getGitHubRepositoryCommit, getGitHubStatus, listApplicationServiceRuntimeConfigs, listBuildRuns, listDeploymentLogs, listDeploymentSlots, listDopplerConfigs, listDopplerProjects, listGitHubRepositories, type Application, type ApplicationServiceRuntimeConfig, type AppVersion, type AuditEvent, type BuildRun, type ConnectorAccount, type ContainerRegistry, type Deployment, type DeploymentSlot, type DopplerIntegrationStatus, type Environment, type GitHubIntegrationStatus, type GitHubRepository, type Project, type ProxyRoute, type Server, type TailscaleDevicesResponse } from './api'

export const appVersionQuery = queryOptions({
  queryKey: ['app-version'],
  queryFn: ({ signal }) => api<AppVersion>('/api/version', { signal }),
})

export const auditEventsQuery = queryOptions({
  queryKey: ['audit-events'],
  queryFn: ({ signal }) => api<AuditEvent[]>('/api/audit-events?limit=100', { signal }),
})

export const serversQuery = queryOptions({
  queryKey: ['servers'],
  queryFn: ({ signal }) => api<Server[]>('/api/servers', { signal }),
})

export const tailscaleDevicesQuery = queryOptions({
  queryKey: ['tailscale-devices'],
  queryFn: ({ signal }) => api<TailscaleDevicesResponse>('/api/tailscale/devices', { signal }),
})

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: ({ signal }) => api<Project[]>('/api/projects', { signal }),
})

export const environmentsQuery = queryOptions({
  queryKey: ['environments'],
  queryFn: ({ signal }) => api<Environment[]>('/api/environments', { signal }),
})

export const applicationsQuery = queryOptions({
  queryKey: ['applications'],
  queryFn: ({ signal }) => api<Application[]>('/api/applications', { signal }),
  refetchInterval: 5_000,
})

export const deploymentsQuery = queryOptions({
  queryKey: ['deployments'],
  queryFn: ({ signal }) => api<Deployment[]>('/api/deployments?limit=200', { signal }),
  refetchInterval: 5_000,
})

export const buildRunsQuery = queryOptions({
  queryKey: ['build-runs'],
  queryFn: ({ signal }) => listBuildRuns({ signal }) as Promise<BuildRun[]>,
  refetchInterval: 5_000,
})

export function deploymentSlotsQuery(applicationID: string) {
  return queryOptions({
    queryKey: ['applications', applicationID, 'deployment-slots'],
    queryFn: ({ signal }) => listDeploymentSlots(applicationID, { signal }) as Promise<DeploymentSlot[]>,
    refetchInterval: 5_000,
  })
}

export function applicationServiceRuntimeConfigsQuery(applicationID: string) {
  return queryOptions({
    queryKey: ['applications', applicationID, 'service-variables'],
    queryFn: ({ signal }) => listApplicationServiceRuntimeConfigs(applicationID, { signal }) as Promise<ApplicationServiceRuntimeConfig[]>,
  })
}

export function deploymentLogsQuery(deploymentID: string) {
  return queryOptions({
    queryKey: ['deployments', deploymentID, 'logs'],
    queryFn: ({ signal }) => listDeploymentLogs(deploymentID, { signal }),
  })
}

export const connectorsQuery = queryOptions({
  queryKey: ['connectors'],
  queryFn: ({ signal }) => api<ConnectorAccount[]>('/api/connectors', { signal }),
})

export const githubRepositoriesQuery = queryOptions({
  queryKey: ['github-repositories'],
  queryFn: ({ signal }) => listGitHubRepositories({ signal }) as Promise<GitHubRepository[]>,
})

export function githubCommitQuery(connectorID: string, repository: string, sha: string) {
  return queryOptions({
    queryKey: ['github-commit', connectorID, repository, sha],
    queryFn: ({ signal }) => getGitHubRepositoryCommit({ connector_id: connectorID, repository, sha }, { signal }),
    enabled: Boolean(connectorID && repository && sha),
    refetchOnMount: 'always',
  })
}

export const githubStatusQuery = queryOptions({
  queryKey: ['github-status'],
  queryFn: ({ signal }) => getGitHubStatus({ signal }) as Promise<GitHubIntegrationStatus>,
})

export const dopplerStatusQuery = queryOptions({
  queryKey: ['doppler-status'],
  queryFn: ({ signal }) => getDopplerStatus({ signal }) as Promise<DopplerIntegrationStatus>,
})

export const dopplerProjectsQuery = queryOptions({
  queryKey: ['doppler-projects'],
  queryFn: ({ signal }) => listDopplerProjects({ signal }),
  staleTime: 60_000,
})

export function dopplerConfigsQuery(project: string) {
  return queryOptions({
    queryKey: ['doppler-configs', project],
    queryFn: ({ signal }) => listDopplerConfigs(project, { signal }),
    enabled: Boolean(project),
    staleTime: 60_000,
  })
}

export const containerRegistriesQuery = queryOptions({
  queryKey: ['container-registries'],
  queryFn: ({ signal }) => api<ContainerRegistry[]>('/api/container-registries', { signal }),
})

export const proxyRoutesQuery = queryOptions({
  queryKey: ['proxy-routes'],
  queryFn: ({ signal }) => api<ProxyRoute[]>('/api/proxy-routes', { signal }),
})
