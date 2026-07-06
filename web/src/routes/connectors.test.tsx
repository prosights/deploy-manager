import { cleanup, render, screen } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { ConnectorsRoute } from './connectors'

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
    expect(await screen.findByText('GitHub')).toBeTruthy()
    expect(screen.getByText('Doppler')).toBeTruthy()
    expect(screen.getByText('Docker Registry')).toBeTruthy()
  })

  it('shows connected repositories', async () => {
    renderRoute()
    expect((await screen.findAllByText('prosights/recreate')).length).toBeGreaterThan(0)
  })

  it('shows recent builds', async () => {
    renderRoute()
    expect(await screen.findByText('succeeded')).toBeTruthy()
  })
})
