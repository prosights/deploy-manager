// Complete API records with sensible defaults. Override only what a test cares about.
import type { Application, BuildRun, ContainerRegistry, Deployment, Environment, GitHubIntegrationStatus, GitHubRepository, Project, ProxyRoute, Server } from '../lib/api'

const at = '2026-07-01T12:00:00Z'

export function project(overrides: Partial<Project> = {}): Project {
  return {
    id: 'project_1',
    name: 'Billing',
    slug: 'billing',
    description: '',
    default_registry_id: null,
    default_registry_name: null,
    repository_connector_id: null,
    repository_full_name: null,
    repository_branch: null,
    configuration_revision: 1,
    created_at: at,
    updated_at: at,
    ...overrides,
  }
}

export function environment(overrides: Partial<Environment> = {}): Environment {
  return {
    id: 'env_1',
    project_id: 'project_1',
    name: 'Production',
    slug: 'production',
    kind: 'production',
    is_ephemeral: false,
    pull_request_number: null,
    branch: null,
    expires_at: null,
    created_at: at,
    updated_at: at,
    ...overrides,
  }
}

export function server(overrides: Partial<Server> = {}): Server {
  return {
    id: 'server_1',
    name: 'prod-1',
    hostname: '10.0.0.10',
    ssh_user: 'deploy',
    ssh_port: 22,
    ssh_key_path: null,
    connection_mode: 'direct_ssh',
    proxy_type: 'caddy',
    status: 'healthy',
    cpu_usage: null,
    memory_usage: null,
    disk_usage: null,
    last_checked_at: null,
    ...overrides,
  }
}

export function application(overrides: Partial<Application> = {}): Application {
  return {
    id: 'app_1',
    environment_id: 'env_1',
    server_id: 'server_1',
    name: 'API',
    repository_url: 'https://github.com/prosights/api.git',
    branch: 'main',
    compose_path: 'docker-compose.yml',
    remote_directory: '/srv/api',
    domain: null,
    health_check_url: 'http://127.0.0.1:{port}/health?color={color}',
    doppler_project: null,
    doppler_config: null,
    status: 'healthy',
    current_version: null,
    target_version: null,
    server_name: 'prod-1',
    environment_name: 'Production',
    environment_slug: 'production',
    environment_kind: 'production',
    environment_is_ephemeral: false,
    project_id: 'project_1',
    project_name: 'Billing',
    project_slug: 'billing',
    default_registry_id: null,
    default_registry_name: null,
    github_auto_deploy: false,
    configuration_revision: 1,
    deployed_configuration_revision: 1,
    deployed_project_configuration_revision: 1,
    compose_services: [],
    redeploy_required: false,
    ...overrides,
  }
}

export function deployment(overrides: Partial<Deployment> = {}): Deployment {
  return {
    id: 'deployment_1',
    application_id: 'app_1',
    server_id: 'server_1',
    trigger: 'manual',
    strategy: 'blue_green',
    status: 'succeeded',
    commit_sha: null,
    image_ref: null,
    image_digest: null,
    actor: 'manual',
    application_name: 'API',
    project_id: 'project_1',
    project_name: 'Billing',
    created_at: at,
    started_at: at,
    finished_at: at,
    ...overrides,
  }
}

export function buildRun(overrides: Partial<BuildRun> = {}): BuildRun {
  return {
    id: 'build_1',
    provider: 'github_actions',
    connector_id: 'connector_github',
    application_id: 'app_1',
    repository: 'prosights/api',
    branch: 'main',
    workflow_id: 'deploy.yml',
    status: 'succeeded',
    commit_sha: null,
    image_ref: null,
    image_digest: null,
    external_url: null,
    error_message: null,
    started_at: at,
    completed_at: at,
    created_at: at,
    updated_at: at,
    ...overrides,
  }
}

export function proxyRoute(overrides: Partial<ProxyRoute> = {}): ProxyRoute {
  return {
    id: 'route_1',
    server_id: 'server_1',
    application_id: 'app_1',
    domain: 'api.example.com',
    upstream_url: 'http://127.0.0.1:18080',
    blue_upstream_url: null,
    green_upstream_url: null,
    tls_enabled: true,
    status: 'applied',
    last_applied_at: at,
    server_name: 'prod-1',
    proxy_type: 'caddy',
    application_name: 'API',
    ...overrides,
  }
}

export function registry(overrides: Partial<ContainerRegistry> = {}): ContainerRegistry {
  return {
    id: 'registry_1',
    name: 'GHCR',
    provider: 'ghcr',
    registry_host: 'ghcr.io',
    namespace: 'prosights',
    repository: 'api',
    default_image: '',
    enabled: true,
    created_at: at,
    updated_at: at,
    ...overrides,
  }
}

export function githubRepository(overrides: Partial<GitHubRepository> = {}): GitHubRepository {
  return {
    connector_id: 'connector_github',
    connector_name: 'GitHub',
    installation_id: '1',
    application_id: '',
    application_name: '',
    repository: 'prosights/api',
    branch: 'main',
    workflow_id: '',
    build_context: '.',
    dockerfile: 'Dockerfile',
    image_ref: '',
    build_matrix: '',
    runner: '',
    path_filters: [],
    clone_url: 'https://github.com/prosights/api.git',
    web_url: 'https://github.com/prosights/api',
    ...overrides,
  }
}

export function githubStatus(overrides: Partial<GitHubIntegrationStatus> = {}): GitHubIntegrationStatus {
  return {
    webhook_configured: true,
    app_configured: true,
    repository_sync_enabled: true,
    build_dispatch_enabled: true,
    install_url: '',
    missing: [],
    ...overrides,
  }
}

// Responses for every query the project page loader needs.
export function projectPageHandlers(data: {
  projects?: Project[]
  environments?: Environment[]
  applications?: Application[]
  deployments?: Deployment[]
  servers?: Server[]
  routes?: ProxyRoute[]
  builds?: BuildRun[]
  repositories?: GitHubRepository[]
} = {}) {
  return {
    'GET /api/projects': data.projects ?? [project()],
    'GET /api/environments': data.environments ?? [environment()],
    'GET /api/applications': data.applications ?? [application()],
    'GET /api/deployments': data.deployments ?? [],
    'GET /api/builds': data.builds ?? [],
    'GET /api/servers': data.servers ?? [server()],
    'GET /api/container-registries': [],
    'GET /api/proxy-routes': data.routes ?? [],
    'GET /api/github/repositories': data.repositories ?? [],
    'GET /api/github/status': githubStatus(),
  }
}
