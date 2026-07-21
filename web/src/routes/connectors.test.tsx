import { cleanup, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncGitHubConnectorRepositories } from '../lib/api'
import { ConnectorsRoute } from './connectors'

let mockConnectors = [
  {
    id: 'connector_github',
    provider: 'github',
    name: 'GitHub',
    enabled: true,
    has_config: true,
    config: { installation_id: '123456', repositories: [{ repository: 'prosights/recreate' }] },
    last_sync_status: null,
    last_sync_message: null,
    last_synced_at: null,
  },
]

vi.mock('../lib/api', () => ({
  dispatchGitHubBuild: vi.fn(async () => ({
    build: { id: 'build_1', provider: 'github_actions', status: 'dispatched', repository: 'acme/app', branch: 'main' },
  })),
  syncGitHubConnectorRepositories: vi.fn(async () => ({ connector: { id: 'c1' }, repositories: [] })),
  upsertContainerRegistry: vi.fn(async (input) => ({ id: 'reg_1', ...input, created_at: '', updated_at: '' })),
}))

vi.mock('../lib/queries', () => ({
  githubStatusQuery: {
    queryKey: ['github-status'],
    queryFn: async () => ({
      webhook_configured: true,
      app_configured: true,
      repository_sync_enabled: true,
      build_dispatch_enabled: true,
      install_url: 'https://github.com/apps/deploy-manager/installations/new',
      missing: [],
    }),
  },
  dopplerStatusQuery: {
    queryKey: ['doppler-status'],
    queryFn: async () => ({
      connector_configured: true,
      cli_available: true,
      ready: true,
      missing: [],
      message: 'Doppler is ready',
    }),
  },
  dopplerProjectsQuery: {
    queryKey: ['doppler-projects'],
    queryFn: async () => ['alleyes', 'evals'],
  },
  githubRepositoriesQuery: {
    queryKey: ['github-repositories'],
    queryFn: async () => [
      {
        connector_id: 'connector_github',
        connector_name: 'GitHub',
        installation_id: '123456',
        repository: 'prosights/recreate',
        branch: 'main',
        clone_url: 'https://github.com/prosights/recreate.git',
        web_url: 'https://github.com/prosights/recreate',
      },
    ],
  },
  buildRunsQuery: {
    queryKey: ['build-runs'],
    queryFn: async () => [
      {
        id: 'build_existing',
        provider: 'github_actions',
        connector_id: 'connector_github',
        repository: 'prosights/recreate',
        branch: 'main',
        workflow_id: 'deploy-manager-build.yml',
        status: 'succeeded',
        commit_sha: null,
        image_ref: 'us-docker.pkg.dev/prosights/recreate/app:main',
        image_digest: null,
        external_url: null,
        error_message: null,
        started_at: '2026-07-03T17:00:00Z',
        completed_at: '2026-07-03T17:01:00Z',
        created_at: '2026-07-03T17:00:00Z',
        updated_at: '2026-07-03T17:01:00Z',
      },
    ],
  },
  containerRegistriesQuery: {
    queryKey: ['container-registries'],
    queryFn: async () => [],
  },
  connectorsQuery: {
    queryKey: ['connectors'],
    queryFn: async () => mockConnectors,
  },
}))

vi.mock('../lib/search', () => ({
  matchesSearch: () => true,
}))

vi.mock('../store/ui', () => ({
  useUiStore: () => '',
}))

describe('ConnectorsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    mockConnectors = [{
      id: 'connector_github',
      provider: 'github',
      name: 'GitHub',
      enabled: true,
      has_config: true,
      config: { installation_id: '123456', repositories: [{ repository: 'prosights/recreate' }] },
      last_sync_status: null,
      last_sync_message: null,
      last_synced_at: null,
    }]
  })

  afterEach(() => {
    cleanup()
  })

  function renderRoute() {
    const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false, gcTime: 0 } } })
    return render(
      <QueryClientProvider client={queryClient}>
        <ConnectorsRoute />
      </QueryClientProvider>,
    )
  }

  it('renders integration cards with status', async () => {
    renderRoute()
    expect((await screen.findAllByText('GitHub')).length).toBeGreaterThan(0)
    expect(screen.getAllByText('Doppler').length).toBeGreaterThan(0)
    expect(screen.getByText('Docker Registry')).toBeTruthy()
    expect(screen.queryByRole('link', { name: /connect/i })).not.toBeInTheDocument()
  })

  it('shows install action when app credentials exist without an installation', async () => {
    mockConnectors = []
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: 'Open GitHub integration' }))
    const install = await screen.findByRole('link', { name: /install github app/i })
    expect(install).toHaveAttribute('href', 'https://github.com/apps/deploy-manager/installations/new')
  })

  it('opens Doppler status and explains service-level configuration', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: 'Open Doppler integration' }))

    expect(await screen.findByRole('dialog', { name: 'Doppler' })).toBeTruthy()
    expect(screen.getByText('Connected Doppler account')).toBeTruthy()
    expect(screen.getByText(/Each Compose service chooses its own Doppler project and config/)).toBeTruthy()
    expect(await screen.findByText('alleyes')).toBeTruthy()
  })

  it('syncs GitHub repositories from the connector dialog', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: 'Open GitHub integration' }))
    const dialog = await screen.findByRole('dialog', { name: 'GitHub' })
    expect(within(dialog).getByText('Webhook')).toBeTruthy()
    fireEvent.click(within(dialog).getByText('Available repositories'))
    expect(await within(dialog).findByText('prosights/recreate')).toBeTruthy()
    fireEvent.click(await screen.findByRole('button', { name: /refresh repository list/i }))

    await waitFor(() => {
      expect(syncGitHubConnectorRepositories).toHaveBeenCalledWith('connector_github')
    })
  })
})
