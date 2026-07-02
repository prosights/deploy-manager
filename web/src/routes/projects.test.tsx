import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvironment, createProject, deleteApplication, deleteEnvironment, deleteProject, deleteProxyRoute, updateProject } from '../lib/api'
import { ProjectsRoute } from './projects'

vi.mock('../lib/api', () => ({
  createProject: vi.fn(async (input) => ({ id: 'project_2', ...input })),
  createEnvironment: vi.fn(async (input) => ({ id: 'env_2', ...input })),
  createApplication: vi.fn(async (input) => ({ id: 'app_2', ...input })),
  createProxyRoute: vi.fn(async (input) => ({ id: 'route_2', ...input })),
  deleteApplication: vi.fn(async () => undefined),
  deleteEnvironment: vi.fn(async () => undefined),
  deleteProject: vi.fn(async () => undefined),
  deleteProxyRoute: vi.fn(async () => undefined),
  updateProject: vi.fn(async (projectID, input) => ({ id: projectID, ...input })),
  applyProxyRoute: vi.fn(async (routeID) => ({ id: routeID, status: 'applied' })),
  updateProjectRegistry: vi.fn(async (projectID, defaultRegistryID) => ({ id: projectID, default_registry_id: defaultRegistryID })),
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
        project_name: 'Billing',
        project_slug: 'billing',
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

describe('ProjectsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    vi.spyOn(window, 'confirm').mockReturnValue(true)
  })

  afterEach(() => {
    vi.restoreAllMocks()
    window.location.hash = ''
    cleanup()
  })

  it('creates projects with normalized slugs', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProjectsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('New app'), { target: { value: 'API Platform' } })
    fireEvent.click(screen.getByRole('button', { name: /create app/i }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
        name: 'API Platform',
        slug: 'api-platform',
      }))
    })
  })

  it('creates ephemeral PR preview environments', async () => {
    window.location.hash = '#environments'
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProjectsRoute />
      </QueryClientProvider>,
    )

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

  it('shows services inside the project environment cockpit', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProjectsRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('API')).toBeInTheDocument()
    expect(screen.getAllByText('api.example.com').length).toBeGreaterThanOrEqual(1)
    expect(screen.getByText('api / prd')).toBeInTheDocument()
  })

  it('deletes project-owned resources from project screens', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProjectsRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByLabelText('Delete app Billing'))
    await waitFor(() => expect(vi.mocked(deleteProject).mock.calls[0]?.[0]).toBe('project_1'))

    fireEvent.click(screen.getByLabelText('Delete environment Production'))
    await waitFor(() => expect(vi.mocked(deleteEnvironment).mock.calls[0]?.[0]).toBe('env_1'))

    fireEvent.click(screen.getByLabelText('Delete service API'))
    await waitFor(() => expect(vi.mocked(deleteApplication).mock.calls[0]?.[0]).toBe('app_1'))

    window.location.hash = '#routes'
    window.dispatchEvent(new HashChangeEvent('hashchange'))
    fireEvent.click(await screen.findByLabelText('Delete route api.example.com'))
    await waitFor(() => expect(vi.mocked(deleteProxyRoute).mock.calls[0]?.[0]).toBe('route_1'))
  })

  it('updates project identity from settings', async () => {
    window.location.hash = '#settings'
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProjectsRoute />
      </QueryClientProvider>,
    )

    const settingsPanel = (await screen.findByText('Project identity')).closest('section')
    if (!settingsPanel) throw new Error('Project identity panel not found')

    fireEvent.change(within(settingsPanel).getByLabelText('App name'), { target: { value: 'Recreate Worker' } })
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

  it('keeps app switching out of project settings', async () => {
    window.location.hash = '#settings'
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProjectsRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Project identity')).toBeInTheDocument()
    expect(screen.queryByLabelText('New app')).not.toBeInTheDocument()
    expect(screen.queryByText('Setup path')).not.toBeInTheDocument()
  })
})
