import { cleanup, fireEvent, screen, waitFor, within } from '@testing-library/react'
import { afterEach, beforeEach, expect, it, vi } from 'vitest'
import { HttpError, renderApp, type StubRequest } from '../test/render'
import { server } from '../test/fixtures'

// xterm needs a real browser canvas.
vi.mock('@xterm/xterm', () => ({
  Terminal: class {
    cols = 120
    rows = 32
    dispose = vi.fn()
    focus = vi.fn()
    loadAddon = vi.fn()
    onData = vi.fn(() => ({ dispose: vi.fn() }))
    open = vi.fn()
    write = vi.fn()
    writeln = vi.fn()
  },
}))
vi.mock('@xterm/addon-fit', () => ({ FitAddon: class { fit = vi.fn() } }))
vi.mock('@xterm/xterm/css/xterm.css', () => ({}))

const sockets: string[] = []

beforeEach(() => {
  sockets.length = 0
  vi.stubGlobal('WebSocket', class extends EventTarget {
    static OPEN = 1
    readyState = 1
    constructor(readonly url: string) {
      super()
      sockets.push(url)
    }
    close = vi.fn()
    send = vi.fn()
  })
})

afterEach(() => {
  cleanup()
  vi.unstubAllGlobals()
})

const tailscaleServer = server({
  ssh_user: 'root',
  connection_mode: 'tailscale_ssh',
  cpu_usage: 12,
  memory_usage: 45,
  disk_usage: 61,
  last_checked_at: '2026-06-23T12:00:00Z',
})

const devUsersPath = '/srv/deploy-manager/ops/dev-sudo-users.txt'

function devUsers(users: string[]) {
  return { users, path: devUsersPath, script_path: '/srv/deploy-manager/ops/provision-dev-sudo-users.sh' }
}

function renderServers(handlers: Record<string, unknown> = {}) {
  return renderApp('/servers', {
    'GET /api/servers': [tailscaleServer],
    'GET /api/tailscale/devices': {
      available: true,
      devices: [{ name: 'internal', host: '100.107.110.108', dns_name: 'internal.tailnet.ts.net', os: 'linux', online: true, tags: ['tag:server'] }],
    },
    'POST /api/servers/server_1/check': { server: tailscaleServer, ssh_ok: true, docker_ok: false, docker_error: 'docker unavailable' },
    'POST /api/servers/server_1/commands': { output: 'Jul 21 12:00:00 server dockerd[1]: ready' },
    'POST /api/servers': ({ body }: StubRequest) => server({ id: 'server_2', ...(body as object) }),
    'GET /api/servers/server_1/dev-users': devUsers(['narasaka', 'rootsec1']),
    ...handlers,
  })
}

function sent(requests: StubRequest[], method: string, path: string) {
  return requests.filter((request) => request.method === method && request.path === path)
}

async function openRegisterForm() {
  fireEvent.click(await screen.findByRole('button', { name: 'Register server' }, { timeout: 3000 }))
  return screen.findByRole('dialog', { name: 'Register server' })
}

function fillServerForm(values: Record<string, string>) {
  for (const [label, value] of Object.entries(values)) {
    fireEvent.change(screen.getByLabelText(label), { target: { value } })
  }
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))
}

it('lists servers with their connection and usage', async () => {
  renderServers()
  expect(await screen.findByText('root@10.0.0.10:22', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(screen.getByText('CPU 12% / RAM 45% / Disk 61%')).toBeInTheDocument()
  expect(screen.getByText('keyless via tailnet policy')).toBeInTheDocument()
  expect(screen.getByText('Tailscale SSH')).toBeInTheDocument()
})

it('filters server rows from the search field', async () => {
  renderServers()
  fireEvent.change(await screen.findByRole('searchbox', { name: 'Search servers' }, { timeout: 3000 }), { target: { value: 'worker' } })
  expect(await screen.findByText('No servers found.')).toBeInTheDocument()
  expect(screen.queryByText('prod-1')).not.toBeInTheDocument()
})

it('checks each connectable server and shows SSH and Docker status', async () => {
  const { requests } = renderServers()
  expect(await screen.findByText('SSH ok', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(screen.getByText('Docker failed')).toBeInTheDocument()
  expect(screen.getByText('docker unavailable')).toBeInTheDocument()
  expect(sent(requests, 'POST', '/api/servers/server_1/check')).toHaveLength(1)
})

it('skips the check for servers without an SSH key and shows check failures in the row', async () => {
  const { requests } = renderServers({
    'GET /api/servers': [server(), server({ id: 'server_2', name: 'prod-2', ssh_key_path: '~/.ssh/id' })],
    'POST /api/servers/server_2/check': () => { throw new HttpError(502, 'ssh: handshake failed') },
  })
  expect(await screen.findByText('ssh: handshake failed', {}, { timeout: 3000 })).toBeInTheDocument()
  expect(sent(requests, 'POST', '/api/servers/server_1/check')).toHaveLength(0)
})

it('registers a direct SSH server with a normalized body', async () => {
  const { requests } = renderServers()
  const dialog = await openRegisterForm()
  fillServerForm({ 'Name': ' prod-2 ', 'Hostname': ' 10.0.0.20 ', 'SSH user': ' ', 'SSH port': '2222', 'SSH key path': ' ~/.ssh/prod_ed25519 ' })

  await waitFor(() => expect(sent(requests, 'POST', '/api/servers')).toHaveLength(1))
  expect(sent(requests, 'POST', '/api/servers')[0].body).toEqual({
    name: 'prod-2',
    hostname: '10.0.0.20',
    ssh_user: 'root',
    ssh_port: 2222,
    ssh_key_path: '~/.ssh/prod_ed25519',
    connection_mode: 'direct_ssh',
    proxy_type: 'caddy',
  })
  await waitFor(() => expect(dialog).not.toBeInTheDocument())
})

it('imports a Tailscale machine into the form', async () => {
  const { requests } = renderServers()
  await openRegisterForm()
  fireEvent.click(await screen.findByRole('combobox', { name: 'Tailscale machine' }))
  fireEvent.click(await screen.findByRole('option', { name: 'internal · 100.107.110.108' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(sent(requests, 'POST', '/api/servers')).toHaveLength(1))
  expect(sent(requests, 'POST', '/api/servers')[0].body).toMatchObject({
    name: 'internal',
    hostname: '100.107.110.108',
    connection_mode: 'tailscale_ssh',
    ssh_key_path: '',
  })
})

it('registers a Tailscale SSH server without a key path', async () => {
  const { requests } = renderServers()
  await openRegisterForm()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'vpc-production' } })
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '100.79.100.28' } })
  fireEvent.click(screen.getByRole('combobox', { name: 'Connection' }))
  fireEvent.click(await screen.findByRole('option', { name: 'Tailscale SSH' }))
  fireEvent.click(screen.getByRole('button', { name: 'Save' }))

  await waitFor(() => expect(sent(requests, 'POST', '/api/servers')).toHaveLength(1))
  expect(sent(requests, 'POST', '/api/servers')[0].body).toMatchObject({ ssh_key_path: '', connection_mode: 'tailscale_ssh' })
})

it('disables save until a direct SSH server has a key path', async () => {
  renderServers()
  await openRegisterForm()
  fireEvent.change(screen.getByLabelText('Name'), { target: { value: 'prod-2' } })
  fireEvent.change(screen.getByLabelText('Hostname'), { target: { value: '10.0.0.20' } })
  expect(screen.getByRole('button', { name: 'Save' })).toBeDisabled()
})

it.each([
  [{ 'SSH port': '70000', 'SSH key path': '~/.ssh/prod_ed25519' }, 'SSH port must be between 1 and 65535.'],
  [{ 'SSH key path': '~/.ssh/prod_ed25519\tbad' }, 'SSH key path cannot contain control characters.'],
  [{ 'SSH key path': 'id_ed25519' }, 'SSH key path must be absolute or home-relative.'],
  [{ 'SSH key path': '~/.ssh/../id' }, 'SSH key path cannot contain parent directory segments.'],
])('shows validation errors without sending a request (%o)', async (values, message) => {
  const { requests } = renderServers()
  await openRegisterForm()
  fillServerForm({ 'Name': 'prod-2', 'Hostname': '10.0.0.20', ...values })
  expect(await screen.findByText(message)).toBeInTheDocument()
  expect(sent(requests, 'POST', '/api/servers')).toHaveLength(0)
})

it('opens a server on its logs tab', async () => {
  const { requests } = renderServers()
  fireEvent.click(await screen.findByRole('button', { name: 'prod-1' }, { timeout: 3000 }))
  expect(await screen.findByRole('dialog', { name: 'prod-1' })).toBeInTheDocument()
  expect(screen.getByRole('button', { name: 'Logs' })).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByText(/dockerd\[1\]: ready/)).toBeInTheDocument()
  expect(sent(requests, 'POST', '/api/servers/server_1/commands')[0].body).toEqual({ command: expect.stringContaining('journalctl --no-pager -n 300 -r') })
})

it('shows a failed log command in the logs tab', async () => {
  renderServers({ 'POST /api/servers/server_1/commands': { output: '', error: 'permission denied' } })
  fireEvent.click(await screen.findByRole('button', { name: 'prod-1' }, { timeout: 3000 }))
  expect(await screen.findByText('permission denied')).toBeInTheDocument()
})

it('adds, renames and removes privileged users', async () => {
  const { requests } = renderServers({
    'POST /api/servers/server_1/dev-users': devUsers(['narasaka', 'rootsec1', 'alihussaini']),
    'PATCH /api/servers/server_1/dev-users/rootsec1': devUsers(['narasaka', 'rootsec2']),
    'DELETE /api/servers/server_1/dev-users/narasaka': devUsers(['rootsec1']),
  })
  fireEvent.click(await screen.findByRole('button', { name: 'Configure' }, { timeout: 3000 }))
  const dialog = await screen.findByRole('dialog', { name: 'prod-1' })
  expect(within(dialog).getByRole('button', { name: 'Configure' })).toHaveAttribute('aria-current', 'page')
  expect(await screen.findByText('narasaka')).toBeInTheDocument()
  expect(screen.getByText(/passwordless sudo plus Docker and deployer group access/)).toBeInTheDocument()
  expect(screen.getByText(devUsersPath)).toBeInTheDocument()

  fireEvent.change(screen.getByRole('searchbox', { name: 'Search privileged users' }), { target: { value: 'rootsec1' } })
  expect(screen.queryByText('narasaka')).not.toBeInTheDocument()
  fireEvent.change(screen.getByRole('searchbox', { name: 'Search privileged users' }), { target: { value: '' } })

  fireEvent.click(screen.getByRole('button', { name: 'Add user' }))
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: ' alihussaini ' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save user' }))
  await waitFor(() => expect(screen.queryByLabelText('Username')).not.toBeInTheDocument())
  expect(sent(requests, 'POST', '/api/servers/server_1/dev-users')[0].body).toEqual({ username: 'alihussaini' })

  fireEvent.click(screen.getAllByRole('button', { name: /rename/i })[1])
  fireEvent.change(screen.getByLabelText('Edit rootsec1'), { target: { value: 'rootsec2' } })
  fireEvent.click(screen.getByRole('button', { name: /update/i }))
  await waitFor(() => expect(sent(requests, 'PATCH', '/api/servers/server_1/dev-users/rootsec1')).toHaveLength(1))
  expect(sent(requests, 'PATCH', '/api/servers/server_1/dev-users/rootsec1')[0].body).toEqual({ username: 'rootsec2' })
  await waitFor(() => expect(screen.queryByLabelText('Edit rootsec1')).not.toBeInTheDocument())

  fireEvent.click(screen.getAllByRole('button', { name: /remove/i })[0])
  await waitFor(() => expect(sent(requests, 'DELETE', '/api/servers/server_1/dev-users/narasaka')).toHaveLength(1))
})

it('shows dev user errors and keeps the add form open', async () => {
  renderServers({ 'POST /api/servers/server_1/dev-users': () => { throw new HttpError(400, 'invalid username') } })
  fireEvent.click(await screen.findByRole('button', { name: 'Configure' }, { timeout: 3000 }))
  fireEvent.click(await screen.findByRole('button', { name: 'Add user' }))
  fireEvent.change(screen.getByLabelText('Username'), { target: { value: 'Bad User' } })
  fireEvent.click(screen.getByRole('button', { name: 'Save user' }))
  expect(await screen.findByText('invalid username')).toBeInTheDocument()
  expect(screen.getByLabelText('Username')).toHaveValue('Bad User')
})

it('opens the console tab and connects the terminal', async () => {
  renderServers()
  fireEvent.click(await screen.findByRole('button', { name: 'Console' }, { timeout: 3000 }))
  const dialog = await screen.findByRole('dialog', { name: 'prod-1' })
  expect(within(dialog).getByRole('button', { name: 'Console' })).toHaveAttribute('aria-current', 'page')
  expect(screen.getByRole('heading', { name: 'Server console' })).toBeInTheDocument()
  expect(screen.getByText('ssh console')).toBeInTheDocument()
  expect(screen.getByText('connecting · 10.0.0.10:22')).toBeInTheDocument()
  expect(sockets).toEqual([expect.stringContaining('/api/servers/server_1/terminal')])
})
