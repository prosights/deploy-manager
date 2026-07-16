import { cleanup, fireEvent, render, screen, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { addServerDevUser, checkServer, createServer, deleteServerDevUser } from '../lib/api'
import { useUiStore } from '../store/ui'
import { ServersRoute } from './servers'

vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 120
    rows = 32
    clear = vi.fn()
    dispose = vi.fn()
    focus = vi.fn()
    loadAddon = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    open = vi.fn()
    write = vi.fn()
    writeln = vi.fn()
  },
}))

vi.mock('@xterm/addon-fit', () => ({
  FitAddon: class {
    fit = vi.fn()
  },
}))

vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

vi.mock('../lib/api', () => ({
  checkServer: vi.fn(async () => ({
    server: { id: 'server_1' },
    ssh_ok: true,
    docker_ok: false,
    docker_error: 'docker unavailable',
  })),
  createServer: vi.fn(async (input) => input),
  listServerDevUsers: vi.fn(async () => ({
    users: ['narasaka', 'rootsec1'],
    path: '/srv/deploy-manager/ops/dev-sudo-users.txt',
    script_path: '/srv/deploy-manager/ops/provision-dev-sudo-users.sh',
  })),
  addServerDevUser: vi.fn(async (_serverID, username) => ({
    users: ['narasaka', 'rootsec1', username],
    path: '/srv/deploy-manager/ops/dev-sudo-users.txt',
    script_path: '/srv/deploy-manager/ops/provision-dev-sudo-users.sh',
  })),
  updateServerDevUser: vi.fn(async (_serverID, _currentUsername, username) => ({
    users: ['narasaka', username],
    path: '/srv/deploy-manager/ops/dev-sudo-users.txt',
    script_path: '/srv/deploy-manager/ops/provision-dev-sudo-users.sh',
  })),
  deleteServerDevUser: vi.fn(async (_serverID, username) => ({
    users: ['narasaka', 'rootsec1'].filter((user) => user !== username),
    path: '/srv/deploy-manager/ops/dev-sudo-users.txt',
    script_path: '/srv/deploy-manager/ops/provision-dev-sudo-users.sh',
  })),
  applyServerDevUsers: vi.fn(async () => ({
    users: ['narasaka', 'rootsec1'],
    path: '/srv/deploy-manager/ops/dev-sudo-users.txt',
    script_path: '/srv/deploy-manager/ops/provision-dev-sudo-users.sh',
  })),
  webSocketURL: vi.fn(() => 'ws://127.0.0.1:5173/api/servers/server_1/terminal'),
}))

vi.mock('../lib/queries', () => ({
  applicationsQuery: {
    queryKey: ['applications'],
    queryFn: async () => [
      {
        id: 'app_1',
        environment_id: 'env_1',
        server_id: 'server_1',
        name: 'workflows-server-blue-green',
        repository_url: null,
        branch: 'main',
        compose_path: 'docker-compose.yml',
        remote_directory: '/srv/deploy-manager/apps/production/workflows-server-blue-green',
        domain: null,
        health_check_url: null,
        doppler_project: null,
        doppler_config: null,
        status: 'active',
        current_version: null,
        target_version: null,
        server_name: 'prod-1',
        environment_name: 'Production',
        environment_slug: 'production',
        environment_kind: 'production',
        environment_is_ephemeral: false,
        project_id: 'project_1',
        project_name: 'Production',
        project_slug: 'production',
        default_registry_id: null,
        default_registry_name: null,
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
        ssh_key_path: null,
        connection_mode: 'tailscale_ssh',
        proxy_type: 'caddy',
        status: 'healthy',
        cpu_usage: 12,
        memory_usage: 45,
        disk_usage: 61,
        last_checked_at: '2026-06-23T12:00:00Z',
      },
    ],
  },
  tailscaleDevicesQuery: {
    queryKey: ['tailscale-devices'],
    queryFn: async () => ({
      available: true,
      devices: [
        {
          name: 'internal',
          host: '100.107.110.108',
          dns_name: 'internal.tailnet.ts.net',
          os: 'linux',
          online: true,
          tags: ['tag:server'],
        },
      ],
    }),
  },
}))

describe('ServersRoute', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    useUiStore.setState({ searchQuery: '' })
    class MockWebSocket extends EventTarget {
      static OPEN = 1
      readyState = MockWebSocket.OPEN
      constructor(readonly url: string) {
        super()
      }
      close = vi.fn()
      send = vi.fn()
    }
    vi.stubGlobal('WebSocket', MockWebSocket)
  })

  afterEach(() => {
    cleanup()
    vi.unstubAllGlobals()
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
          connection_mode: 'direct_ssh',
          proxy_type: 'caddy',
        }),
      )
    })
    expect(screen.getByText('CPU 12% / RAM 45% / Disk 61%')).toBeInTheDocument()
    expect(screen.getByText(/6\/23\/2026|23\/6\/2026|2026/)).toBeInTheDocument()
    expect(screen.getByText('root@10.0.0.10:22')).toBeInTheDocument()
    expect(screen.getAllByText('Tailscale SSH').length).toBeGreaterThan(0)
    expect(screen.getByText('keyless via tailnet policy')).toBeInTheDocument()
  })

  it('imports Tailscale machines into the server form', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.click(await screen.findByRole('combobox', { name: 'Tailscale machine' }))
    fireEvent.click(await screen.findByRole('option', { name: 'internal · 100.107.110.108' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createServer).toHaveBeenCalledWith(expect.objectContaining({
        name: 'internal',
        hostname: '100.107.110.108',
        connection_mode: 'tailscale_ssh',
        ssh_key_path: '',
      }))
    })
  })

  it('registers Tailscale SSH targets without an SSH key path', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    fireEvent.change(await screen.findByLabelText('Name'), { target: { value: 'vpc-production' } })
    fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '100.79.100.28' } })
    fireEvent.click(screen.getByRole('combobox', { name: 'Connection' }))
    fireEvent.click(await screen.findByRole('option', { name: 'Tailscale SSH' }))
    fireEvent.click(screen.getByRole('button', { name: /save/i }))

    await waitFor(() => {
      expect(createServer).toHaveBeenCalledWith(expect.objectContaining({
        name: 'vpc-production',
        hostname: '100.79.100.28',
        ssh_key_path: '',
        connection_mode: 'tailscale_ssh',
      }))
    })
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
        connection_mode: 'direct_ssh',
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

  it('manages dev sudo users from the shared server file', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    expect(await screen.findByText('narasaka')).toBeInTheDocument()
    expect(screen.getByText(/\/srv\/deploy-manager\/ops\/dev-sudo-users\.txt/)).toBeInTheDocument()

    fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'alihussaini' } })
    fireEvent.click(screen.getByRole('button', { name: /add user/i }))

    await waitFor(() => {
      expect(addServerDevUser).toHaveBeenCalledWith('server_1', 'alihussaini')
    })

    fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])

    await waitFor(() => {
      expect(deleteServerDevUser).toHaveBeenCalledWith('server_1', 'narasaka')
    })
  })

  it('opens a literal terminal console from the server row', async () => {
    const client = new QueryClient()

    render(
      <QueryClientProvider client={client}>
        <ServersRoute />
      </QueryClientProvider>,
    )

    const consoleButton = await screen.findByRole('button', { name: /console/i })
    expect(screen.queryByRole('heading', { name: 'Terminal console' })).not.toBeInTheDocument()

    fireEvent.click(consoleButton)

    expect(await screen.findByRole('heading', { name: 'Terminal console' })).toBeInTheDocument()
    expect(screen.getByText('ssh console')).toBeInTheDocument()
    expect(screen.getByText('/srv/deploy-manager/apps/production/workflows-server-blue-green')).toBeInTheDocument()
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
