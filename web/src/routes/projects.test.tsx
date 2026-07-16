import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { createProject } from '../lib/api'
import { TestRouter } from '../test/router'
import { ProjectsRoute } from './projects'

vi.mock('../lib/api', () => ({
  createProject: vi.fn(async (input) => ({ id: 'project_2', ...input })),
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
        repository_connector_id: 'connector_github',
        repository_full_name: 'prosights/billing',
        repository_branch: 'main',
        created_at: '2026-06-25T00:00:00Z',
        updated_at: '2026-06-25T00:00:00Z',
      },
      {
        id: 'project_2',
        name: 'Recreate',
        slug: 'recreate',
        description: '',
        default_registry_id: null,
        default_registry_name: null,
        repository_connector_id: null,
        repository_full_name: null,
        repository_branch: null,
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
        repository_url: 'https://github.com/prosights/billing.git',
        branch: 'main',
        compose_path: 'docker-compose.yml',
        remote_directory: '/srv/api',
        domain: 'api.example.com',
        health_check_url: null,
        doppler_project: null,
        doppler_config: null,
        status: 'healthy',
        current_version: null,
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
  deploymentsQuery: {
    queryKey: ['deployments'],
    queryFn: async () => [],
  },
}))

describe('ProjectsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    vi.restoreAllMocks()
    cleanup()
  })

  function renderRoute() {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <TestRouter>
          <ProjectsRoute />
        </TestRouter>
      </QueryClientProvider>,
    )
  }

  it('renders one tile per project with repository and service facts', async () => {
    renderRoute()

    expect(await screen.findByText('Billing')).toBeInTheDocument()
    expect(screen.getByText('Recreate')).toBeInTheDocument()
    expect(screen.getByText('prosights/billing#main')).toBeInTheDocument()
    expect(screen.getByText('no repository connected')).toBeInTheDocument()
    expect(screen.getByText('1 service')).toBeInTheDocument()
    expect(screen.getByLabelText('Open project Billing')).toBeInTheDocument()
  })

  it('creates projects with normalized slugs', async () => {
    renderRoute()

    expect(screen.queryByRole('dialog', { name: 'Create project' })).not.toBeInTheDocument()
    fireEvent.click(await screen.findByRole('button', { name: 'Create project' }))
    expect(await screen.findByRole('dialog', { name: 'Create project' })).toBeInTheDocument()
    fireEvent.change(await screen.findByLabelText('Project name'), { target: { value: 'API Platform' } })
    fireEvent.click(screen.getByRole('button', { name: 'Create' }))

    await waitFor(() => {
      expect(createProject).toHaveBeenCalledWith(expect.objectContaining({
        name: 'API Platform',
        slug: 'api-platform',
      }))
    })
  })

  it('searches and filters projects', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Search projects'), { target: { value: 'recreate' } })
    expect(screen.queryByText('Billing')).not.toBeInTheDocument()
    expect(screen.getByText('Recreate')).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Search projects'), { target: { value: '' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Filter projects by status' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Healthy' }))
    expect(screen.getByText('Billing')).toBeInTheDocument()
    expect(screen.queryByText('Recreate')).not.toBeInTheDocument()

    fireEvent.click(screen.getByRole('combobox', { name: 'Filter projects by repository' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Not connected' }))
    expect(screen.getByText('No projects match these filters.')).toBeInTheDocument()
  })
})
