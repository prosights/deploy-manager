import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { checkServer, createServer } from '../lib/api'
import { useUiStore } from '../store/ui'
import { ServersRoute } from './servers'

vi.mock('../lib/api', () => ({
  checkServer: vi.fn(async () => ({
    server: { id: 'server_1' },
    ssh_ok: true,
    docker_ok: false,
    docker_error: 'docker unavailable',
  })),
  createServer: vi.fn(async (input) => input),
}))

vi.mock('../lib/queries', () => ({
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
        last_checked_at: '2026-06-23T12:00:00Z',
      },
    ],
  },
}))

describe('ServersRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUiStore.setState({ searchQuery: '' })
  })

  afterEach(() => {
    cleanup()
  })

  it('registers SSH deployment targets with proxy defaults', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'prod-2' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '10.0.0.20' } })
    fireEvent.change(screen.getByLabelText('SSH port'), { target: { value: '2222' } })
    fireEvent.change(screen.getByLabelText('SSH key path'), { target: { value: '~/.ssh/prod_ed25519' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createServer).toHaveBeenCalledWith(
        expect.objectContaining({
          name: 'prod-2',
          hostname: '10.0.0.20',
          ssh_user: 'root',
          ssh_port: 2222,
          ssh_key_path: '~/.ssh/prod_ed25519',
          proxy_type: 'caddy',
        }),
      )
    })
    expect(screen.getByText('CPU 12% / RAM 45% / Disk 61%')).toBeInTheDocument()
    expect(screen.getByText(/6\/23\/2026|23\/6\/2026|2026/)).toBeInTheDocument()
    expect(screen.getByText('root@10.0.0.10:22')).toBeInTheDocument()
    expect(screen.getByText('~/.ssh/id_ed25519')).toBeInTheDocument()
  })

  it('normalizes server payloads before registering a server', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: ' prod-2 ' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: ' 10.0.0.20 ' } })
    fireEvent.change(screen.getByLabelText('SSH user'), { target: { value: ' ' } })
    fireEvent.change(screen.getByLabelText('SSH port'), { target: { value: '2222' } })
    fireEvent.change(screen.getByLabelText('SSH key path'), { target: { value: ' ~/.ssh/prod_ed25519 ' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createServer).toHaveBeenCalledWith({
        name: 'prod-2',
        hostname: '10.0.0.20',
        ssh_user: 'root',
        ssh_port: 2222,
        ssh_key_path: '~/.ssh/prod_ed25519',
        proxy_type: 'caddy',
      })
    })
  })

  it('shows SSH and Docker check results separately', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('button', { name: /check/i }))

    await waitFor(() => {
      expect(checkServer).toHaveBeenCalledWith('server_1')
    })
    expect(await screen.findByText('SSH ok')).toBeInTheDocument()
    expect(screen.getByText('Docker failed')).toBeInTheDocument()
    expect(screen.getByText('docker unavailable')).toBeInTheDocument()
  })

  it('filters server rows from the global search query', async () => {
    useUiStore.setState({ searchQuery: 'worker' })
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('No servers found.')).toBeInTheDocument()
    expect(screen.queryByText('prod-1')).not.toBeInTheDocument()
  })

  it('rejects invalid SSH ports before registering a server', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'prod-2' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '10.0.0.20' } })
    fireEvent.change(screen.getByLabelText('SSH port'), { target: { value: '70000' } })
    fireEvent.change(screen.getByLabelText('SSH key path'), { target: { value: '~/.ssh/prod_ed25519' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('SSH port must be between 1 and 65535.')).toBeInTheDocument()
    expect(createServer).not.toHaveBeenCalledWith(expect.objectContaining({ hostname: '10.0.0.20' }))
  })

  it('requires an SSH key path before registering a deployment target', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'prod-2' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '10.0.0.20' } })

    expect(screen.getByRole('button', { name: /save/i })).toBeDisabled()
    expect(createServer).not.toHaveBeenCalled()
  })

  it('rejects control characters before registering a server', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'prod-2' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '10.0.0.20' } })
    fireEvent.change(screen.getByLabelText('SSH key path'), { target: { value: '~/.ssh/prod_ed25519\tbad' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('SSH key path cannot contain control characters.')).toBeInTheDocument()
    expect(createServer).not.toHaveBeenCalled()
  })

  it('rejects ambiguous SSH key paths before registering a server', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'prod-2' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '10.0.0.20' } })
    fireEvent.change(screen.getByLabelText('SSH key path'), { target: { value: 'id_ed25519' } })
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    expect(await screen.findByText('SSH key path must be absolute or home-relative.')).toBeInTheDocument()
    expect(createServer).not.toHaveBeenCalledWith(expect.objectContaining({ ssh_key_path: 'id_ed25519' }))
  })
})
