export type Server = {
  id: string
  name: string
  hostname: string
  ssh_user: string
  ssh_port: number
  ssh_key_path: string | null
  proxy_type: 'caddy' | 'traefik' | 'none'
  status: 'healthy' | 'degraded' | 'unreachable' | 'unknown'
  cpu_usage: number | null
  memory_usage: number | null
  disk_usage: number | null
  last_checked_at: string | null
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
}

export type Deployment = {
  id: string
  application_id: string
  server_id: string
  trigger: 'manual' | 'github_push' | 'connector_sync' | 'retry'
  strategy: 'rolling' | 'blue_green'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  commit_sha: string | null
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
  actor?: string
}

export type CreateProxyRouteInput = {
  server_id?: string
  application_id?: string
  domain: string
  upstream_url: string
  tls_enabled: boolean
}

export type CreateServerInput = {
  name: string
  hostname: string
  ssh_user?: string
  ssh_port?: number
  ssh_key_path: string
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

export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, {
    headers: { 'Content-Type': 'application/json', ...init?.headers },
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

export function createApplication(input: CreateApplicationInput) {
  return api<Application>('/api/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createProject(input: CreateProjectInput) {
  return api<Project>('/api/projects', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createEnvironment(input: CreateEnvironmentInput) {
  return api<Environment>('/api/environments', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function createProxyRoute(input: CreateProxyRouteInput) {
  return api<ProxyRoute>('/api/proxy-routes', {
    method: 'POST',
    body: JSON.stringify(input),
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
