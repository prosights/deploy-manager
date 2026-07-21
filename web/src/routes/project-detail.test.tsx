import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  applyProxyRoute,
  createDeployment,
  createEnvironment,
  createProxyRoute,
  deleteEnvironment,
  detectGitHubRepositoryServices,
  dispatchGitHubBuild,
  importGitHubRepositoryServices,
  redeployApplicationConfiguration,
  redeployProjectConfiguration,
  replaceApplicationServiceRuntimeConfig,
  replaceProjectRuntimeVariables,
  updateProject,
} from '../lib/api'
import { TestRouter } from '../test/router'
import { ProjectDetailRoute } from './project-detail'

vi.mock('../features/servers/components', () => ({
  ApplicationTerminal: () => <div>terminal</div>,
  applicationTerminalDirectory: (application: { remote_directory: string, compose_path: string }) => {
    const directory = application.compose_path.split('/').slice(0, -1).join('/')
    return directory ? `${application.remote_directory}/${directory}` : application.remote_directory
  },
}))

vi.mock('../lib/api', () => ({
  applyProxyRoute: vi.fn(async (routeID) => ({ id: routeID, status: 'applied' })),
  cancelDeployment: vi.fn(async (deploymentID) => ({ id: deploymentID, status: 'cancelled' })),
  checkServer: vi.fn(async (serverID) => ({
    server: {
      id: serverID,
      name: 'app-01',
      hostname: '10.0.0.1',
      ssh_user: 'deploy',
      ssh_port: 22,
      ssh_key_path: '~/.ssh/id_ed25519',
      connection_mode: 'direct_ssh',
      proxy_type: 'caddy',
      status: 'healthy',
      cpu_usage: 12,
      memory_usage: 34,
      disk_usage: 56,
      last_checked_at: '2026-07-16T12:00:00Z',
    },
    ssh_ok: true,
    docker_ok: true,
  })),
  createDeployment: vi.fn(async (input) => ({ id: 'deployment_2', status: 'queued', ...input })),
  createEnvironment: vi.fn(async (input) => ({ id: 'env_2', ...input })),
  createProxyRoute: vi.fn(async (input) => ({ id: 'route_2', status: 'pending', ...input })),
  detectGitHubRepositoryServices: vi.fn(async () => ({
    repository: 'prosights/api',
    branch: 'main',
    services: [{ name: 'api', root: 'api', compose_path: 'api/compose.yml', path_filters: ['api/**'] }],
  })),
  deleteApplication: vi.fn(async () => undefined),
  deleteEnvironment: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
  deleteProxyRoute: vi.fn(async () => undefined),
  dispatchGitHubBuild: vi.fn(async () => ({ build: { id: 'build_2', status: 'dispatched' }, deployments: [] })),
  importGitHubRepositoryServices: vi.fn(async () => ({ applications: [{ id: 'app_2' }], connector: { id: 'connector_github' } })),
  listGitHubRepositoryBranches: vi.fn(async () => ({ repository: 'prosights/api', branches: ['main', 'release/2026-07'] })),
  listProjectRuntimeVariables: vi.fn(async () => ({ variables: [{ key: 'PUBLIC_API_URL', value: 'https://api.internal' }], configuration_revision: 1, changed: false })),
  redeployApplicationConfiguration: vi.fn(async () => ({ deployments: [] })),
  redeployProjectConfiguration: vi.fn(async () => ({ deployments: [] })),
  replaceApplicationServiceRuntimeConfig: vi.fn(async (_applicationID, composeService, input) => ({ compose_service: composeService, ...input, configuration_revision: 3, changed: true })),
  replaceProjectRuntimeVariables: vi.fn(async (_projectID, variables) => ({ variables, configuration_revision: 2, changed: true })),
  retryDeployment: vi.fn(async (deploymentID) => ({ id: deploymentID, status: 'queued' })),
  rollbackApplication: vi.fn(async () => ({ id: 'deployment_rollback', status: 'queued' })),
  updateApplication: vi.fn(async (applicationID, input) => ({ id: applicationID, ...input })),
  updateProject: vi.fn(async (projectID, input) => ({ id: projectID, ...input })),
  updateProjectRegistry: vi.fn(async (projectID, defaultRegistryID) => ({ id: projectID, default_registry_id: defaultRegistryID })),
  withAccessToken: (path: string) => path,
}))

const project = {
  id: 'project_1',
  name: 'Billing',
  slug: 'billing',
  description: 'Billing stack',
  default_registry_id: null,
  default_registry_name: null,
  repository_connector_id: null,
  repository_full_name: null,
  repository_branch: null,
  configuration_revision: 1,
  created_at: '2026-06-25T00:00:00Z',
  updated_at: '2026-06-25T00:00:00Z',
}

const application = {
  id: 'app_1',
  environment_id: 'env_1',
  server_id: 'server_1',
  name: 'API',
  repository_url: 'https://github.com/prosights/api.git',
  branch: 'main',
  compose_path: 'api/compose.yml',
  remote_directory: '/srv/api',
  domain: 'api-a1b2c3d4.internal.prosights.co',
  health_check_url: 'http://127.0.0.1:{port}/healthz?color={color}',
  doppler_project: 'api',
  doppler_config: 'prd',
  status: 'healthy',
  current_version: 'abc123',
  target_version: null,
  server_name: 'app-01',
  environment_name: 'Production',
  environment_slug: 'production',
  environment_kind: 'production',
  environment_is_ephemeral: false,
  project_id: 'project_1',
  project_name: 'Billing',
  project_slug: 'billing',
  default_registry_id: null,
  default_registry_name: null,
  github_auto_deploy: true,
  compose_services: [
    { name: 'api', image: 'registry.example.com/api', ports: [{ container_port: 8080 }], depends_on: ['postgres'] },
    { name: 'worker', build_context: '.', dockerfile: 'Dockerfile.worker', ports: [], depends_on: ['api'] },
  ],
  configuration_revision: 2,
  deployed_configuration_revision: 1,
  deployed_project_configuration_revision: 0,
  redeploy_required: true,
}

const deployment = {
  id: 'deployment_1',
  application_id: 'app_1',
  server_id: 'server_1',
  trigger: 'connector_sync',
  strategy: 'blue_green',
  status: 'succeeded',
  commit_sha: 'abc1234',
  commit_message: 'Ship Railway-style deployment details',
  image_ref: 'registry.example.com/api:abc1234',
  image_digest: null,
  actor: 'build:build_1',
  configuration_snapshot: {
    application_revision: 2,
    project_revision: 1,
    configuration_state: {
      application: { compose_services: application.compose_services },
      project_variables: [{ key: 'PUBLIC_API_URL', value: 'https://api.internal' }],
      service_runtime_configs: [
        { compose_service: 'api', doppler_project: 'prosights-charts', doppler_config: 'prd', variables: [{ key: 'LOG_LEVEL', value: 'info' }] },
      ],
    },
  },
  created_at: '2026-07-16T12:00:00Z',
  started_at: '2026-07-16T12:00:10Z',
  finished_at: '2026-07-16T12:01:00Z',
}

const failedDeployment = {
  ...deployment,
  id: 'failed_1',
  status: 'failed',
  trigger: 'manual',
  commit_message: 'Previous failed release',
  actor: 'pramit@example.com',
  created_at: '2026-07-15T12:00:00Z',
  started_at: '2026-07-15T12:00:10Z',
  finished_at: '2026-07-15T12:00:40Z',
}

const repository = {
  connector_id: 'connector_github',
  connector_name: 'GitHub',
  installation_id: '123456',
  application_id: 'app_1',
  application_name: 'API',
  repository: 'prosights/api',
  branch: 'main',
  workflow_id: 'deploy-manager-build.yml',
  build_context: 'api',
  dockerfile: 'api/Dockerfile',
  image_ref: 'registry.example.com/api',
  build_matrix: '',
  runner: 'ubuntu-latest',
  path_filters: ['api/**'],
  clone_url: 'https://github.com/prosights/api.git',
  web_url: 'https://github.com/prosights/api',
}

let serverProxyType: 'caddy' | 'none' = 'caddy'
let serverHostname = '10.0.0.1'
let proxyRoutes: Array<Record<string, unknown>> = []
let deploymentResults = [deployment, failedDeployment]

vi.mock('../lib/queries', () => ({
  applicationServiceRuntimeConfigsQuery: (applicationID: string) => ({ queryKey: ['applications', applicationID, 'service-variables'], queryFn: async () => [] }),
  dopplerProjectsQuery: { queryKey: ['doppler-projects'], queryFn: async () => ['prosights-charts'] },
  dopplerConfigsQuery: (project: string) => ({ queryKey: ['doppler-configs', project], queryFn: async () => project ? ['alleyes_local', 'alleyes'] : [], enabled: Boolean(project) }),
  projectsQuery: { queryKey: ['projects'], queryFn: async () => [project] },
  environmentsQuery: {
    queryKey: ['environments'],
    queryFn: async () => [
      {
        id: 'env_1', project_id: 'project_1', name: 'Production', slug: 'production', kind: 'production', is_ephemeral: false,
        pull_request_number: null, branch: null, expires_at: null, created_at: '2026-06-25T00:00:00Z', updated_at: '2026-06-25T00:00:00Z',
      },
      {
        id: 'env_2', project_id: 'project_1', name: 'Staging', slug: 'staging', kind: 'development', is_ephemeral: false,
        pull_request_number: null, branch: null, expires_at: null, created_at: '2026-06-26T00:00:00Z', updated_at: '2026-06-26T00:00:00Z',
      },
    ],
  },
  applicationsQuery: { queryKey: ['applications'], queryFn: async () => [application] },
  serversQuery: {
    queryKey: ['servers'],
    queryFn: async () => [{
      id: 'server_1', name: 'app-01', hostname: serverHostname, ssh_user: 'deploy', ssh_port: 22, ssh_key_path: '~/.ssh/id_ed25519',
      connection_mode: 'direct_ssh', proxy_type: serverProxyType, status: 'healthy', cpu_usage: 12, memory_usage: 34, disk_usage: 56, last_checked_at: null,
    }],
  },
  containerRegistriesQuery: { queryKey: ['container-registries'], queryFn: async () => [] },
  githubRepositoriesQuery: { queryKey: ['github-repositories'], queryFn: async () => [repository] },
  githubCommitQuery: (connectorID: string, repositoryName: string, sha: string) => ({
    queryKey: ['github-commit', connectorID, repositoryName, sha],
    queryFn: async () => ({
      sha,
      message: 'Actual GitHub commit subject',
      author_name: 'Pramit Bhatia',
      author_login: 'pramit',
      author_avatar_url: 'https://avatars.githubusercontent.com/u/42?v=4',
      html_url: `https://github.com/${repositoryName}/commit/${sha}`,
    }),
    enabled: Boolean(connectorID && repositoryName && sha),
    staleTime: Infinity,
  }),
  githubStatusQuery: {
    queryKey: ['github-status'],
    queryFn: async () => ({ webhook_configured: true, app_configured: true, repository_sync_enabled: true, build_dispatch_enabled: true, install_url: 'https://github.com/apps/deploy-manager/installations/new', missing: [] }),
  },
  proxyRoutesQuery: { queryKey: ['proxy-routes'], queryFn: async () => proxyRoutes },
  deploymentsQuery: { queryKey: ['deployments'], queryFn: async () => deploymentResults },
  buildRunsQuery: {
    queryKey: ['build-runs'],
    queryFn: async () => [{
      id: 'build_1', provider: 'github_actions', connector_id: 'connector_github', application_id: 'app_1', repository: 'prosights/api', branch: 'main',
      workflow_id: 'deploy-manager-build.yml', status: 'succeeded', commit_sha: 'abc1234', image_ref: 'registry.example.com/api:abc1234', image_digest: null,
      external_url: 'https://github.com/prosights/api/actions/runs/1', error_message: null, started_at: '2026-07-16T11:58:00Z', completed_at: '2026-07-16T12:00:00Z',
      created_at: '2026-07-16T11:58:00Z', updated_at: '2026-07-16T12:00:00Z',
    }],
  },
  deploymentSlotsQuery: (applicationID: string) => ({ queryKey: ['applications', applicationID, 'deployment-slots'], queryFn: async () => [] }),
  deploymentLogsQuery: (deploymentID: string) => ({
    queryKey: ['deployments', deploymentID, 'logs'],
    queryFn: async () => [
      { id: 1, deployment_id: deploymentID, stream: 'system', message: 'Syncing repository', created_at: '2026-07-16T12:00:11Z' },
      { id: 2, deployment_id: deploymentID, stream: 'system', message: 'Building next color images', created_at: '2026-07-16T12:00:12Z' },
      { id: 3, deployment_id: deploymentID, stream: 'stdout', message: '#1 [api internal] load build definition\n#1 DONE 0.1s\n#2 [worker internal] load build definition\n#2 DONE 0.2s', created_at: '2026-07-16T12:00:20Z' },
      { id: 4, deployment_id: deploymentID, stream: 'system', message: 'Starting next color stack', created_at: '2026-07-16T12:00:40Z' },
      { id: 5, deployment_id: deploymentID, stream: 'stdout', message: 'Container billing-blue-api-1 Started\nContainer billing-blue-worker-1 Started', created_at: '2026-07-16T12:00:45Z' },
      { id: 6, deployment_id: deploymentID, stream: 'system', message: 'Deployment completed', created_at: '2026-07-16T12:01:00Z' },
    ],
  }),
}))

describe('ProjectDetailRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    window.localStorage.clear()
    serverProxyType = 'caddy'
    serverHostname = '10.0.0.1'
    proxyRoutes = []
    deploymentResults = [deployment, failedDeployment]
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.history.replaceState(null, '', '/')
    cleanup()
  })

  function renderRoute() {
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
    render(
      <QueryClientProvider client={client}>
        <TestRouter><ProjectDetailRoute projectId="project_1" /></TestRouter>
      </QueryClientProvider>,
    )
  }

  it('always opens the project architecture and removes legacy project tabs', async () => {
    window.history.replaceState(null, '', '/projects/project_1#deployments')
    renderRoute()

    expect(await screen.findByRole('heading', { name: 'Architecture' })).toBeInTheDocument()
    expect(screen.getByRole('banner')).toHaveClass('h-[60px]')
    expect(screen.getByRole('button', { name: 'Add service' })).toBeInTheDocument()
    expect(screen.queryByText('Deploy and rollback')).not.toBeInTheDocument()
    await waitFor(() => expect(window.location.hash).toBe(''))
  })

  it('restores and persists the selected environment for this project', async () => {
    window.localStorage.setItem('deploy-manager:project-environment:v1:project_1', 'env_2')
    renderRoute()

    const environment = await screen.findByRole('combobox', { name: 'Environment' })
    expect(environment).toHaveTextContent('Staging')
    fireEvent.click(environment)
    fireEvent.click(await screen.findByRole('option', { name: 'Production' }))

    await waitFor(() => expect(window.localStorage.getItem('deploy-manager:project-environment:v1:project_1')).toBe('env_1'))
  })

  it('opens a service with Railway-style scoped tabs', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))

    const drawer = await screen.findByRole('dialog', { name: 'API' })
    for (const tab of ['Deployments', 'Variables', 'Metrics', 'Console', 'Settings']) {
      expect(within(drawer).getByRole('button', { name: tab })).toBeInTheDocument()
    }
    expect(within(drawer).getByText('ACTIVE')).toBeInTheDocument()
    expect((await within(drawer).findAllByText('Actual GitHub commit subject')).length).toBeGreaterThan(0)
    expect(drawer.querySelector('img[src="https://avatars.githubusercontent.com/u/42?v=4"]')).toBeInTheDocument()
    expect(within(drawer).getByText('Deployment successful')).toBeInTheDocument()
    expect(within(drawer).getByText('HISTORY')).toBeInTheDocument()
    expect(within(drawer).getByText('1 release')).toBeInTheDocument()
    expect(window.location.search).toBe('?service=app_1')

    fireEvent.click(within(drawer).getByRole('button', { name: 'Console' }))
    expect(within(drawer).getByText('/srv/api/api')).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Close service' }))
    expect(window.location.search).toBe('')
  })

  it('paginates service deployment history at ten releases', async () => {
    deploymentResults = [
      deployment,
      ...Array.from({ length: 12 }, (_, index) => ({
        ...failedDeployment,
        id: `failed_${index + 1}`,
        created_at: new Date(Date.parse('2026-07-15T12:00:00Z') - index * 60_000).toISOString(),
      })),
    ]
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })

    expect(within(drawer).getAllByRole('button', { name: /Open deployment/ })).toHaveLength(11)
    expect(within(drawer).getByText('1 of 2')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('button', { name: 'Next' }))
    expect(within(drawer).getAllByRole('button', { name: /Open deployment/ })).toHaveLength(3)
  })

  it('shows every routed service URL instead of collapsing them into a count', async () => {
    proxyRoutes = [
      { id: 'route_api', server_id: 'server_1', application_id: 'app_1', domain: 'api.example.com', upstream_url: 'http://127.0.0.1:20000', blue_upstream_url: 'http://127.0.0.1:20000', green_upstream_url: 'http://127.0.0.1:20001', compose_service: 'api', container_port: 8080, tls_enabled: true, status: 'applied', last_applied_at: null, server_name: 'app-01', proxy_type: 'caddy', application_name: 'API' },
      { id: 'route_worker', server_id: 'server_1', application_id: 'app_1', domain: 'worker.example.com', upstream_url: 'http://127.0.0.1:21000', blue_upstream_url: 'http://127.0.0.1:21000', green_upstream_url: 'http://127.0.0.1:21001', compose_service: 'worker', container_port: 9000, tls_enabled: true, status: 'applied', last_applied_at: null, server_name: 'app-01', proxy_type: 'caddy', application_name: 'API' },
    ]
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })

    expect(within(drawer).getAllByRole('link', { name: 'https://api.example.com' }).length).toBeGreaterThan(0)
    expect(within(drawer).getAllByRole('link', { name: 'https://worker.example.com' }).length).toBeGreaterThan(0)
    expect(within(drawer).queryByText('+1')).not.toBeInTheDocument()
  })

  it('opens deployment details and separates build and deploy logs', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getAllByRole('button', { name: /Open deployment/ })[0])

    for (const tab of ['Details', 'Build Logs', 'Deploy Logs']) {
      expect(await within(drawer).findByRole('button', { name: tab })).toBeInTheDocument()
    }
    expect(window.location.search).toBe('?service=app_1&deployment=deployment_1')
    expect(within(drawer).getByRole('heading', { name: 'api' })).toBeInTheDocument()
    expect(within(drawer).getByRole('heading', { name: 'worker' })).toBeInTheDocument()
    expect(within(drawer).getByText('prosights-charts/prd')).toBeInTheDocument()

    fireEvent.click(within(drawer).getByRole('button', { name: 'Back to service' }))
    expect(await within(drawer).findByRole('button', { name: 'Deployments' })).toBeInTheDocument()
    expect(window.location.search).toBe('?service=app_1')

    fireEvent.click(within(drawer).getAllByRole('button', { name: /Open deployment/ })[0])

    fireEvent.click(within(drawer).getByRole('button', { name: 'Build Logs' }))
    expect(await within(drawer).findByText('Building next color images')).toBeInTheDocument()
    expect(within(drawer).getByLabelText('Filter logs')).toBeInTheDocument()
    fireEvent.click(within(drawer).getByRole('combobox', { name: 'Log service' }))
    fireEvent.click(await screen.findByRole('option', { name: 'worker' }))
    expect(await within(drawer).findByText('#2 [worker internal] load build definition')).toBeInTheDocument()
    expect(within(drawer).queryByText('#1 [api internal] load build definition')).not.toBeInTheDocument()
    expect(window.location.search).toContain('view=build-logs')

    expect(within(drawer).queryByRole('button', { name: 'HTTP Logs' })).not.toBeInTheDocument()
  })

  it('offers Railway-style deployment actions and restarts the pinned artifact', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.pointerDown(within(drawer).getAllByRole('button', { name: 'Deployment actions' })[0], { button: 0, ctrlKey: false })

    expect(await screen.findByRole('menuitem', { name: 'Redeploy' })).toBeInTheDocument()
    fireEvent.click(screen.getByRole('menuitem', { name: 'Restart' }))

    await waitFor(() => expect(createDeployment).toHaveBeenCalledWith(expect.objectContaining({
      application_id: 'app_1',
      image_ref: 'registry.example.com/api:abc1234',
      actor: 'restart',
    })))
  })

  it('dispatches the connected GitHub build from the service', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Deploy latest' }))

    await waitFor(() => expect(dispatchGitHubBuild).toHaveBeenCalledWith('connector_github', {
      repository: 'prosights/api',
      application_id: 'app_1',
      branch: 'main',
    }))
  })

  it('stores Doppler and extra variables for only the selected service', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Variables' }))

    await within(drawer).findByText('Service variables')
    expect(within(drawer).queryByText('Runtime variables')).not.toBeInTheDocument()
    expect(within(drawer).getByRole('combobox', { name: 'Service' })).toHaveTextContent('api')
    const projectSelect = within(drawer).getByRole('combobox', { name: 'Doppler project' })
    await waitFor(() => expect(projectSelect).not.toBeDisabled())
    fireEvent.click(projectSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'prosights-charts' }))
    const configSelect = within(drawer).getByRole('combobox', { name: 'Doppler config' })
    await waitFor(() => expect(configSelect).not.toBeDisabled())
    fireEvent.click(configSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'alleyes_local' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add service variable' }))
    const serviceVariables = within(drawer).getByText('Additional variables').parentElement?.parentElement
    fireEvent.change(within(serviceVariables!).getByLabelText('Key'), { target: { value: 'PUBLIC_API_URL' } })
    fireEvent.change(within(serviceVariables!).getByLabelText('Value'), { target: { value: 'https://api.example.com' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save api' }))

    await waitFor(() => expect(replaceApplicationServiceRuntimeConfig).toHaveBeenCalledWith('app_1', 'api', {
      doppler_project: 'prosights-charts',
      doppler_config: 'alleyes_local',
      variables: [{ key: 'PUBLIC_API_URL', value: 'https://api.example.com' }],
    }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Redeploy' }))
    await waitFor(() => expect(redeployApplicationConfiguration).toHaveBeenCalledWith('app_1'))
  })

  it('stores variables shared by only this compose stack', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Variables' }))

    await within(drawer).findByText('Stack shared variables')
    const projectSelect = within(drawer).getByRole('combobox', { name: 'Stack Doppler project' })
    await waitFor(() => expect(projectSelect).not.toBeDisabled())
    fireEvent.click(projectSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'prosights-charts' }))
    const configSelect = within(drawer).getByRole('combobox', { name: 'Stack Doppler config' })
    await waitFor(() => expect(configSelect).not.toBeDisabled())
    fireEvent.click(configSelect)
    fireEvent.click(await screen.findByRole('option', { name: 'alleyes_local' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add stack variable' }))
    const stackVariables = within(drawer).getByText('Shared variables').parentElement?.parentElement
    fireEvent.change(within(stackVariables!).getByLabelText('Key'), { target: { value: 'APP_ENV' } })
    fireEvent.change(within(stackVariables!).getByLabelText('Value'), { target: { value: 'production' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Save stack' }))

    await waitFor(() => expect(replaceApplicationServiceRuntimeConfig).toHaveBeenCalledWith('app_1', '__stack__', {
      doppler_project: 'prosights-charts',
      doppler_config: 'alleyes_local',
      variables: [{ key: 'APP_ENV', value: 'production' }],
    }))
  })

  it('requires a proxy before adding a domain', async () => {
    serverProxyType = 'none'
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings' }))

    expect(within(drawer).getByText('Domains require Caddy or Traefik on this server.')).toBeInTheDocument()
    expect(within(drawer).getByText(/Enable a supported proxy/)).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Add domain' })).not.toBeInTheDocument()
  })

  it('adds a domain for a compose service and container port', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings' }))

    fireEvent.click(within(drawer).getByRole('button', { name: 'Add domain' }))
    fireEvent.change(within(drawer).getByLabelText('Domain'), { target: { value: 'api.example.com' } })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Add domain' }))

    await waitFor(() => expect(createProxyRoute).toHaveBeenCalledWith({ application_id: 'app_1', domain: 'api.example.com', compose_service: 'api', container_port: 8080, tls_enabled: true }))
  })

  it('deploys managed route changes instead of applying them manually', async () => {
    proxyRoutes = [{
      id: 'route_1', server_id: 'server_1', application_id: 'app_1', domain: 'api.example.com', upstream_url: 'http://127.0.0.1:20000',
      blue_upstream_url: 'http://127.0.0.1:20000', green_upstream_url: 'http://127.0.0.1:20001', compose_service: 'api', container_port: 8080,
      tls_enabled: true, status: 'pending', last_applied_at: null, server_name: 'app-01', proxy_type: 'caddy', application_name: 'API',
    }]
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings' }))

    expect(within(drawer).getByText('pending')).toBeInTheDocument()
    expect(within(drawer).queryByRole('button', { name: 'Apply' })).not.toBeInTheDocument()
    expect(applyProxyRoute).not.toHaveBeenCalled()
  })

  it('keeps manual apply for legacy routes', async () => {
    proxyRoutes = [{
      id: 'route_1', server_id: 'server_1', application_id: 'app_1', domain: 'api.example.com', upstream_url: 'http://127.0.0.1:8080',
      blue_upstream_url: null, green_upstream_url: null, compose_service: null, container_port: null,
      tls_enabled: true, status: 'pending', last_applied_at: null, server_name: 'app-01', proxy_type: 'caddy', application_name: 'API',
    }]
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Open API' }))
    const drawer = await screen.findByRole('dialog', { name: 'API' })
    fireEvent.click(within(drawer).getByRole('button', { name: 'Settings' }))
    fireEvent.click(within(drawer).getByRole('button', { name: 'Apply' }))

    await waitFor(() => expect(applyProxyRoute).toHaveBeenCalledWith('route_1', expect.anything()))
  })

  it('scans and imports services from a connected GitHub repository', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Add service' }))
    const dialog = await screen.findByRole('dialog', { name: 'Add service' })
    fireEvent.pointerDown(within(dialog).getByRole('button', { name: 'Branch: main' }), { button: 0, ctrlKey: false })
    fireEvent.change(await screen.findByLabelText('Search branch'), { target: { value: 'release' } })
    fireEvent.click(await screen.findByRole('menuitem', { name: 'release/2026-07' }))
    fireEvent.change(within(dialog).getByLabelText('Root directory (optional)'), { target: { value: 'api' } })
    const scanButton = within(dialog).getByRole('button', { name: 'Scan repository' })
    await waitFor(() => expect(scanButton).toBeEnabled())
    fireEvent.click(scanButton)

    expect(await within(dialog).findByText('api/compose.yml')).toBeInTheDocument()
    fireEvent.click(within(dialog).getByRole('button', { name: 'Import 1 service' }))

    await waitFor(() => expect(detectGitHubRepositoryServices).toHaveBeenCalledWith({
      connector_id: 'connector_github', repository: 'prosights/api', branch: 'release/2026-07', root: 'api',
    }))
    expect(importGitHubRepositoryServices).toHaveBeenCalledWith('project_1', {
      connector_id: 'connector_github',
      repository: 'prosights/api',
      branch: 'release/2026-07',
      root: 'api',
      environment_id: 'env_1',
      server_id: 'server_1',
      services: ['api'],
      detected_services: [{ name: 'api', root: 'api', compose_path: 'api/compose.yml', path_filters: ['api/**'] }],
    })
  })

  it('keeps project identity in project-level settings', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    fireEvent.change(within(dialog).getByLabelText('Project name'), { target: { value: 'Payments' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save project' }))

    await waitFor(() => expect(updateProject).toHaveBeenCalledWith('project_1', {
      name: 'Payments', slug: 'billing', description: 'Billing stack',
    }))
  })

  it('creates name-only environments and confirms deletion inline', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Environments' }))
    fireEvent.change(within(dialog).getByLabelText('Environment name'), { target: { value: 'QA' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Add environment' }))

    await waitFor(() => expect(createEnvironment).toHaveBeenCalledWith({ project_id: 'project_1', name: 'QA', slug: 'qa', kind: 'development', is_ephemeral: false }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Delete environment Staging' }))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Confirm' }))
    await waitFor(() => expect(deleteEnvironment).toHaveBeenCalledWith('env_2'))
    expect(within(dialog).queryByRole('combobox', { name: 'Type' })).not.toBeInTheDocument()
  })

  it('saves shared non-secret variables and redeploys stale project services', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Shared variables' }))
    fireEvent.change(await within(dialog).findByLabelText('Value'), { target: { value: 'https://new.internal' } })
    fireEvent.click(within(dialog).getByRole('button', { name: 'Save variables' }))

    await waitFor(() => expect(replaceProjectRuntimeVariables).toHaveBeenCalledWith('project_1', [{ key: 'PUBLIC_API_URL', value: 'https://new.internal' }]))
    fireEvent.click(within(dialog).getByRole('button', { name: 'Redeploy all' }))
    await waitFor(() => expect(redeployProjectConfiguration).toHaveBeenCalledWith('project_1'))
  })

  it('requires the exact project name before enabling deletion', async () => {
    renderRoute()
    fireEvent.click(await screen.findByRole('button', { name: 'Project settings' }))
    const dialog = await screen.findByRole('dialog', { name: 'Project settings' })
    const affectedServices = within(dialog).getByRole('list', { name: 'Services that will be deleted' })
    expect(within(affectedServices).getByText('API')).toBeInTheDocument()
    expect(within(affectedServices).getByText('Production · healthy')).toBeInTheDocument()
    const deleteButton = within(dialog).getByRole('button', { name: 'Delete project' })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Type Billing to confirm'), { target: { value: 'billing' } })
    expect(deleteButton).toBeDisabled()
    fireEvent.change(within(dialog).getByLabelText('Type Billing to confirm'), { target: { value: 'Billing' } })
    expect(deleteButton).toBeEnabled()
  })
})
