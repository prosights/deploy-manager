import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createApplication, type Application } from '../lib/api'
import { ApplicationsRoute } from './applications'

const mockState = vi.hoisted(() => ({
  applications: [] as Application[],
}))

vi.mock('../lib/api', () => ({
  createApplication: vi.fn(async (input) => input),
}))

vi.mock('../lib/queries', () => ({
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => mockState.applications,
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
  serversQuery: {
    queryKey: ['servers'],
    queryFn: async () => [
      {
        id: 'server_1',
        name: 'prod-1',
        hostname: '10.0.0.10',
        ssh_user: 'root',
        ssh_port: 22,
        ssh_key_path: null,
        proxy_type: 'caddy',
        status: 'unknown',
        cpu_usage: null,
        memory_usage: null,
        disk_usage: null,
        last_checked_at: null,
      },
    ],
  },
}))

describe('ApplicationsRoute', () => {
  beforeEach(() => {
    mockState.applications = []
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('creates application targets with Doppler scope only', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Health check URL'), { target: { value: 'https://api-{color}.example.com/healthz' } })
    fireEvent.change(screen.getByLabelText('Doppler project'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByLabelText('Doppler config'), { target: { value: 'prd' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createApplication).toHaveBeenCalledWith(
        expect.objectContaining({
          health_check_url: 'https://api-{color}.example.com/healthz',
          doppler_project: 'billing',
          doppler_config: 'prd',
        }),
      )
    })
    expect(screen.getByText(/blue-green health checks/i)).toBeInTheDocument()
  })

  it('normalizes application payloads before submit', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: ' api ' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: ' /srv/api ' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: ' API.Example.COM ' } })
    fireEvent.change(screen.getByLabelText('Health check URL'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: ' main ' } })
    fireEvent.change(screen.getByLabelText('Compose path'), { target: { value: ' docker-compose.yml ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createApplication).toHaveBeenCalledWith({
        environment_id: 'env_1',
        server_id: 'server_1',
        name: 'api',
        remote_directory: '/srv/api',
        repository_url: undefined,
        branch: 'main',
        compose_path: 'docker-compose.yml',
        domain: 'api.example.com',
        health_check_url: undefined,
        doppler_project: undefined,
        doppler_config: undefined,
      })
    })
  })

  it('shows current and target deployment versions', async () => {
    mockState.applications = [
      applicationFactory({ id: 'app_1', name: 'api', status: 'deploying', current_version: '1111111', target_version: 'abcdef1234567890' }),
      applicationFactory({ id: 'app_2', name: 'worker', status: 'healthy', current_version: '2222222', target_version: null }),
    ]
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('target abcdef123456')).toBeInTheDocument()
    expect(screen.getByText('current 2222222')).toBeInTheDocument()
  })

  it('rejects unsafe remote directories before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/../api' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Remote directory cannot contain parent directory segments.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalledWith(expect.objectContaining({ remote_directory: '/srv/../api' }))
  })

  it('rejects unsafe git branches before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Branch'), { target: { value: 'feature api' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Branch contains unsupported characters.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalledWith(expect.objectContaining({ branch: 'feature api' }))
  })

  it('rejects unsafe compose paths before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Compose path'), { target: { value: '../docker-compose.yml' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Compose path cannot contain parent directory segments.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalledWith(expect.objectContaining({ compose_path: '../docker-compose.yml' }))
  })

  it('rejects malformed domains before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'api..example.com' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Domain labels cannot be empty.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalledWith(expect.objectContaining({ domain: 'api..example.com' }))
  })

  it('rejects non-GitHub repositories before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Repository'), { target: { value: 'https://gitlab.com/acme/api.git' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Repository URL must be a GitHub owner/repository remote.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('rejects malformed health check URLs before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Health check URL'), { target: { value: 'ssh://api.example.com/healthz' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Health check URL must use http or https.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('rejects incomplete Doppler scope before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Doppler project'), { target: { value: 'billing' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Doppler project and config must be provided together.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalled()
  })

  it('rejects unsafe Doppler scope before creating an application target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ApplicationsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'api' } })
    fireEvent.change(screen.getByLabelText('Remote directory'), { target: { value: '/srv/api' } })
    fireEvent.change(screen.getByLabelText('Doppler project'), { target: { value: 'billing' } })
    fireEvent.change(screen.getByLabelText('Doppler config'), { target: { value: 'prd\tbad' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Doppler config cannot contain control characters.')).toBeInTheDocument()
    expect(createApplication).not.toHaveBeenCalled()
  })
})

function applicationFactory(overrides: Partial<Application>): Application {
  return {
    id: 'app',
    environment_id: 'env_1',
    server_id: 'server_1',
    name: 'api',
    repository_url: 'git@github.com:acme/api.git',
    branch: 'main',
    compose_path: 'docker-compose.yml',
    remote_directory: '/srv/api',
    domain: null,
    health_check_url: null,
    doppler_project: null,
    doppler_config: null,
    status: 'idle',
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
    ...overrides,
  }
}
