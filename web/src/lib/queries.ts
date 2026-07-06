import { queryOptions } from '@tanstack/react-query'
import { api, getDopplerStatus, getGitHubStatus, listBuildRuns, listDeploymentLogs, listDeploymentSlots, listGitHubRepositories, type Application, type AuditEvent, type BuildRun, type ConnectorAccount, type ContainerRegistry, type Credential, type CredentialDetail, type Deployment, type DeploymentSlot, type DopplerIntegrationStatus, type Environment, type GitHubIntegrationStatus, type GitHubRepository, type InstanceSettings, type Project, type ProxyRoute, type Server, type TailscaleDevicesResponse } from './api'

export const settingsQuery = queryOptions({
  queryKey: ['settings'],
  queryFn: ({ signal }) => api<InstanceSettings>('/api/settings', { signal }),
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
})

export const deploymentsQuery = queryOptions({
  queryKey: ['deployments'],
  queryFn: ({ signal }) => api<Deployment[]>('/api/deployments?limit=200', { signal }),
})

export const buildRunsQuery = queryOptions({
  queryKey: ['build-runs'],
  queryFn: ({ signal }) => listBuildRuns({ signal }) as Promise<BuildRun[]>,
})

export function deploymentSlotsQuery(applicationID: string) {
  return queryOptions({
    queryKey: ['applications', applicationID, 'deployment-slots'],
    queryFn: ({ signal }) => listDeploymentSlots(applicationID, { signal }) as Promise<DeploymentSlot[]>,
  })
}

export function deploymentLogsQuery(deploymentID: string) {
  return queryOptions({
    queryKey: ['deployments', deploymentID, 'logs'],
    queryFn: ({ signal }) => listDeploymentLogs(deploymentID, { signal }),
  })
}

export const credentialsQuery = queryOptions({
  queryKey: ['credentials'],
  queryFn: ({ signal }) => api<Credential[]>('/api/credentials', { signal }),
})

export function credentialDetailQuery(credentialID: string) {
  return queryOptions({
    queryKey: ['credentials', credentialID],
    queryFn: ({ signal }) => api<CredentialDetail>(`/api/credentials/${credentialID}`, { signal }),
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

export const githubStatusQuery = queryOptions({
  queryKey: ['github-status'],
  queryFn: ({ signal }) => getGitHubStatus({ signal }) as Promise<GitHubIntegrationStatus>,
})

export const dopplerStatusQuery = queryOptions({
  queryKey: ['doppler-status'],
  queryFn: ({ signal }) => getDopplerStatus({ signal }) as Promise<DopplerIntegrationStatus>,
})

export const containerRegistriesQuery = queryOptions({
  queryKey: ['container-registries'],
  queryFn: ({ signal }) => api<ContainerRegistry[]>('/api/container-registries', { signal }),
})

export const proxyRoutesQuery = queryOptions({
  queryKey: ['proxy-routes'],
  queryFn: ({ signal }) => api<ProxyRoute[]>('/api/proxy-routes', { signal }),
})
