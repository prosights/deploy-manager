export type Server = {
  id: string
  name: string
  hostname: string
  ssh_user: string
  ssh_port: number
  ssh_key_path: string | null
  connection_mode: 'direct_ssh' | 'tailscale_ssh' | 'cloud_tunnel'
  proxy_type: 'caddy' | 'traefik' | 'none'
  status: 'healthy' | 'degraded' | 'unreachable' | 'unknown'
  cpu_usage: number | null
  memory_usage: number | null
  disk_usage: number | null
  last_checked_at: string | null
}

export type TailscaleDevice = {
  name: string
  host: string
  dns_name: string
  os: string
  online: boolean
  tags: string[]
  last_seen?: string
}

export type TailscaleDevicesResponse = {
  available: boolean
  error?: string
  devices: TailscaleDevice[]
}

export type DockerStatus = {
  host: string
  api_version: string
  os_type: string
}

export type ServerCheckResponse = {
  server: Server
  ssh_ok: boolean
  docker_ok: boolean
  docker?: DockerStatus
  error?: string
  docker_error?: string
}

export type ServerCommandResponse = {
  output: string
  error?: string
}

export type Application = {
  id: string
  environment_id: string
  server_id: string
  name: string
  repository_url: string | null
  branch: string
  compose_path: string
  remote_directory: string
  domain: string | null
  health_check_url: string | null
  doppler_project: string | null
  doppler_config: string | null
  status: string
  current_version: string | null
  target_version: string | null
  server_name: string
  environment_name: string
  environment_slug: string
  environment_kind: 'production' | 'development' | 'preview'
  environment_is_ephemeral: boolean
  project_id: string
  project_name: string
  project_slug: string
  default_registry_id: string | null
  default_registry_name: string | null
}

export type Deployment = {
  id: string
  application_id: string
  server_id: string
  trigger: 'manual' | 'github_push' | 'connector_sync' | 'retry' | 'rollback'
  strategy: 'rolling' | 'blue_green'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  commit_sha: string | null
  image_ref: string | null
  image_digest: string | null
  actor: string | null
  application_name?: string
  server_name?: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type DeploymentLog = {
  id?: number
  deployment_id: string
  stream: 'stdout' | 'stderr' | 'system'
  message: string
  created_at?: string
}

export type ProxyRoute = {
  id: string
  server_id: string
  application_id: string | null
  domain: string
  upstream_url: string
  blue_upstream_url: string | null
  green_upstream_url: string | null
  tls_enabled: boolean
  status: 'pending' | 'applied' | 'failed'
  last_applied_at: string | null
  server_name: string
  proxy_type: 'caddy' | 'traefik' | 'none'
  application_name: string | null
}

export type CreateDeploymentInput = {
  application_id: string
  trigger?: string
  strategy?: 'rolling' | 'blue_green'
  commit_sha?: string
  image_ref?: string
  image_digest?: string
  actor?: string
}

export type ContainerRegistry = {
  id: string
  name: string
  provider: 'gcp_artifact_registry' | 'docker_hub' | 'ghcr' | 'ecr' | 'custom'
  registry_host: string
  namespace: string
  repository: string
  default_image: string
  enabled: boolean
  created_at: string
  updated_at: string
}

export type UpsertContainerRegistryInput = {
  name: string
  provider: ContainerRegistry['provider']
  registry_host: string
  namespace?: string
  repository: string
  default_image?: string
  enabled: boolean
}

export type CreateProxyRouteInput = {
  server_id?: string
  application_id?: string
  domain: string
  upstream_url: string
  blue_upstream_url?: string
  green_upstream_url?: string
  tls_enabled: boolean
}

export type CreateServerInput = {
  name: string
  hostname: string
  ssh_user?: string
  ssh_port?: number
  ssh_key_path: string
  connection_mode?: Server['connection_mode']
  proxy_type?: 'caddy' | 'traefik' | 'none'
}

export type CreateApplicationInput = {
  environment_id: string
  server_id: string
  name: string
  repository_url?: string
  branch?: string
  compose_path?: string
  remote_directory: string
  domain?: string
  health_check_url?: string
  doppler_project?: string
  doppler_config?: string
}

export type Project = {
  id: string
  name: string
  slug: string
  description: string
  default_registry_id: string | null
  default_registry_name?: string | null
  created_at: string
  updated_at: string
}

export type Environment = {
  id: string
  project_id: string
  name: string
  slug: string
  kind: 'production' | 'development' | 'preview'
  is_ephemeral: boolean
  pull_request_number: number | null
  branch: string | null
  expires_at: string | null
  created_at: string
  updated_at: string
  project_name?: string
  project_slug?: string
}

export type CreateProjectInput = {
  name: string
  slug: string
  description?: string
}

export type UpdateProjectInput = {
  name: string
  slug: string
  description?: string
}

export type CreateEnvironmentInput = {
  project_id: string
  name: string
  slug: string
  kind: 'production' | 'development' | 'preview'
  is_ephemeral?: boolean
  pull_request_number?: number
  branch?: string
  expires_at?: string
}

export type Credential = {
  id: string
  name: string
  provider: string
  external_ref: string
  credential_type: string
  status: string
  permission_count: number
  usage_count: number
  last_seen_at: string | null
}

export type CredentialPermission = {
  id: string
  credential_id: string
  resource_type: string
  resource_name: string
  permission: string
  source: string
  created_at: string
}

export type CredentialUsage = {
  id: string
  credential_id: string
  used_by_type: string
  used_by_name: string
  usage_context: string
  created_at: string
}

export type CredentialDetail = {
  credential: Credential
  permissions: CredentialPermission[]
  usages: CredentialUsage[]
}

export type CredentialInventoryInput = {
  credentials: Array<{
    name: string
    provider: string
    external_ref: string
    credential_type: string
    status?: string
    permissions?: Array<{
      resource_type: string
      resource_name: string
      permission: string
      source?: string
    }>
    usages?: Array<{
      used_by_type: string
      used_by_name: string
      usage_context: string
    }>
  }>
}

export type CredentialInventoryResponse = {
  credentials: Credential[]
  count: number
}

export type AuditEvent = {
  id: number
  actor: string
  action: string
  target_type: string
  target_id: string
  target_name: string
  metadata: Record<string, unknown>
  created_at: string
}

export type ConnectorAccount = {
  id: string
  provider: string
  name: string
  enabled: boolean
  config?: Record<string, unknown>
  last_sync_status: string | null
  last_sync_message: string | null
  last_synced_at: string | null
}

export type ConnectorSyncResponse = {
  connector: ConnectorAccount
  count: number
}

export type UpsertConnectorInput = {
  provider: string
  name: string
  enabled: boolean
  config: Record<string, unknown>
}

export type InstanceSettings = {
  name: string
  short_name: string
  meta_description: string
  logo_url: string
  favicon_url: string
  primary_color: string
  docs_url: string
}

export type UpdateSettingsInput = {
  name: string
  short_name: string
  meta_description: string
  logo_url: string
  favicon_url: string
  primary_color: string
  docs_url: string
}

export class ApiError extends Error {
  constructor(
    message: string,
    readonly status: number,
    readonly path: string,
  ) {
    super(message)
    this.name = 'ApiError'
  }
}

export const apiToken: string = import.meta.env.VITE_API_TOKEN ?? ''

function authHeaders(): Record<string, string> {
  return apiToken ? { Authorization: `Bearer ${apiToken}` } : {}
}

// withAccessToken appends the access_token query param used to authenticate
// EventSource (SSE) connections, which cannot set request headers.
export function withAccessToken(path: string): string {
  if (!apiToken) {
    return path
  }
  const separator = path.includes('?') ? '&' : '?'
  return `${path}${separator}access_token=${encodeURIComponent(apiToken)}`
}

export function webSocketURL(path: string): string {
  const authenticatedPath = withAccessToken(path)
  const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:'
  return `${protocol}//${window.location.host}${authenticatedPath}`
}

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...authHeaders(), ...init?.headers },
    ...init,
  })
  if (!response.ok) {
    throw new ApiError(await errorMessage(response), response.status, path)
  }
  if (response.status === 204) {
    return undefined as T
  }
  const text = await response.text()
  if (!text.trim()) {
    return undefined as T
  }
  return JSON.parse(text) as T
}

async function errorMessage(response: Response): Promise<string> {
  const fallback = response.statusText || 'Request failed'
  const text = await response.text().catch(() => '')
  if (!text.trim()) {
    return fallback
  }
  try {
    const payload = JSON.parse(text) as { error?: unknown }
    return typeof payload.error === 'string' && payload.error.trim() ? payload.error : fallback
  } catch {
    return text.trim() || fallback
  }
}

export function createDeployment(input: CreateDeploymentInput) {
  return api<Deployment>('/api/deployments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function cancelDeployment(deploymentID: string) {
  return api<Deployment>(`/api/deployments/${deploymentID}/cancel`, {
    method: 'POST',
  })
}

export function retryDeployment(deploymentID: string) {
  return api<Deployment>(`/api/deployments/${deploymentID}/retry`, {
    method: 'POST',
  })
}

export function rollbackApplication(applicationID: string) {
  return api<Deployment>(`/api/applications/${applicationID}/rollback`, {
    method: 'POST',
  })
}

export function upsertContainerRegistry(input: UpsertContainerRegistryInput) {
  return api<ContainerRegistry>('/api/container-registries', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateProjectRegistry(projectID: string, defaultRegistryID?: string) {
  return api<Project>(`/api/projects/${projectID}/registry`, {
    method: 'PATCH',
    body: JSON.stringify({ default_registry_id: defaultRegistryID || null }),
  })
}

export function listDeploymentLogs(deploymentID: string, init?: RequestInit) {
  return api<DeploymentLog[]>(`/api/deployments/${deploymentID}/logs`, init)
}

export function createServer(input: CreateServerInput) {
  return api<Server>('/api/servers', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function checkServer(serverID: string) {
  return api<ServerCheckResponse>(`/api/servers/${serverID}/check`, {
    method: 'POST',
  })
}

export function runServerCommand(serverID: string, command: string) {
  return api<ServerCommandResponse>(`/api/servers/${serverID}/commands`, {
    method: 'POST',
    body: JSON.stringify({ command }),
  })
}

export function createApplication(input: CreateApplicationInput) {
  return api<Application>('/api/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteApplication(applicationID: string) {
  return api<void>(`/api/applications/${applicationID}`, {
    method: 'DELETE',
  })
}

export function createProject(input: CreateProjectInput) {
  return api<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateProject(projectID: string, input: UpdateProjectInput) {
  return api<Project>(`/api/projects/${projectID}`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function deleteProject(projectID: string) {
  return api<void>(`/api/projects/${projectID}`, {
    method: 'DELETE',
  })
}

export function createEnvironment(input: CreateEnvironmentInput) {
  return api<Environment>('/api/environments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteEnvironment(environmentID: string) {
  return api<void>(`/api/environments/${environmentID}`, {
    method: 'DELETE',
  })
}

export function createProxyRoute(input: CreateProxyRouteInput) {
  return api<ProxyRoute>('/api/proxy-routes', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function deleteProxyRoute(routeID: string) {
  return api<void>(`/api/proxy-routes/${routeID}`, {
    method: 'DELETE',
  })
}

export function applyProxyRoute(routeID: string) {
  return api<ProxyRoute>(`/api/proxy-routes/${routeID}/apply`, {
    method: 'POST',
  })
}

export function upsertConnector(input: UpsertConnectorInput) {
  return api<ConnectorAccount>('/api/connectors', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function syncConnector(connectorID: string) {
  return api<ConnectorSyncResponse>(`/api/connectors/${connectorID}/sync`, {
    method: 'POST',
  })
}

export function syncCredentialInventory(input: CredentialInventoryInput) {
  return api<CredentialInventoryResponse>('/api/credentials/inventory', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateSettings(input: UpdateSettingsInput) {
  return api<InstanceSettings>('/api/settings', {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}
