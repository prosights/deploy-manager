import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { cancelDeployment, createDeployment, retryDeployment, rollbackApplication } from '../lib/api'
import { useDeploymentSelection } from '../store/deployments'
import { useUiStore } from '../store/ui'
import { DeploymentsRoute } from './deployments'

const queryData = vi.hoisted(() => ({
  applications: [
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
      health_check_url: null as string | null,
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
      github_auto_deploy: false,
    },
  ],
  deploymentSlots: [
    {
      id: 'slot_blue',
      application_id: 'app_1',
      server_id: 'server_1',
      color: 'blue',
      deployment_id: 'deployment_1',
      image_ref: 'registry.example.com/api:v1',
      image_digest: null,
      status: 'active',
      promoted_at: '2026-06-23T00:00:00Z',
      created_at: '2026-06-23T00:00:00Z',
      updated_at: '2026-06-23T00:00:00Z',
    },
    {
      id: 'slot_green',
      application_id: 'app_1',
      server_id: 'server_1',
      color: 'green',
      deployment_id: 'deployment_2',
      image_ref: 'registry.example.com/api:v0',
      image_digest: null,
      status: 'standby',
      promoted_at: '2026-06-22T00:00:00Z',
      created_at: '2026-06-22T00:00:00Z',
      updated_at: '2026-06-22T00:00:00Z',
    },
  ],
  registries: [],
}))

class MockEventSource {
  static instances: MockEventSource[] = []

  private listeners = new Map<string, Array<(event: MessageEvent) => void>>()
  close = vi.fn()

  constructor(readonly url: string) {
    MockEventSource.instances.push(this)
  }

  addEventListener(type: string, listener: (event: MessageEvent) => void) {
    this.listeners.set(type, [...(this.listeners.get(type) ?? []), listener])
  }

  emit(type: string, event = new MessageEvent(type)) {
    for (const listener of this.listeners.get(type) ?? []) {
      listener(event)
    }
  }
}

vi.mock('../lib/api', async () => {
  const actual = await vi.importActual<typeof import('../lib/api')>('../lib/api')
  return {
    ...actual,
    cancelDeployment: vi.fn(async (deploymentID: string) => ({ id: deploymentID, status: 'cancelled' })),
    createDeployment: vi.fn(),
    retryDeployment: vi.fn(async (deploymentID: string) => ({ id: deploymentID, status: 'queued' })),
    rollbackApplication: vi.fn(async (applicationID: string) => ({ id: 'rollback_1', application_id: applicationID, status: 'queued' })),
    updateApplication: vi.fn(async (_applicationID: string, input: object) => ({ ...queryData.applications[0], ...input })),
  }
})

vi.mock('../lib/queries', () => ({
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => queryData.applications,
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
        status: 'queued',
        commit_sha: null,
        actor: 'local-user',
        application_name: 'api',
        server_name: 'prod-1',
      environment_name: 'Production',
      environment_slug: 'production',
      environment_kind: 'production',
      environment_is_ephemeral: false,
      project_id: 'project_1',
      project_name: 'Billing',
      project_slug: 'billing',
        created_at: '2026-06-23T00:00:00Z',
        started_at: null,
        finished_at: null,
      },
      {
        id: 'deployment_2',
        application_id: 'app_1',
        server_id: 'server_1',
        trigger: 'manual',
        strategy: 'blue_green',
        status: 'failed',
        commit_sha: 'abc1234',
        actor: 'local-user',
        application_name: 'api',
        server_name: 'prod-1',
      environment_name: 'Production',
      environment_slug: 'production',
      environment_kind: 'production',
      environment_is_ephemeral: false,
      project_id: 'project_1',
      project_name: 'Billing',
      project_slug: 'billing',
        created_at: '2026-06-23T00:00:00Z',
        started_at: '2026-06-23T00:00:01Z',
        finished_at: '2026-06-23T00:00:02Z',
      },
    ],
  },
  containerRegistriesQuery: {
    queryKey: ['container-registries'],
    queryFn: async () => queryData.registries,
  },
  deploymentSlotsQuery: () => ({
    queryKey: ['applications', 'app_1', 'deployment-slots'],
    queryFn: async () => queryData.deploymentSlots,
  }),
  deploymentLogsQuery: () => ({
    queryKey: ['deployments', 'deployment_1', 'logs'],
    queryFn: async () => [],
  }),
}))

describe('DeploymentsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    MockEventSource.instances = []
    queryData.applications[0].health_check_url = 'http://127.0.0.1:{port}/healthz?color={color}'
    useDeploymentSelection.setState({ selectedDeploymentID: '' })
    useUiStore.setState({ searchQuery: '', sidebarCollapsed: false })
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    cleanup()
  })

  it('queues deployments by application target only', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Manual image ref'), { target: { value: 'ghcr.io/acme/api:1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: /queue deploy/i }))

    await waitFor(() => {
      expect(createDeployment).toHaveBeenCalledWith(
        expect.not.objectContaining({
          server_id: expect.any(String),
        }),
      )
      expect(createDeployment).toHaveBeenCalledWith(
        expect.objectContaining({
          application_id: 'app_1',
          strategy: 'blue_green',
        }),
      )
    })
  })

  it('omits blank optional deployment fields before queueing', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Commit SHA'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Actor'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('Manual image ref'), { target: { value: 'ghcr.io/acme/api:1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: /queue deploy/i }))

    await waitFor(() => {
      expect(createDeployment).toHaveBeenCalledWith({
        application_id: 'app_1',
        trigger: 'manual',
        strategy: 'blue_green',
        commit_sha: undefined,
        image_ref: 'ghcr.io/acme/api:1.0.0',
        image_digest: undefined,
        actor: undefined,
      })
    })
  })

  it('queues manual deployments with an optional pinned commit', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Commit SHA'), { target: { value: 'abc1234' } })
    fireEvent.change(screen.getByLabelText('Manual image ref'), { target: { value: 'ghcr.io/acme/api:1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: /queue deploy/i }))

    await waitFor(() => {
      expect(createDeployment).toHaveBeenCalledWith(
        expect.objectContaining({
          application_id: 'app_1',
          commit_sha: 'abc1234',
        }),
      )
    })
  })

  it('rejects invalid pinned commits before queueing deployments', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Commit SHA'), { target: { value: 'not-a-sha' } })
    fireEvent.click(screen.getByRole('button', { name: /queue deploy/i }))

    expect(await screen.findByText('Commit SHA must be 7 to 40 hexadecimal characters.')).toBeInTheDocument()
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('queues manual deployments with the entered actor', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Actor'), { target: { value: ' ali ' } })
    fireEvent.change(screen.getByLabelText('Manual image ref'), { target: { value: 'ghcr.io/acme/api:1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: /queue deploy/i }))

    await waitFor(() => {
      expect(createDeployment).toHaveBeenCalledWith(
        expect.objectContaining({
          actor: 'ali',
        }),
      )
    })
  })

  it('rejects actor control characters before queueing deployments', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Actor'), { target: { value: 'ali\troot' } })
    fireEvent.change(screen.getByLabelText('Manual image ref'), { target: { value: 'ghcr.io/acme/api:1.0.0' } })
    fireEvent.click(screen.getByRole('button', { name: /queue deploy/i }))

    expect(await screen.findByText('Actor cannot contain control characters.')).toBeInTheDocument()
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('requires a color-aware health check before queueing blue-green deployments', async () => {
    queryData.applications[0].health_check_url = null
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    await screen.findByRole('button', { name: /queue deploy/i })

    expect(screen.getByRole('button', { name: /queue deploy/i })).toBeDisabled()
    expect(screen.getByText(/Configure a health check URL with/)).toBeInTheDocument()
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('rejects unsafe blue-green health check URLs before queueing deployments', async () => {
    queryData.applications[0].health_check_url = 'https://user:pass@example.com/{color}/health'
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    await screen.findByRole('button', { name: /queue deploy/i })

    expect(screen.getByRole('button', { name: /queue deploy/i })).toBeDisabled()
    expect(screen.getByText('Health check URL cannot include credentials.')).toBeInTheDocument()
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('cancels queued deployments only through the cancel endpoint', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /cancel/i }))

    await waitFor(() => {
      expect(cancelDeployment).toHaveBeenCalledWith('deployment_1')
    })
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('retries failed deployments through the retry endpoint', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /retry/i }))

    await waitFor(() => {
      expect(retryDeployment).toHaveBeenCalledWith('deployment_2')
    })
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('rolls back blue-green targets without changing the strategy dropdown first', async () => {
    queryData.applications[0].health_check_url = 'http://127.0.0.1:{port}/healthz?color={color}'
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /rollback to green/i }))

    await waitFor(() => {
      expect(rollbackApplication).toHaveBeenCalledWith('app_1')
    })
    expect(createDeployment).not.toHaveBeenCalled()
  })

  it('realigns the selected deployment when search filters it out', async () => {
    useDeploymentSelection.setState({ selectedDeploymentID: 'deployment_2' })
    useUiStore.setState({ searchQuery: 'queued' })
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    await waitFor(() => {
      expect(useDeploymentSelection.getState().selectedDeploymentID).toBe('')
    })
  })

  it('keeps the deployment log stream open across transient SSE errors', async () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findAllByRole('button', { name: /inspect/i }).then((buttons) => buttons[0]))
    await screen.findByText('live stream')
    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    expect(MockEventSource.instances[0].url).toBe('/api/deployments/deployment_1/events')
    MockEventSource.instances[0].emit('error')
    expect(MockEventSource.instances[0].close).not.toHaveBeenCalled()
  })

  it('deduplicates repeated live log events by id', async () => {
    vi.stubGlobal('EventSource', MockEventSource)
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <DeploymentsRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findAllByRole('button', { name: /inspect/i }).then((buttons) => buttons[0]))
    await waitFor(() => {
      expect(MockEventSource.instances).toHaveLength(1)
    })

    const event = new MessageEvent('log', {
      data: JSON.stringify({
        id: 42,
        deployment_id: 'deployment_1',
        stream: 'system',
        message: 'Pulling compose images',
        created_at: '2026-06-23T00:00:00Z',
      }),
    })
    MockEventSource.instances[0].emit('log', event)
    MockEventSource.instances[0].emit('log', event)

    await waitFor(() => {
      expect(screen.getAllByText('Pulling compose images')).toHaveLength(1)
    })
  })
})
