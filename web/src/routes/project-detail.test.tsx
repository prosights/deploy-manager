import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import {
  createApplication,
  createEnvironment,
  deleteApplication,
  deleteEnvironment,
  deleteProject,
  deleteProxyRoute,
  detectGitHubRepositoryServices,
  importGitHubRepositoryServices,
  updateProject,
  updateProjectRepository,
} from '../lib/api'
import { TestRouter } from '../test/router'
import { ProjectDetailRoute } from './project-detail'

vi.mock('../lib/api', () => ({
  applyProxyRoute: vi.fn(async (routeID) => ({ id: routeID, status: 'applied' })),
  createApplication: vi.fn(async (input) => ({ id: 'app_2', ...input })),
  createEnvironment: vi.fn(async (input) => ({ id: 'env_9', ...input })),
  createProxyRoute: vi.fn(async (input) => ({ id: 'route_2', ...input })),
  deleteApplication: vi.fn(async () => undefined),
  deleteEnvironment: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
  deleteProxyRoute: vi.fn(async () => undefined),
  detectGitHubRepositoryServices: vi.fn(async () => ({
    repository: 'prosights/recreate',
    branch: 'release/2026-07',
    services: [
      { name: 'web', root: 'web', compose_path: 'web/docker-compose.yml', path_filters: ['web/**'] },
      { name: 'worker', root: 'worker', compose_path: 'worker/docker-compose.yml', path_filters: ['worker/**'] },
    ],
  })),
  importGitHubRepositoryServices: vi.fn(async () => ({ applications: [], connector: {} })),
  listGitHubRepositoryBranches: vi.fn(async () => ({ repository: 'prosights/recreate', branches: ['main', 'release/2026-07'] })),
  updateProject: vi.fn(async (projectID, input) => ({ id: projectID, ...input })),
  updateProjectRegistry: vi.fn(async (projectID, defaultRegistryID) => ({ id: projectID, default_registry_id: defaultRegistryID })),
  updateProjectRepository: vi.fn(async (projectID, input) => ({ id: projectID, ...input })),
  upsertContainerRegistry: vi.fn(async (input) => ({ id: 'registry_2', ...input })),
}))

vi.mock('../lib/queries', () => ({
  projectsQuery: {
    queryKey: ['projects'],
    queryFn: async () => [
      {
        id: 'project_1',
        name: 'Billing',
        slug: 'billing',
        description: 'Billing stack',
        default_registry_id: null,
        default_registry_name: null,
        repository_connector_id: null,
        repository_full_name: null,
        repository_branch: null,
        created_at: '2026-06-25T00:00:00Z',
        updated_at: '2026-06-25T00:00:00Z',
      },
      {
        id: 'project_2',
        name: 'Recreate',
        slug: 'recreate',
        description: 'Monorepo product',
        default_registry_id: 'registry_1',
        default_registry_name: 'GAR',
        repository_connector_id: 'connector_github',
        repository_full_name: 'prosights/recreate',
        repository_branch: 'release/2026-07',
        created_at: '2026-06-25T00:00:00Z',
        updated_at: '2026-06-25T00:00:00Z',
      },
    ],
  },
  environmentsQuery: {
    queryKey: ['environments'],
    queryFn: async () => [
      {
        id: 'env_1',
        project_id: 'project_1',
        name: 'Production',
        slug: 'production',
        kind: 'production',
        is_ephemeral: false,
        pull_request_number: null,
        branch: null,
        expires_at: null,
        created_at: '2026-06-25T00:00:00Z',
        updated_at: '2026-06-25T00:00:00Z',
      },
      {
        id: 'env_2',
        project_id: 'project_2',
        name: 'Production',
        slug: 'production',
        kind: 'production',
        is_ephemeral: false,
        pull_request_number: null,
        branch: null,
        expires_at: null,
        created_at: '2026-06-25T00:00:00Z',
        updated_at: '2026-06-25T00:00:00Z',
      },
    ],
  },
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => [
      {
        id: 'app_1',
        environment_id: 'env_1',
        server_id: 'server_1',
        name: 'API',
        repository_url: 'git@github.com:prosights/api.git',
        branch: 'main',
        compose_path: 'docker-compose.yml',
        remote_directory: '/srv/api',
        domain: 'api.example.com',
        health_check_url: 'https://api.example.com/healthz',
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
      },
    ],
  },
  serversQuery: {
    queryKey: ['servers'],
    queryFn: async () => [
      {
        id: 'server_1',
        name: 'app-01',
        hostname: '10.0.0.1',
        ssh_user: 'deploy',
        ssh_port: 22,
        ssh_key_path: '~/.ssh/id_ed25519',
        connection_mode: 'direct_ssh',
        proxy_type: 'caddy',
        status: 'healthy',
        cpu_usage: null,
        memory_usage: null,
        disk_usage: null,
        last_checked_at: null,
      },
    ],
  },
  containerRegistriesQuery: {
    queryKey: ['container-registries'],
    queryFn: async () => [],
  },
  githubRepositoriesQuery: {
    queryKey: ['github-repositories'],
    queryFn: async () => [
      {
        connector_id: 'connector_github',
        connector_name: 'GitHub',
        installation_id: '123456',
        repository: 'prosights/recreate',
        branch: 'release/2026-07',
        clone_url: 'https://github.com/prosights/recreate.git',
        web_url: 'https://github.com/prosights/recreate',
      },
    ],
  },
  proxyRoutesQuery: {
    queryKey: ['proxy-routes'],
    queryFn: async () => [
      {
        id: 'route_1',
        server_id: 'server_1',
        application_id: 'app_1',
        domain: 'api.example.com',
        upstream_url: 'http://127.0.0.1:3000',
        blue_upstream_url: null,
        green_upstream_url: null,
        tls_enabled: true,
        status: 'applied',
        last_applied_at: null,
        server_name: 'app-01',
        proxy_type: 'caddy',
        application_name: 'API',
      },
    ],
  },
}))

describe('ProjectDetailRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.location.hash = ''
    cleanup()
  })

  function renderRoute(projectId: string) {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <TestRouter>
          <ProjectDetailRoute projectId={projectId} />
        </TestRouter>
      </QueryClientProvider>,
    )
  }

  it('connects a github repository and branch to the project', async () => {
    renderRoute('project_1')

    fireEvent.change(await screen.findByLabelText('GitHub repository'), { target: { value: 'connector_github:prosights/recreate' } })
    fireEvent.change(screen.getByLabelText('Branch to deploy'), { target: { value: 'release/2026-07' } })
    fireEvent.click(screen.getByRole('button', { name: /connect repository/i }))

    await waitFor(() => {
      expect(updateProjectRepository).toHaveBeenCalledWith('project_1', {
        connector_id: 'connector_github',
        repository: 'prosights/recreate',
        branch: 'release/2026-07',
      })
    })
  })

  it('detects and creates repository applications onto one server', async () => {
    window.location.hash = '#applications'
    renderRoute('project_2')

    fireEvent.click(await screen.findByRole('button', { name: /detect applications/i }))

    await waitFor(() => {
      expect(detectGitHubRepositoryServices).toHaveBeenCalledWith({
        connector_id: 'connector_github',
        repository: 'prosights/recreate',
        branch: 'release/2026-07',
      })
    })

    expect(await screen.findByText('web/docker-compose.yml')).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /create 2 applications/i }))

    await waitFor(() => {
      expect(importGitHubRepositoryServices).toHaveBeenCalledWith('project_2', {
        connector_id: 'connector_github',
        repository: 'prosights/recreate',
        branch: 'release/2026-07',
        environment_id: 'env_2',
        server_id: 'server_1',
        services: ['web', 'worker'],
      })
    })
  })

  it('creates ephemeral PR preview environments', async () => {
    window.location.hash = '#environments'
    renderRoute('project_1')

    fireEvent.change(await screen.findByLabelText('Environment'), { target: { value: 'PR 42' } })
    fireEvent.change(screen.getByLabelText('Type'), { target: { value: 'preview' } })
    fireEvent.click(screen.getByRole('button', { name: /advanced/i }))
    fireEvent.change(screen.getByLabelText('PR'), { target: { value: '42' } })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'feature/api' } })
    fireEvent.click(screen.getByRole('button', { name: /add/i }))

    await waitFor(() => {
      expect(createEnvironment).toHaveBeenCalledWith(expect.objectContaining({
        project_id: 'project_1',
        kind: 'preview',
        is_ephemeral: true,
        pull_request_number: 42,
        branch: 'feature/api',
      }))
    })
  })

  it('shows applications inside the project environment board', async () => {
    renderRoute('project_1')

    expect(await screen.findByText('API')).toBeInTheDocument()
    expect(screen.getAllByText('api.example.com').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('api / prd')).toBeInTheDocument()
  })

  it('creates manual application placements from connected github repositories', async () => {
    window.location.hash = '#applications'
    renderRoute('project_1')

    fireEvent.change(await screen.findByLabelText('GitHub repo'), { target: { value: 'https://github.com/prosights/recreate.git' } })
    fireEvent.change(screen.getByLabelText('Application'), { target: { value: 'recreate' } })
    fireEvent.click(screen.getByRole('button', { name: /^add$/i }))

    await waitFor(() => {
      expect(createApplication).toHaveBeenCalledWith(expect.objectContaining({
        repository_url: 'https://github.com/prosights/recreate.git',
        branch: 'release/2026-07',
        name: 'recreate',
      }))
    })
  })

  it('deletes project-owned resources from project screens', async () => {
    renderRoute('project_1')

    fireEvent.click(await screen.findByLabelText('Delete environment Production'))
    await waitFor(() => expect(vi.mocked(deleteEnvironment).mock.calls[0]?.[0]).toBe('env_1'))

    fireEvent.click(screen.getByLabelText('Delete application API'))
    await waitFor(() => expect(vi.mocked(deleteApplication).mock.calls[0]?.[0]).toBe('app_1'))

    window.location.hash = '#routes'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    fireEvent.click(await screen.findByLabelText('Delete route api.example.com'))
    await waitFor(() => expect(vi.mocked(deleteProxyRoute).mock.calls[0]?.[0]).toBe('route_1'))

    window.location.hash = '#settings'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    fireEvent.click(await screen.findByLabelText('Delete project Billing'))
    await waitFor(() => expect(deleteProject).toHaveBeenCalledWith('project_1'))
  })

  it('updates project identity from settings', async () => {
    window.location.hash = '#settings'
    renderRoute('project_1')

    const settingsPanel = (await screen.findByText('Project identity')).closest('section')
    if (!settingsPanel) throw new Error('Project identity panel not found')

    fireEvent.change(within(settingsPanel).getByLabelText('Project name'), { target: { value: 'Recreate Worker' } })
    fireEvent.change(within(settingsPanel).getByLabelText('Slug'), { target: { value: 'recreate-worker' } })
    fireEvent.change(within(settingsPanel).getByLabelText('Description'), { target: { value: 'Chart recreation service' } })
    fireEvent.click(within(settingsPanel).getByRole('button', { name: /save changes/i }))

    await waitFor(() => {
      expect(updateProject).toHaveBeenCalledWith('project_1', {
        name: 'Recreate Worker',
        slug: 'recreate-worker',
        description: 'Chart recreation service',
      })
    })
  })
})
