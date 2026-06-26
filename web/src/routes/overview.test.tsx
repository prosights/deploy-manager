import { render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { describe, expect, it, vi } from 'vitest'
import { OverviewRoute } from './overview'

vi.mock('../lib/queries', () => ({
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => [
      {
        id: 'app_1',
        environment_id: 'env_1',
        server_id: 'server_1',
        name: 'api',
        repository_url: null,
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
      },
    ],
  },
  connectorsQuery: {
    queryKey: ['connectors'],
    queryFn: async () => [
      { id: 'connector_1', provider: 'github', name: 'GitHub', enabled: true, last_sync_status: null, last_sync_message: null, last_synced_at: null },
      { id: 'connector_2', provider: 'slack', name: 'Slack', enabled: false, last_sync_status: null, last_sync_message: null, last_synced_at: null },
    ],
  },
  credentialsQuery: {
    queryKey: ['credentials'],
    queryFn: async () => [
      {
        id: 'cred_1',
        name: 'GitHub deploy key',
        provider: 'github',
        external_ref: 'repo:api',
        credential_type: 'deploy_key',
        status: 'active',
        permission_count: 1,
        usage_count: 1,
        last_seen_at: null,
      },
    ],
  },
  deploymentsQuery: {
    queryKey: ['deployments'],
    queryFn: async () => [
      {
        id: 'deployment_1',
        application_id: 'app_1',
        server_id: 'server_1',
        trigger: 'manual',
        strategy: 'rolling',
        status: 'running',
        commit_sha: null,
        actor: 'local-user',
        application_name: 'api',
        server_name: 'prod-1',
        created_at: '2026-06-23T00:00:00Z',
        started_at: '2026-06-23T00:01:00Z',
        finished_at: null,
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
        ssh_key_path: '~/.ssh/id_ed25519',
        proxy_type: 'caddy',
        status: 'healthy',
        cpu_usage: 12,
        memory_usage: 45,
        disk_usage: 61,
        last_checked_at: null,
      },
    ],
  },
}))

describe('OverviewRoute', () => {
  it('summarizes server health, active deployment, and inventory counts', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <OverviewRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('Operations')).toBeInTheDocument()
    expect(screen.getByText('10.0.0.10')).toBeInTheDocument()
    expect(screen.getByText('Strategy')).toBeInTheDocument()
    expect(screen.getByText('rolling')).toBeInTheDocument()
    expect(screen.getByText('Trigger')).toBeInTheDocument()
    expect(screen.getByText('manual')).toBeInTheDocument()
    expect(screen.getByText('not pinned')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: /new deployment/i })).toHaveAttribute('href', '/deployments')
    expect(screen.getByText('compose targets')).toBeInTheDocument()
    expect(screen.getByText('tracked credentials')).toBeInTheDocument()
    expect(screen.getByText('enabled connectors')).toBeInTheDocument()
  })
})
