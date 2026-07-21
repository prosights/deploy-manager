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

export type ServerDevUsersResponse = {
  users: string[]
  path: string
  script_path: string
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
  github_auto_deploy: boolean
  configuration_revision: number
  deployed_configuration_revision: number
  deployed_project_configuration_revision: number
  compose_services?: ComposeService[] | string | null
  redeploy_required: boolean
}

export type ComposeServicePort = {
  container_port: number
  published_port?: number
  protocol?: string
  variable?: string
}

export type ComposeService = {
  name: string
  image?: string
  build_context?: string
  dockerfile?: string
  ports?: ComposeServicePort[]
  depends_on?: string[]
}

export type Deployment = {
  id: string
  application_id: string
  server_id: string
  trigger: 'manual' | 'github_push' | 'connector_sync' | 'retry' | 'rollback'
  strategy: 'rolling' | 'blue_green'
  status: 'queued' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  commit_sha: string | null
  commit_message?: string | null
  image_ref: string | null
  image_digest: string | null
  actor: string | null
  source_repository_url?: string | null
  source_branch?: string | null
  configuration_snapshot?: Record<string, unknown> | string | null
  application_name?: string
  server_name?: string
  environment_name?: string
  environment_slug?: string
  environment_kind?: 'production' | 'development' | 'preview'
  environment_is_ephemeral?: boolean
  project_id?: string
  project_name?: string
  project_slug?: string
  created_at: string
  started_at: string | null
  finished_at: string | null
}

export type DeploymentSlot = {
  id: string
  application_id: string
  server_id: string
  color: 'blue' | 'green' | string
  deployment_id: string | null
  image_ref: string
  image_digest: string | null
  status: 'active' | 'standby' | string
  promoted_at: string | null
  created_at: string
  updated_at: string
}

export type DeploymentLog = {
  id?: number
  deployment_id: string
  stream: 'stdout' | 'stderr' | 'system'
  message: string
  created_at?: string
}

export type BuildRun = {
  id: string
  provider: 'github_actions' | 'cloud_build'
  connector_id: string | null
  application_id: string | null
  repository: string
  branch: string
  workflow_id: string
  status: 'dispatched' | 'running' | 'succeeded' | 'failed' | 'cancelled'
  commit_sha: string | null
  image_ref: string | null
  image_digest: string | null
  external_url: string | null
  error_message: string | null
  started_at: string | null
  completed_at: string | null
  created_at: string
  updated_at: string
}

export type DopplerIntegrationStatus = {
  connector_configured: boolean
  cli_available: boolean
  ready: boolean
  missing: string[]
  message: string
}

export type ProxyRoute = {
  id: string
  server_id: string
  application_id: string | null
  domain: string
  upstream_url: string
  blue_upstream_url: string | null
  green_upstream_url: string | null
  compose_service?: string | null
  container_port?: number | null
  port_variable?: string | null
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
  strategy?: 'blue_green'
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
  upstream_url?: string
  blue_upstream_url?: string
  green_upstream_url?: string
  compose_service?: string
  container_port?: number
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
  github_auto_deploy?: boolean
}

export type UpdateApplicationInput = CreateApplicationInput

export type Project = {
  id: string
  name: string
  slug: string
  description: string
  default_registry_id: string | null
  default_registry_name?: string | null
  repository_connector_id: string | null
  repository_full_name: string | null
  repository_branch: string | null
  configuration_revision: number
  created_at: string
  updated_at: string
}

export type ProjectRuntimeVariable = {
  key: string
  value: string
}

export type ProjectRuntimeVariablesResponse = {
  variables: ProjectRuntimeVariable[]
  configuration_revision: number
  changed: boolean
}

export type ApplicationServiceRuntimeConfig = {
  compose_service: string
  doppler_project: string
  doppler_config: string
  variables: ProjectRuntimeVariable[]
  configuration_revision: number
  changed: boolean
}

export type ConfigurationRedeployResponse = {
  deployments: Deployment[]
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
  has_config: boolean
  config: Record<string, unknown>
  last_sync_status: string | null
  last_sync_message: string | null
  last_synced_at: string | null
}

export type ConnectorSyncResponse = {
  connector: ConnectorAccount
  count: number
}

export type GitHubRepositorySyncResponse = {
  connector: ConnectorAccount
  repositories: GitHubRepository[]
}

export type GitHubIntegrationStatus = {
  webhook_configured: boolean
  app_configured: boolean
  repository_sync_enabled: boolean
  build_dispatch_enabled: boolean
  install_url: string
  missing: string[]
}

export type GitHubBuildDispatchInput = {
  repository: string
  application_id?: string
  branch?: string
  workflow_id?: string
  inputs?: Record<string, string>
}

export type GitHubBuildDispatchResponse = {
  build: BuildRun
}

export type CompleteBuildRunResponse = {
  build: BuildRun
  deployments: Deployment[]
}

export type GitHubRepository = {
  connector_id: string
  connector_name: string
  installation_id: string
  application_id: string
  application_name: string
  repository: string
  branch: string
  workflow_id: string
  build_context: string
  dockerfile: string
  image_ref: string
  build_matrix: string
  runner: string
  path_filters: string[]
  clone_url: string
  web_url: string
}

export type GitHubDetectedService = {
  name: string
  root: string
  compose_path: string
  path_filters: string[]
  compose_services?: ComposeService[]
}

export type GitHubDetectedServicesResponse = {
  repository: string
  branch: string
  services: GitHubDetectedService[]
}

export type GitHubRepositoryBranchesResponse = {
  repository: string
  branches: string[]
}

export type GitHubCommitMetadata = {
  sha: string
  message: string
  author_name: string
  author_login: string
  author_avatar_url: string
  html_url: string
}

export type UpdateProjectRepositoryInput = {
  connector_id?: string
  repository?: string
  branch?: string
}

export type ImportGitHubServicesInput = {
  connector_id: string
  repository: string
  branch?: string
  root?: string
  environment_id: string
  server_id: string
  services: string[]
  detected_services: GitHubDetectedService[]
}

export type ImportGitHubServicesResponse = {
  applications: Application[]
  connector: ConnectorAccount
}

export type UpsertConnectorInput = {
  provider: string
  name: string
  enabled: boolean
  config: Record<string, unknown>
}

export type AppVersion = {
  version: string
  commit_sha: string
  build_time: string
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

function authHeaders(): Record<string, string> {
  return {}
}

export function withAccessToken(path: string): string {
  return path
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

export function listDeploymentSlots(applicationID: string, init?: RequestInit) {
  return api<DeploymentSlot[]>(`/api/applications/${applicationID}/deployment-slots`, init)
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

export function updateProjectRepository(projectID: string, input: UpdateProjectRepositoryInput) {
  return api<Project>(`/api/projects/${projectID}/repository`, {
    method: 'PATCH',
    body: JSON.stringify(input),
  })
}

export function listProjectRuntimeVariables(projectID: string, init?: RequestInit) {
  return api<ProjectRuntimeVariablesResponse>(`/api/projects/${projectID}/variables`, init)
}

export function replaceProjectRuntimeVariables(projectID: string, variables: ProjectRuntimeVariable[]) {
  return api<ProjectRuntimeVariablesResponse>(`/api/projects/${projectID}/variables`, {
    method: 'PUT',
    body: JSON.stringify({ variables }),
  })
}

export function listApplicationServiceRuntimeConfigs(applicationID: string, init?: RequestInit) {
  return api<ApplicationServiceRuntimeConfig[]>(`/api/applications/${applicationID}/service-variables`, init)
}

export function replaceApplicationServiceRuntimeConfig(applicationID: string, composeService: string, input: { doppler_project: string, doppler_config: string, variables: ProjectRuntimeVariable[] }) {
  return api<ApplicationServiceRuntimeConfig>(`/api/applications/${applicationID}/service-variables/${encodeURIComponent(composeService)}`, {
    method: 'PUT',
    body: JSON.stringify(input),
  })
}

export function redeployProjectConfiguration(projectID: string) {
  return api<ConfigurationRedeployResponse>(`/api/projects/${projectID}/redeploy-configuration`, {
    method: 'POST',
  })
}

export function redeployApplicationConfiguration(applicationID: string) {
  return api<ConfigurationRedeployResponse>(`/api/applications/${applicationID}/redeploy-configuration`, {
    method: 'POST',
  })
}

export function listDeploymentLogs(deploymentID: string, init?: RequestInit) {
  return api<DeploymentLog[]>(`/api/deployments/${deploymentID}/logs`, init)
}

export function listBuildRuns(init?: RequestInit) {
  return api<BuildRun[]>('/api/builds?limit=100', init)
}

export function completeBuildRun(buildID: string, input: { status?: string, image_ref?: string, image_digest?: string, external_url?: string, error_message?: string }) {
  return api<CompleteBuildRunResponse>(`/api/builds/${buildID}/complete`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
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

export function listServerDevUsers(serverID: string, init?: RequestInit) {
  return api<ServerDevUsersResponse>(`/api/servers/${serverID}/dev-users`, init)
}

export function addServerDevUser(serverID: string, username: string) {
  return api<ServerDevUsersResponse>(`/api/servers/${serverID}/dev-users`, {
    method: 'POST',
    body: JSON.stringify({ username }),
  })
}

export function updateServerDevUser(serverID: string, currentUsername: string, username: string) {
  return api<ServerDevUsersResponse>(`/api/servers/${serverID}/dev-users/${encodeURIComponent(currentUsername)}`, {
    method: 'PATCH',
    body: JSON.stringify({ username }),
  })
}

export function deleteServerDevUser(serverID: string, username: string) {
  return api<ServerDevUsersResponse>(`/api/servers/${serverID}/dev-users/${encodeURIComponent(username)}`, {
    method: 'DELETE',
  })
}

export function applyServerDevUsers(serverID: string) {
  return api<ServerDevUsersResponse>(`/api/servers/${serverID}/dev-users/apply`, {
    method: 'POST',
  })
}

export function createApplication(input: CreateApplicationInput) {
  return api<Application>('/api/applications', {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function updateApplication(applicationID: string, input: UpdateApplicationInput) {
  return api<Application>(`/api/applications/${applicationID}`, {
    method: 'PATCH',
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

export function listGitHubRepositories(init?: RequestInit) {
  return api<GitHubRepository[]>('/api/github/repositories', init)
}

export function listGitHubRepositoryBranches(input: { connector_id: string, repository: string }) {
  const params = new URLSearchParams({
    connector_id: input.connector_id,
    repository: input.repository,
  })
  return api<GitHubRepositoryBranchesResponse>(`/api/github/repositories/branches?${params}`)
}

export function getGitHubRepositoryCommit(input: { connector_id: string, repository: string, sha: string }, init?: RequestInit) {
  const params = new URLSearchParams(input)
  return api<GitHubCommitMetadata>(`/api/github/repositories/commit?${params}`, init)
}

export function detectGitHubRepositoryServices(input: { connector_id: string, repository: string, branch?: string, root?: string }) {
  const params = new URLSearchParams({
    connector_id: input.connector_id,
    repository: input.repository,
    branch: input.branch || 'main',
  })
  if (input.root) params.set('root', input.root)
  return api<GitHubDetectedServicesResponse>(`/api/github/repositories/detect?${params}`)
}

export function importGitHubRepositoryServices(projectID: string, input: ImportGitHubServicesInput) {
  return api<ImportGitHubServicesResponse>(`/api/projects/${projectID}/github/import`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}

export function getGitHubStatus(init?: RequestInit) {
  return api<GitHubIntegrationStatus>('/api/github/status', init)
}

export function getDopplerStatus(init?: RequestInit) {
  return api<DopplerIntegrationStatus>('/api/doppler/status', init)
}

export function listDopplerProjects(init?: RequestInit) {
  return api<string[]>('/api/doppler/projects', init)
}

export function listDopplerConfigs(project: string, init?: RequestInit) {
  return api<string[]>(`/api/doppler/configs?project=${encodeURIComponent(project)}`, init)
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

export function syncGitHubConnectorRepositories(connectorID: string) {
  return api<GitHubRepositorySyncResponse>(`/api/connectors/${connectorID}/github/repositories/sync`, {
    method: 'POST',
  })
}

export function dispatchGitHubBuild(connectorID: string, input: GitHubBuildDispatchInput) {
  return api<GitHubBuildDispatchResponse>(`/api/connectors/${connectorID}/github/builds/dispatch`, {
    method: 'POST',
    body: JSON.stringify(input),
  })
}
