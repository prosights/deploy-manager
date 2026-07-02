import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { applyProxyRoute, createProxyRoute } from '../lib/api'
import { ProxyRoute } from './proxy'

vi.mock('../lib/api', () => ({
  applyProxyRoute: vi.fn(async (routeID: string) => ({ id: routeID, status: 'applied' })),
  createProxyRoute: vi.fn(async (input) => input),
}))

vi.mock('../lib/queries', () => ({
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => [
      {
        id: 'app_1',
        environment_id: 'env_1',
        server_id: 'server_2',
        name: 'api',
        repository_url: null,
        branch: 'main',
        compose_path: 'docker-compose.yml',
        remote_directory: '/srv/api',
        domain: 'api.example.com',
        health_check_url: 'https://api-{color}.example.com/healthz',
        doppler_project: null,
        doppler_config: null,
        status: 'idle',
        current_version: null,
        target_version: null,
        server_name: 'prod-2',
        environment_name: 'Production',
        environment_slug: 'production',
        environment_kind: 'production',
        environment_is_ephemeral: false,
        project_id: 'project_1',
        project_name: 'Billing',
        project_slug: 'billing',
      },
      {
        id: 'app_2',
        environment_id: 'env_1',
        server_id: 'server_1',
        name: 'worker',
        repository_url: null,
        branch: 'main',
        compose_path: 'docker-compose.yml',
        remote_directory: '/srv/worker',
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
      },
    ],
  },
  proxyRoutesQuery: {
    queryKey: ['proxy-routes'],
    queryFn: async () => [
      {
        id: 'route_1',
        server_id: 'server_2',
        application_id: 'app_1',
        domain: 'api.example.com',
        upstream_url: 'http://127.0.0.1:8080',
        tls_enabled: true,
        status: 'applied',
        last_applied_at: '2026-06-23T12:00:00Z',
        server_name: 'prod-2',
        environment_name: 'Production',
        environment_slug: 'production',
        environment_kind: 'production',
        environment_is_ephemeral: false,
        project_id: 'project_1',
        project_name: 'Billing',
        project_slug: 'billing',
        proxy_type: 'caddy',
        application_name: 'api',
      },
    ],
  },
  serversQuery: {
    queryKey: ['servers'],
    queryFn: async () => [
      {
        id: 'server_1',
        name: 'prod-1',
        hostname: '10.0.0.1',
        ssh_user: 'root',
        ssh_port: 22,
        ssh_key_path: null,
        connection_mode: 'direct_ssh',
        proxy_type: 'caddy',
        status: 'unknown',
        cpu_usage: null,
        memory_usage: null,
        disk_usage: null,
        last_checked_at: null,
      },
      {
        id: 'server_2',
        name: 'prod-2',
        hostname: '10.0.0.2',
        ssh_user: 'root',
        ssh_port: 22,
        ssh_key_path: null,
        connection_mode: 'direct_ssh',
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

describe('ProxyRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  it('creates linked proxy routes by application target only', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Application'), { target: { value: 'app_1' } })
    expect(await screen.findByText(/Server selection is derived/)).toBeInTheDocument()
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'http://127.0.0.1:8080' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createProxyRoute).toHaveBeenCalledWith(
        expect.objectContaining({
          application_id: 'app_1',
          domain: 'api.example.com',
          upstream_url: 'http://127.0.0.1:8080',
        }),
      )
      expect(createProxyRoute).toHaveBeenCalledWith(
        expect.not.objectContaining({
          server_id: expect.any(String),
        }),
      )
    })
  })

  it('applies proxy routes by route id and shows last applied state', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('api.example.com')).toBeInTheDocument()
    expect(screen.getByText(/6\/23\/2026|23\/6\/2026|2026/)).toBeInTheDocument()
    fireEvent.click(screen.getByRole('button', { name: /apply/i }))

    await waitFor(() => {
      expect(applyProxyRoute).toHaveBeenCalledWith('route_1')
    })
  })

  it('normalizes proxy route domains before submit', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: ' API.Example.COM ' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: ' http://127.0.0.1:8080 ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createProxyRoute).toHaveBeenCalledWith(expect.objectContaining({
        domain: 'api.example.com',
        upstream_url: 'http://127.0.0.1:8080',
      }))
    })
  })

  it('clears stale domains when linking an application without a domain', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'api.example.com' } })
    fireEvent.change(screen.getByLabelText('Application'), { target: { value: 'app_2' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'http://127.0.0.1:8080' } })

    expect(screen.getByLabelText('Domain')).toHaveValue('')
    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    expect(createProxyRoute).not.toHaveBeenCalledWith(expect.objectContaining({
      application_id: 'app_2',
      domain: 'api.example.com',
    }))
  })

  it('rejects malformed proxy domains before creating a route', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'api..example.com' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'http://127.0.0.1:8080' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Domain labels cannot be empty.')).toBeInTheDocument()
    expect(createProxyRoute).not.toHaveBeenCalledWith(expect.objectContaining({ domain: 'api..example.com' }))
  })

  it('rejects unsupported proxy upstream URLs before creating a route', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'api.example.com' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'ssh://127.0.0.1:22' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Upstream URL must use http or https.')).toBeInTheDocument()
    expect(createProxyRoute).not.toHaveBeenCalledWith(expect.objectContaining({ upstream_url: 'ssh://127.0.0.1:22' }))
  })

  it('rejects proxy upstream URLs with control characters', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'api.example.com' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'http://127.0.0.1:8080\t' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Upstream URL cannot contain control characters.')).toBeInTheDocument()
    expect(createProxyRoute).not.toHaveBeenCalled()
  })

  it('rejects proxy upstream URLs with embedded credentials', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'api.example.com' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'https://user:password@127.0.0.1:8443' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Upstream URL cannot include credentials.')).toBeInTheDocument()
    expect(createProxyRoute).not.toHaveBeenCalledWith(expect.objectContaining({ upstream_url: 'https://user:password@127.0.0.1:8443' }))
  })

  it('rejects proxy upstream URLs with path query or fragment', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ProxyRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Domain'), { target: { value: 'api.example.com' } })
    fireEvent.change(screen.getByLabelText('Upstream'), { target: { value: 'http://127.0.0.1:8080/api?target=api#deploy' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('Upstream URL must be an origin URL without path, query, or fragment.')).toBeInTheDocument()
    expect(createProxyRoute).not.toHaveBeenCalledWith(expect.objectContaining({ upstream_url: 'http://127.0.0.1:8080/api?target=api#deploy' }))
  })
})
