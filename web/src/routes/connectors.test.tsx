import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { syncConnector, upsertConnector } from '../lib/api'
import { ConnectorsRoute } from './connectors'

vi.mock('../lib/api', () => ({
  syncConnector: vi.fn(async (connectorID: string) => ({ connector: { id: connectorID, last_sync_status: 'ok' }, count: 0 })),
  upsertConnector: vi.fn(async (input) => ({ id: 'connector_new', ...input, last_sync_status: null, last_sync_message: null, last_synced_at: null })),
}))

vi.mock('../lib/queries', () => ({
  connectorsQuery: {
    queryKey: ['connectors'],
    queryFn: async () => [
      {
        id: 'connector_1',
        provider: 's3',
        name: 'object storage inventory',
        enabled: true,
        last_sync_status: 'ok',
        last_sync_message: 'Imported 2 credential records',
        last_synced_at: '2026-06-23T12:00:00Z',
      },
    ],
  },
}))

describe('ConnectorsRoute', () => {
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
        <ConnectorsRoute />
      </QueryClientProvider>,
    )
  }

  it('shows connector sync health and last sync details', async () => {
    renderRoute()

    expect(await screen.findByText('object storage inventory')).toBeInTheDocument()
    expect(screen.getByText('Imported 2 credential records')).toBeInTheDocument()
    expect(screen.getByText('ok')).toBeInTheDocument()
    expect(screen.getByText(/Last sync/)).toBeInTheDocument()
    expect(screen.getByText(/Registered GitHub connectors can sync repository credential references/)).toBeInTheDocument()
    expect(screen.getByText(/Registered S3 and GCS connectors can sync bucket metadata/)).toBeInTheDocument()
    expect(screen.getByText(/Inventory metadata keys: project, config, applications/)).toBeInTheDocument()
  })

  it('registers connector metadata without storing secrets', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: /S3/i }))
    fireEvent.change(screen.getByLabelText('Connection name'), { target: { value: ' production buckets ' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), { target: { value: '{"region":"us-east-1"}' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    await waitFor(() => {
      expect(upsertConnector).toHaveBeenCalledWith({
        provider: 's3',
        name: 'production buckets',
        enabled: true,
        config: { region: 'us-east-1' },
      })
    })
  })

  it('rejects connector names with control characters before submit', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'prod\tbuckets' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    expect(await screen.findByText('Connector name cannot contain control characters.')).toBeInTheDocument()
    expect(upsertConnector).not.toHaveBeenCalledWith(expect.objectContaining({ name: expect.stringContaining('prod') }))
  })

  it('treats whitespace-only connector metadata as an empty object', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'metadata optional' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), { target: { value: '   ' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    await waitFor(() => {
      expect(upsertConnector).toHaveBeenCalledWith(expect.objectContaining({
        name: 'metadata optional',
        config: {},
      }))
    })
  })

  it('prunes blank connector metadata before submit', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'production buckets' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), {
      target: {
        value: JSON.stringify({
          region: ' us-east-1 ',
          empty: '',
          unused: null,
          buckets: [{ bucket: ' assets ', prefix: ' ' }, null, ' '],
        }),
      },
    })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    await waitFor(() => {
      expect(upsertConnector).toHaveBeenCalledWith(expect.objectContaining({
        config: {
          region: 'us-east-1',
          buckets: [{ bucket: 'assets' }],
        },
      }))
    })
  })

  it('syncs a registered connector through the connector endpoint', async () => {
    renderRoute()

    fireEvent.click(await screen.findByRole('button', { name: /sync/i }))

    await waitFor(() => {
      expect(syncConnector).toHaveBeenCalledWith('connector_1')
    })
    expect(upsertConnector).not.toHaveBeenCalled()
  })

  it('rejects connector metadata that is not a JSON object', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'broken' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), { target: { value: '["main"]' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    expect(await screen.findByText('Connector metadata must be a JSON object.')).toBeInTheDocument()
    expect(upsertConnector).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'broken' }))
  })

  it('rejects secret-like connector metadata before submit', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'leaky' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), { target: { value: '{"buckets":[{"accessKeyId":"secret"}]}' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    expect(await screen.findByText('Connector metadata cannot contain secrets, tokens, passwords, private keys, or API keys.')).toBeInTheDocument()
    expect(upsertConnector).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'leaky' }))
  })

  it('rejects blank secret-like connector metadata keys before submit', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'blank leaky key' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), { target: { value: '{"api_key":" "}' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    expect(await screen.findByText('Connector metadata cannot contain secrets, tokens, passwords, private keys, or API keys.')).toBeInTheDocument()
    expect(upsertConnector).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'blank leaky key' }))
  })

  it('rejects raw secret material in connector metadata values before submit', async () => {
    renderRoute()

    fireEvent.change(await screen.findByLabelText('Connection name'), { target: { value: 'leaky value' } })
    fireEvent.click(screen.getByText('Advanced metadata'))
    fireEvent.change(screen.getByLabelText('Metadata JSON'), { target: { value: '{"reference":"ghp_1234567890"}' } })
    fireEvent.click(screen.getByRole('button', { name: /save integration/i }))

    expect(await screen.findByText('Connector metadata cannot contain raw secret material.')).toBeInTheDocument()
    expect(upsertConnector).not.toHaveBeenCalledWith(expect.objectContaining({ name: 'leaky value' }))
  })
})
