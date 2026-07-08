import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useUiStore } from '../store/ui'
import { TestRouter } from '../test/router'
import { CommandPalette } from './command-palette'

vi.mock('../lib/queries', () => ({
  projectsQuery: {
    queryKey: ['projects'],
    queryFn: async () => [
      {
        id: 'project_1',
        name: 'Billing',
        slug: 'billing',
        description: '',
        default_registry_id: null,
        repository_connector_id: 'connector_github',
        repository_full_name: 'prosights/billing',
        repository_branch: 'main',
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
        name: 'billing-api',
        project_id: 'project_1',
        project_name: 'Billing',
        environment_name: 'Production',
        server_name: 'app-01',
        status: 'healthy',
        branch: 'main',
        compose_path: 'docker-compose.yml',
        remote_directory: '/srv/api',
      },
    ],
  },
  serversQuery: {
    queryKey: ['servers'],
    queryFn: async () => [
      { id: 'server_1', name: 'app-01', hostname: '10.0.0.1', status: 'healthy' },
    ],
  },
}))

describe('CommandPalette', () => {
  beforeEach(() => {
    useUiStore.setState({ commandPaletteOpen: false })
  })

  afterEach(() => {
    cleanup()
  })

  async function renderPalette() {
    const client = new QueryClient()
    render(
      <QueryClientProvider client={client}>
        <TestRouter>
          <div data-testid="palette-host" />
          <CommandPalette />
        </TestRouter>
      </QueryClientProvider>,
    )
    await screen.findByTestId('palette-host')
  }

  it('opens with ctrl+k and lists pages, projects, services, and servers', async () => {
    await renderPalette()

    fireEvent.keyDown(window, { key: 'k', ctrlKey: true })

    expect(await screen.findByRole('dialog', { name: 'Command palette' })).toBeInTheDocument()
    expect(await screen.findByText('Billing')).toBeInTheDocument()
    expect(screen.getByText('billing-api')).toBeInTheDocument()
    expect(screen.getByText('app-01')).toBeInTheDocument()
    expect(screen.getByText('Deployments')).toBeInTheDocument()
  })

  it('filters results by query and closes on escape', async () => {
    await renderPalette()

    fireEvent.keyDown(window, { key: 'k', metaKey: true })
    const input = await screen.findByLabelText('Search projects, services, servers, and pages')

    fireEvent.change(input, { target: { value: 'billing-api' } })
    await waitFor(() => {
      expect(screen.getByText('billing-api')).toBeInTheDocument()
      expect(screen.queryByText('Deployments')).not.toBeInTheDocument()
    })

    fireEvent.keyDown(input, { key: 'Escape' })
    await waitFor(() => {
      expect(screen.queryByRole('dialog', { name: 'Command palette' })).not.toBeInTheDocument()
    })
  })
})
