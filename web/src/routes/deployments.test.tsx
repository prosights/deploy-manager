import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { DeploymentsRoute } from './deployments'

const queryData = vi.hoisted(() => ({
  projects: [
    {
      id: 'project_1',
      name: 'Billing',
      slug: 'billing',
      description: 'Billing services',
      default_environment_id: 'env_1',
      default_registry_id: null,
      default_registry_name: null,
      created_at: '2026-06-23T00:00:00Z',
      updated_at: '2026-06-23T00:00:00Z',
    },
    {
      id: 'project_2',
      name: 'Internal',
      slug: 'internal',
      description: 'Internal services',
      default_environment_id: 'env_2',
      default_registry_id: null,
      default_registry_name: null,
      created_at: '2026-06-23T00:00:00Z',
      updated_at: '2026-06-23T00:00:00Z',
    },
  ],
  applications: [
    {
      id: 'app_1',
      project_id: 'project_1',
      name: 'api',
    },
    {
      id: 'app_2',
      project_id: 'project_2',
      name: 'worker',
    },
  ],
  githubRepositories: [
    {
      connector_id: 'github_1',
      application_id: 'app_1',
      repository: 'prosights/billing',
      clone_url: 'https://github.com/prosights/billing.git',
    },
    {
      connector_id: 'github_1',
      application_id: 'app_2',
      repository: 'prosights/internal',
      clone_url: 'https://github.com/prosights/internal.git',
    },
  ],
  githubCommits: {
    abc123456789: {
      sha: 'abc123456789',
      message: 'Merge billing notifications\n\nIncludes invoice webhooks.',
      author_name: 'Octo Cat',
      author_login: 'octocat',
      author_avatar_url: 'https://avatars.example.com/octocat.png',
      html_url: 'https://github.com/prosights/billing/commit/abc123456789',
    },
  },
  deployments: [
    {
      id: '11111111-1111-1111-1111-111111111111',
      application_id: 'app_1',
      server_id: 'server_1',
      trigger: 'github_push',
      strategy: 'blue_green',
      status: 'running',
      commit_sha: 'abc123456789',
      commit_message: 'Add invoice webhooks',
      image_ref: null,
      image_digest: null,
      actor: 'github-actions',
      application_name: 'api',
      server_name: 'prod-1',
      environment_name: 'Production',
      project_id: 'project_1',
      project_name: 'Billing',
      created_at: '2026-06-23T00:03:00Z',
      started_at: '2026-06-23T00:03:01Z',
      finished_at: null,
    },
    {
      id: '22222222-2222-2222-2222-222222222222',
      application_id: 'app_1',
      server_id: 'server_1',
      trigger: 'manual',
      strategy: 'blue_green',
      status: 'failed',
      commit_sha: 'def567890123',
      commit_message: 'Fix retry handling',
      image_ref: null,
      image_digest: null,
      actor: 'local-user',
      application_name: 'api',
      server_name: 'prod-1',
      environment_name: 'Production',
      project_id: 'project_1',
      project_name: 'Billing',
      created_at: '2026-06-23T00:02:00Z',
      started_at: '2026-06-23T00:02:01Z',
      finished_at: '2026-06-23T00:02:02Z',
    },
    {
      id: '33333333-3333-3333-3333-333333333333',
      application_id: 'app_2',
      server_id: 'server_2',
      trigger: 'retry',
      strategy: 'blue_green',
      status: 'succeeded',
      commit_sha: '987654321abc',
      commit_message: 'Ship monthly digest',
      image_ref: null,
      image_digest: null,
      actor: 'deploy-manager',
      application_name: 'worker',
      server_name: 'prod-2',
      environment_name: 'Production',
      project_id: 'project_2',
      project_name: 'Internal',
      created_at: '2026-06-23T00:01:00Z',
      started_at: '2026-06-23T00:01:01Z',
      finished_at: '2026-06-23T00:01:02Z',
    },
    ...Array.from({ length: 10 }, (_, index) => ({
      id: `${String(index + 4).padStart(8, '0')}-3333-3333-3333-333333333333`,
      application_id: 'app_2',
      server_id: 'server_2',
      trigger: 'github_push' as const,
      strategy: 'blue_green' as const,
      status: 'succeeded' as const,
      commit_sha: `987654321${String(index).padStart(3, '0')}`,
      commit_message: `Worker release ${index + 4}`,
      image_ref: null,
      image_digest: null,
      actor: 'deploy-manager',
      application_name: 'worker',
      server_name: 'prod-2',
      environment_name: 'Production',
      project_id: 'project_2',
      project_name: 'Internal',
      created_at: `2026-06-22T23:${String(59 - index).padStart(2, '0')}:00Z`,
      started_at: `2026-06-22T23:${String(59 - index).padStart(2, '0')}:01Z`,
      finished_at: `2026-06-22T23:${String(59 - index).padStart(2, '0')}:02Z`,
    })),
  ],
}))

vi.mock('../lib/queries', () => ({
  projectsQuery: {
    queryKey: ['projects'],
    queryFn: async () => queryData.projects,
  },
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => queryData.applications,
  },
  deploymentsQuery: {
    queryKey: ['deployments'],
    queryFn: async () => queryData.deployments,
  },
  githubRepositoriesQuery: {
    queryKey: ['github-repositories'],
    queryFn: async () => queryData.githubRepositories,
  },
  githubCommitQuery: (connectorID: string, repository: string, sha: string) => ({
    queryKey: ['github-commit', connectorID, repository, sha],
    queryFn: async () => queryData.githubCommits[sha as keyof typeof queryData.githubCommits] ?? {
      sha,
      message: '',
      author_name: '',
      author_login: '',
      author_avatar_url: '',
      html_url: '',
    },
    enabled: Boolean(connectorID && repository && sha),
  }),
  buildRunsQuery: {
    queryKey: ['build-runs'],
    queryFn: async () => [],
  },
  proxyRoutesQuery: {
    queryKey: ['proxy-routes'],
    queryFn: async () => [],
  },
  deploymentSlotsQuery: (applicationID: string) => ({
    queryKey: ['applications', applicationID, 'deployment-slots'],
    queryFn: async () => [],
  }),
}))

vi.mock('../features/deployments/logs', () => ({
  useDeploymentLogs: () => ({ logs: [], live: false }),
  DeploymentLogStream: () => null,
}))

function renderRoute() {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return render(
    <QueryClientProvider client={client}>
      <DeploymentsRoute />
    </QueryClientProvider>,
  )
}

describe('DeploymentsRoute', () => {
  beforeEach(() => {
    window.history.pushState(null, '', '/deployments')
  })

  afterEach(() => {
    cleanup()
  })

  it('shows commit messages and GitHub attribution without the old history heading', async () => {
    renderRoute()

    expect(await screen.findByRole('combobox', { name: 'Project' })).toBeInTheDocument()
    expect(screen.getByRole('table')).toBeInTheDocument()
    for (const heading of ['Status', 'Commit', 'Service / Project', 'Strategy', 'Trigger', 'Deployed', 'SHA']) {
      expect(screen.getByRole('columnheader', { name: heading })).toBeInTheDocument()
    }
    expect(screen.getAllByText('Billing').length).toBeGreaterThan(0)
    expect(screen.getAllByText('api').length).toBeGreaterThan(0)
    expect(await screen.findByText('Merge billing notifications')).toBeInTheDocument()
    expect((await screen.findByTitle('octocat')).querySelector('img')).toHaveAttribute('src', 'https://avatars.example.com/octocat.png')
    expect(screen.getAllByText('via GitHub').length).toBeGreaterThan(0)
    expect(screen.queryByText('History')).not.toBeInTheDocument()
    expect(screen.queryByText(/Past deployments/i)).not.toBeInTheDocument()
  })

  it('opens a deployment directly with a link to its project', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: 'Open deployment 22222222' }))

    expect(await screen.findByRole('dialog')).toBeInTheDocument()
    expect(screen.getByRole('link', { name: 'Go to project' })).toHaveAttribute('href', '/projects/project_1?service=app_1')
    expect(window.location.search).toBe('?deployment=22222222-2222-2222-2222-222222222222')

    fireEvent.click(screen.getByRole('button', { name: 'Close deployment' }))
    await waitFor(() => expect(screen.queryByRole('dialog')).not.toBeInTheDocument())
    expect(window.location.search).toBe('')
  })

  it('searches deployment messages and metadata', async () => {
    renderRoute()

    fireEvent.change(await screen.findByRole('searchbox', { name: 'Search deployments' }), { target: { value: 'monthly digest' } })

    expect(screen.getByText('Ship monthly digest')).toBeInTheDocument()
    expect(screen.queryByText('Merge billing notifications')).not.toBeInTheDocument()
  })

  it('filters deployments by service', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('combobox', { name: 'Service' }))
    fireEvent.click(await screen.findByRole('option', { name: 'worker' }))

    expect(screen.getByText('Ship monthly digest')).toBeInTheDocument()
    expect(screen.queryByText('Merge billing notifications')).not.toBeInTheDocument()
    expect(screen.queryByText('Fix retry handling')).not.toBeInTheDocument()
  })

  it('paginates the filtered deployment list', async () => {
    renderRoute()

    expect(await screen.findByText('Merge billing notifications')).toBeInTheDocument()
    expect(screen.getByText('Showing 1–10 of 13')).toBeInTheDocument()
    expect(screen.queryByText('Worker release 13')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('button', { name: 'Next' }))

    expect(screen.getByText('Worker release 13')).toBeInTheDocument()
    expect(screen.queryByText('Merge billing notifications')).not.toBeInTheDocument()
    expect(screen.getByRole('button', { name: 'Previous' })).toBeEnabled()
  })

  it('filters the activity feed by project and keeps the filter in the URL', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('combobox', { name: 'Project' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Internal' }))

    await waitFor(() => {
      expect(screen.queryByText('Merge billing notifications')).not.toBeInTheDocument()
      expect(screen.getByText('Ship monthly digest')).toBeInTheDocument()
    })
    expect(window.location.search).toBe('?project=project_2')
  })

  it('restores a project filter from the URL', async () => {
    window.history.replaceState(null, '', '/deployments?project=project_1')
    renderRoute()

    expect(await screen.findByText('Merge billing notifications')).toBeInTheDocument()
    expect(screen.getByText('Fix retry handling')).toBeInTheDocument()
    expect(screen.queryByText('Ship monthly digest')).not.toBeInTheDocument()
  })
})
