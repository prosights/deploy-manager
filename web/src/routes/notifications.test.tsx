import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { upsertConnector } from '../lib/api'
import { NotificationsRoute } from './notifications'

vi.mock('../lib/api', () => ({
  upsertConnector: vi.fn(async (input) => ({ id: 'connector_new', ...input })),
}))

vi.mock('../lib/queries', () => ({
  connectorsQuery: {
    queryKey: ['connectors'],
    queryFn: async () => [
      {
        id: 'connector_slack',
        provider: 'slack',
        name: 'Deployments',
        enabled: true,
        config: { channels: ['#deployments'], applications: ['production'] },
        last_sync_status: null,
        last_sync_message: null,
        last_synced_at: null,
      },
      {
        id: 'connector_github',
        provider: 'github',
        name: 'GitHub',
        enabled: true,
        config: {},
        last_sync_status: null,
        last_sync_message: null,
        last_synced_at: null,
      },
    ],
  },
}))

describe('NotificationsRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
  })

  afterEach(() => {
    cleanup()
  })

  function renderRoute() {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <NotificationsRoute />
      </QueryClientProvider>,
    )
  }

  it('shows notification destinations without showing inventory connectors', async () => {
    renderRoute()

    expect(await screen.findByText('Deployments')).toBeInTheDocument()
    expect(screen.getByText('#deployments')).toBeInTheDocument()
    expect(screen.queryByText('GitHub')).not.toBeInTheDocument()
  })

  it('registers Slack destination metadata', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Destination name'), { target: { value: 'production deploys' } })
    fireEvent.change(screen.getByLabelText('Channel'), { target: { value: '#prod-deploys' } })
    fireEvent.change(screen.getByLabelText('App or project scope'), { target: { value: 'production' } })
    fireEvent.click(screen.getByRole('button', { name: /save destination/i }))

    await waitFor(() => {
      expect(upsertConnector).toHaveBeenCalledWith({
        provider: 'slack',
        name: 'production deploys',
        enabled: true,
        config: {
          channels: ['#prod-deploys'],
          applications: ['production'],
        },
      })
    })
  })

  it('registers Resend destination metadata', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: /Email via Resend/i }))
    fireEvent.change(screen.getByLabelText('Destination name'), { target: { value: 'production email' } })
    fireEvent.change(screen.getByLabelText('Domain'), { target: { value: 'prosights.co' } })
    fireEvent.change(screen.getByLabelText('Sender'), { target: { value: 'deploy@prosights.co' } })
    fireEvent.change(screen.getByLabelText('Recipients'), { target: { value: 'eng@prosights.co, oncall@prosights.co' } })
    fireEvent.click(screen.getByRole('button', { name: /save destination/i }))

    await waitFor(() => {
      expect(upsertConnector).toHaveBeenCalledWith({
        provider: 'resend',
        name: 'production email',
        enabled: true,
        config: {
          domains: ['prosights.co'],
          senders: ['deploy@prosights.co'],
          recipients: ['eng@prosights.co', 'oncall@prosights.co'],
          applications: [],
        },
      })
    })
  })
})
