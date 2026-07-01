import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createEnvironment, createProject } from '../lib/api'
import { ProjectsRoute } from './projects'

vi.mock('../lib/api', () => ({
  createProject: vi.fn(async (input) => ({ id: 'project_2', ...input })),
  createEnvironment: vi.fn(async (input) => ({ id: 'env_2', ...input })),
  createApplication: vi.fn(async (input) => ({ id: 'app_2', ...input })),
  createProxyRoute: vi.fn(async (input) => ({ id: 'route_2', ...input })),
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
  })

  afterEach(() => {
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

    const nameInputs = await screen.findAllByLabelText('Name')
    const slugInputs = screen.getAllByLabelText('Slug')
    fireEvent.change(nameInputs[0], { target: { value: 'API Platform' } })
    fireEvent.change(slugInputs[0], { target: { value: ' API-Platform ' } })
    fireEvent.click(screen.getByRole('button', { name: /create/i }))

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

    const nameInputs = await screen.findAllByLabelText('Name')
    const slugInputs = screen.getAllByLabelText('Slug')
    fireEvent.change(nameInputs[1], { target: { value: 'PR 42' } })
    fireEvent.change(slugInputs[1], { target: { value: 'pr-42' } })
    fireEvent.change(screen.getByLabelText('Kind'), { target: { value: 'preview' } })
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

  it('shows applications inside the project environment cockpit', async () => {
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
})
