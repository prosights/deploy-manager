// Every read the UI makes. Components use these with useSuspenseQuery/useQuery;
// route loaders preload them. Writes live in api.ts.
import { queryOptions } from '@tanstack/react-query'
import {
  api,
  checkServer,
  runServerCommand,
  type Application,
  type ApplicationServiceRuntimeConfig,
  type AppVersion,
  type AuditEvent,
  type BuildRun,
  type ConnectorAccount,
  type ContainerRegistry,
  type Deployment,
  type DeploymentLog,
  type DeploymentSlot,
  type DopplerIntegrationStatus,
  type Environment,
  type GitHubCommitMetadata,
  type GitHubDetectedServicesResponse,
  type GitHubIntegrationStatus,
  type GitHubRepository,
  type GitHubRepositoryBranchesResponse,
  type GitHubRepositoryCompose,
  type Project,
  type ProjectRuntimeVariablesResponse,
  type ProxyRoute,
  type Server,
  type ServerDevUsersResponse,
  type TailscaleDevicesResponse,
} from './api'

export const sessionQuery = queryOptions({
  queryKey: ['session'],
  queryFn: ({ signal }) => api<{ authenticated: boolean }>('/api/session', { signal }),
})

export const appVersionQuery = queryOptions({
  queryKey: ['app-version'],
  queryFn: ({ signal }) => api<AppVersion>('/api/version', { signal }),
})

export const auditEventsQuery = queryOptions({
  queryKey: ['audit-events'],
  queryFn: ({ signal }) => api<AuditEvent[]>('/api/audit-events?limit=100', { signal }),
})

// Projects, environments, and services.

export const projectsQuery = queryOptions({
  queryKey: ['projects'],
  queryFn: ({ signal }) => api<Project[]>('/api/projects', { signal }),
})

export function projectVariablesQuery(projectID: string) {
  return queryOptions({
    queryKey: ['projects', projectID, 'variables'],
    queryFn: ({ signal }) => api<ProjectRuntimeVariablesResponse>(`/api/projects/${projectID}/variables`, { signal }),
  })
}

export const environmentsQuery = queryOptions({
  queryKey: ['environments'],
  queryFn: ({ signal }) => api<Environment[]>('/api/environments', { signal }),
})

export const applicationsQuery = queryOptions({
  queryKey: ['applications'],
  queryFn: ({ signal }) => api<Application[]>('/api/applications', { signal }),
  refetchInterval: 5_000,
})

export function applicationServiceVariablesQuery(applicationID: string) {
  return queryOptions({
    queryKey: ['applications', applicationID, 'service-variables'],
    queryFn: ({ signal }) => api<ApplicationServiceRuntimeConfig[]>(`/api/applications/${applicationID}/service-variables`, { signal }),
  })
}

export function deploymentSlotsQuery(applicationID: string) {
  return queryOptions({
    queryKey: ['applications', applicationID, 'deployment-slots'],
    queryFn: ({ signal }) => api<DeploymentSlot[]>(`/api/applications/${applicationID}/deployment-slots`, { signal }),
    refetchInterval: 5_000,
  })
}

export const proxyRoutesQuery = queryOptions({
  queryKey: ['proxy-routes'],
  queryFn: ({ signal }) => api<ProxyRoute[]>('/api/proxy-routes', { signal }),
})

// Deployments and builds.

export const deploymentsQuery = queryOptions({
  queryKey: ['deployments'],
  queryFn: ({ signal }) => api<Deployment[]>('/api/deployments?limit=200', { signal }),
  refetchInterval: 5_000,
})

export function deploymentLogsQuery(deploymentID: string) {
  return queryOptions({
    queryKey: ['deployments', deploymentID, 'logs'],
    queryFn: ({ signal }) => api<DeploymentLog[]>(`/api/deployments/${deploymentID}/logs`, { signal }),
  })
}

export const buildRunsQuery = queryOptions({
  queryKey: ['build-runs'],
  queryFn: ({ signal }) => api<BuildRun[]>('/api/builds?limit=100', { signal }),
  refetchInterval: 5_000,
})

// Servers.

export const serversQuery = queryOptions({
  queryKey: ['servers'],
  queryFn: ({ signal }) => api<Server[]>('/api/servers', { signal }),
})

// The check runs SSH and Docker probes on the server and records the result,
// so it is a POST, but the UI treats it as a polled read.
export function serverCheckQuery(serverID: string) {
  return queryOptions({
    queryKey: ['servers', serverID, 'check'],
    queryFn: () => checkServer(serverID),
    refetchInterval: 30_000,
  })
}

export function serverDevUsersQuery(serverID: string) {
  return queryOptions({
    queryKey: ['servers', serverID, 'dev-users'],
    queryFn: ({ signal }) => api<ServerDevUsersResponse>(`/api/servers/${serverID}/dev-users`, { signal }),
  })
}

export function serverCommandQuery(serverID: string, command: string) {
  return queryOptions({
    queryKey: ['servers', serverID, 'command', command],
    queryFn: async () => {
      const response = await runServerCommand(serverID, command)
      if (response.error) throw new Error(response.error)
      return response.output
    },
  })
}

export const tailscaleDevicesQuery = queryOptions({
  queryKey: ['tailscale-devices'],
  queryFn: ({ signal }) => api<TailscaleDevicesResponse>('/api/tailscale/devices', { signal }),
})

// Connectors and integrations.

export const connectorsQuery = queryOptions({
  queryKey: ['connectors'],
  queryFn: ({ signal }) => api<ConnectorAccount[]>('/api/connectors', { signal }),
})

export const containerRegistriesQuery = queryOptions({
  queryKey: ['container-registries'],
  queryFn: ({ signal }) => api<ContainerRegistry[]>('/api/container-registries', { signal }),
})

export const githubStatusQuery = queryOptions({
  queryKey: ['github-status'],
  queryFn: ({ signal }) => api<GitHubIntegrationStatus>('/api/github/status', { signal }),
})

export const githubRepositoriesQuery = queryOptions({
  queryKey: ['github-repositories'],
  queryFn: ({ signal }) => api<GitHubRepository[]>('/api/github/repositories', { signal }),
})

export function githubBranchesQuery(connectorID: string, repository: string) {
  return queryOptions({
    queryKey: ['github-repositories', connectorID, repository, 'branches'],
    queryFn: ({ signal }) => api<GitHubRepositoryBranchesResponse>(`/api/github/repositories/branches?${new URLSearchParams({ connector_id: connectorID, repository })}`, { signal }),
  })
}

export function githubCommitQuery(connectorID: string, repository: string, sha: string) {
  return queryOptions({
    queryKey: ['github-repositories', connectorID, repository, 'commit', sha],
    queryFn: ({ signal }) => api<GitHubCommitMetadata>(`/api/github/repositories/commit?${new URLSearchParams({ connector_id: connectorID, repository, sha })}`, { signal }),
    // A commit never changes.
    staleTime: Infinity,
  })
}

export function githubComposeServicesQuery(connectorID: string, repository: string, branch: string, root: string) {
  const params = new URLSearchParams({ connector_id: connectorID, repository, branch })
  if (root) params.set('root', root)
  return queryOptions({
    queryKey: ['github-repositories', connectorID, repository, 'detect', branch, root],
    queryFn: ({ signal }) => api<GitHubDetectedServicesResponse>(`/api/github/repositories/detect?${params}`, { signal }),
  })
}

export function githubComposeFileQuery(connectorID: string, repository: string, branch: string, path: string) {
  return queryOptions({
    queryKey: ['github-repositories', connectorID, repository, 'compose', branch, path],
    queryFn: ({ signal }) => api<GitHubRepositoryCompose>(`/api/github/repositories/compose?${new URLSearchParams({ connector_id: connectorID, repository, branch, path })}`, { signal }),
  })
}

export const dopplerStatusQuery = queryOptions({
  queryKey: ['doppler-status'],
  queryFn: ({ signal }) => api<DopplerIntegrationStatus>('/api/doppler/status', { signal }),
})

export const dopplerProjectsQuery = queryOptions({
  queryKey: ['doppler-projects'],
  queryFn: ({ signal }) => api<string[]>('/api/doppler/projects', { signal }),
})

export function dopplerConfigsQuery(project: string) {
  return queryOptions({
    queryKey: ['doppler-configs', project],
    queryFn: ({ signal }) => api<string[]>(`/api/doppler/configs?project=${encodeURIComponent(project)}`, { signal }),
  })
}
