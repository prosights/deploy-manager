import { useEffect, useRef, useState } from 'react'
import { useMutation, useQuery } from '@tanstack/react-query'
import { Terminal as XTerm, type ITerminalOptions } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Check, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Terminal as TerminalIcon, Trash2, X } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import { addServerDevUser, createServer, deleteServerDevUser, updateServerDevUser, webSocketURL, type Application, type CreateServerInput, type Server, type ServerCheckResponse } from '../../lib/api'
import { serverCheckQuery, serverCommandQuery, serverDevUsersQuery, tailscaleDevicesQuery } from '../../lib/queries'
import { matchesSearch } from '../../lib/search'
import { percent, statusTone } from '../status'
import { formatTimestamp } from '../../lib/format'

export type ServerTab = 'logs' | 'configure' | 'console'

type ServerFormState = {
  name: string
  hostname: string
  ssh_user: string
  ssh_port: string
  ssh_key_path: string
  connection_mode: Server['connection_mode']
  proxy_type: 'caddy' | 'traefik' | 'none'
}

const defaultServerForm: ServerFormState = {
  name: '',
  hostname: '',
  ssh_user: 'root',
  ssh_port: '22',
  ssh_key_path: '',
  connection_mode: 'direct_ssh',
  proxy_type: 'caddy',
}

export function ServerCreatePanel({ onCreated }: { onCreated: () => void }) {
  const { data: tailscaleDevices } = useQuery(tailscaleDevicesQuery)
  const [form, setForm] = useState(defaultServerForm)
  const create = useMutation({
    mutationFn: () => createServer(serverInput(form)),
    onSuccess: () => {
      setForm(defaultServerForm)
      onCreated()
    },
  })
  const selectedDeviceKey = tailscaleDevices?.devices.find((device) => device.host === form.hostname)?.host ?? ''
  const requiresSSHKey = form.connection_mode === 'direct_ssh'

  function update(updates: Partial<ServerFormState>) {
    setForm((state) => ({ ...state, ...updates }))
  }

  function importTailscaleDevice(host: string) {
    const device = tailscaleDevices?.devices.find((item) => item.host === host)
    if (!device) {
      return
    }
    update({
      name: device.name,
      hostname: device.host,
      connection_mode: 'tailscale_ssh',
      ssh_key_path: '',
    })
  }

  function setConnectionMode(connectionMode: ServerFormState['connection_mode']) {
    update({
      connection_mode: connectionMode,
      ...(connectionMode === 'tailscale_ssh' ? { ssh_key_path: '' } : {}),
    })
  }

  return (
    <Panel className="rounded-none border-0">
      {tailscaleDevices && (
        <div className="border-b p-4">
          <SelectInput label="Tailscale machine" value={selectedDeviceKey} onChange={importTailscaleDevice} disabled={!tailscaleDevices.available || tailscaleDevices.devices.length === 0}>
            <option value="">{tailscaleDevices.available ? 'Select machine' : 'Tailscale unavailable'}</option>
            {tailscaleDevices.devices.map((device) => (
              <option key={device.host} value={device.host}>
                {device.name} · {device.host}{device.online ? '' : ' · offline'}
              </option>
            ))}
          </SelectInput>
          <div className="mt-2 text-xs text-prosights-muted">
            {tailscaleDevices.available
              ? 'Import fills the server name and tailnet IP. Tailscale SSH uses tailnet policy instead of an SSH key path.'
              : tailscaleDevices.error ?? 'Tailscale is not available on this host.'}
          </div>
        </div>
      )}
      <form
        className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_110px_110px_1fr_150px_120px_auto]"
        noValidate
        onSubmit={(event) => {
          event.preventDefault()
          create.mutate()
        }}
      >
        <TextInput label="Name" value={form.name} onChange={(name) => update({ name })} required />
        <TextInput label="Hostname" value={form.hostname} onChange={(hostname) => update({ hostname })} required />
        <TextInput label="SSH user" value={form.ssh_user} onChange={(ssh_user) => update({ ssh_user })} required />
        <label className="space-y-1 text-xs text-prosights-muted">
          <span>SSH port</span>
          <input
            className="h-9 w-full rounded-md border bg-prosights-canvas px-3 text-sm text-prosights-text outline-none placeholder:text-prosights-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
            min={1}
            max={65535}
            type="number"
            value={form.ssh_port}
            onChange={(event) => update({ ssh_port: event.target.value })}
            required
          />
        </label>
        <TextInput label="SSH key path" value={form.ssh_key_path} onChange={(ssh_key_path) => update({ ssh_key_path })} placeholder={requiresSSHKey ? '~/.ssh/id_ed25519' : 'not used for Tailscale SSH'} disabled={!requiresSSHKey} required={requiresSSHKey} />
        <SelectInput label="Connection" value={form.connection_mode} onChange={(connection_mode) => setConnectionMode(connection_mode as ServerFormState['connection_mode'])}>
          <option value="direct_ssh">Direct SSH</option>
          <option value="tailscale_ssh">Tailscale SSH</option>
        </SelectInput>
        <SelectInput label="Proxy" value={form.proxy_type} onChange={(proxy_type) => update({ proxy_type: proxy_type as ServerFormState['proxy_type'] })}>
          <option value="caddy">Caddy</option>
          <option value="traefik">Traefik</option>
          <option value="none">None</option>
        </SelectInput>
        <div className="flex items-end">
          <Button variant="primary" disabled={create.isPending || !form.name || !form.hostname || (requiresSSHKey && !form.ssh_key_path)}>
            {create.isPending ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
      {create.error && <PanelError message={create.error.message} />}
    </Panel>
  )
}

// Validates the form and builds the request; throws with a user-facing message.
function serverInput(form: ServerFormState): CreateServerInput {
  const ssh_port = parseSSHPort(form.ssh_port)
  validateServerIdentity(form)
  return {
    name: form.name.trim(),
    hostname: form.hostname.trim(),
    ssh_user: form.ssh_user.trim() || 'root',
    ssh_port,
    ssh_key_path: form.connection_mode === 'tailscale_ssh' ? '' : form.ssh_key_path.trim(),
    connection_mode: form.connection_mode,
    proxy_type: form.proxy_type,
  }
}

function parseSSHPort(value: string): number {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SSH port must be between 1 and 65535.')
  }
  return port
}

function validateServerIdentity(form: ServerFormState): void {
  for (const [label, value] of [
    ['Name', form.name],
    ['Hostname', form.hostname],
    ['SSH user', form.ssh_user],
    ['SSH key path', form.ssh_key_path],
    ['Connection mode', form.connection_mode],
  ] as const) {
    if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
      throw new Error(`${label} cannot contain control characters.`)
    }
  }
  if (form.connection_mode === 'tailscale_ssh') {
    return
  }
  validateSSHKeyPath(form.ssh_key_path)
}

function validateSSHKeyPath(value: string): void {
  const sshKeyPath = value.trim()
  if (!sshKeyPath.startsWith('/') && !sshKeyPath.startsWith('~/')) {
    throw new Error('SSH key path must be absolute or home-relative.')
  }
  if (sshKeyPath.includes('//')) {
    throw new Error('SSH key path cannot contain empty path segments.')
  }
  if (sshKeyPath.split('/').includes('..')) {
    throw new Error('SSH key path cannot contain parent directory segments.')
  }
}

export function ServerList({ servers, onOpen }: { servers: Server[], onOpen: (serverID: string, tab: ServerTab) => void }) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-prosights-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Host</th>
              <th className="px-4 py-3 font-medium">Connection</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Resource usage</th>
              <th className="px-4 py-3 font-medium">Last checked</th>
              <th className="px-4 py-3 font-medium">Proxy</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => <ServerRow key={server.id} server={server} onOpen={(tab) => onOpen(server.id, tab)} />)}
          </tbody>
        </table>
      </div>
      {servers.length === 0 && <div className="border-t px-4 py-6 text-sm text-prosights-muted">No servers found.</div>}
    </Panel>
  )
}

function ServerRow({ server, onOpen }: { server: Server, onOpen: (tab: ServerTab) => void }) {
  const connectable = canConnectToServer(server)
  const check = useQuery({ ...serverCheckQuery(server.id), enabled: connectable })
  return (
    <tr className="cursor-pointer border-t transition-colors hover:bg-prosights-surface-muted/60" onClick={() => onOpen('logs')}>
      <td className="px-4 py-3 font-medium">
        <button type="button" className="bg-transparent text-left hover:underline" onClick={(event) => { event.stopPropagation(); onOpen('logs') }}>{server.name}</button>
      </td>
      <td className="px-4 py-3">
        <div className="font-mono text-xs text-prosights-text">{server.ssh_user}@{server.hostname}:{server.ssh_port}</div>
        <div className="mt-1 text-xs text-prosights-muted">{server.connection_mode === 'tailscale_ssh' ? 'keyless via tailnet policy' : server.ssh_key_path ?? 'ssh key not configured'}</div>
      </td>
      <td className="px-4 py-3 text-prosights-muted">{connectionModeLabel(server.connection_mode)}</td>
      <td className="px-4 py-3">
        <Badge tone={statusTone(server.status)}>{server.status}</Badge>
        {check.data && <ServerCheckSummary check={check.data} />}
        {check.error && <div className="mt-2 max-w-56 truncate text-xs text-danger">{check.error.message}</div>}
      </td>
      <td className="px-4 py-3 text-prosights-muted">CPU {percent(server.cpu_usage)} / RAM {percent(server.memory_usage)} / Disk {percent(server.disk_usage)}</td>
      <td className="px-4 py-3 text-prosights-muted">{formatTimestamp(server.last_checked_at, 'not checked')}</td>
      <td className="px-4 py-3 text-prosights-muted">{server.proxy_type}</td>
      <td className="px-4 py-3">
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" disabled={!connectable} onClick={(event) => { event.stopPropagation(); onOpen('console') }}>
            <TerminalIcon className="size-4" />
            Console
          </Button>
          <Button variant="ghost" onClick={(event) => { event.stopPropagation(); onOpen('configure') }}>
            <Settings2 className="size-4" />
            Configure
          </Button>
        </div>
      </td>
    </tr>
  )
}

function ServerCheckSummary({ check }: { check: ServerCheckResponse }) {
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        <Badge tone={check.ssh_ok ? 'success' : 'danger'}>SSH {check.ssh_ok ? 'ok' : 'failed'}</Badge>
        <Badge tone={check.docker_ok ? 'success' : 'danger'}>Docker {check.docker_ok ? 'ok' : 'failed'}</Badge>
      </div>
      {check.docker && <div className="text-xs text-success">Docker {check.docker.api_version}</div>}
      {check.error && <div className="max-w-56 truncate text-xs text-danger">{check.error}</div>}
      {check.docker_error && <div className="max-w-56 truncate text-xs text-danger">{check.docker_error}</div>}
    </div>
  )
}

function connectionModeLabel(connectionMode: Server['connection_mode']) {
  switch (connectionMode) {
    case 'tailscale_ssh':
      return 'Tailscale SSH'
    case 'cloud_tunnel':
      return 'Cloud tunnel'
    default:
      return 'Direct SSH'
  }
}

function canConnectToServer(server: Server) {
  return server.connection_mode === 'tailscale_ssh' || Boolean(server.ssh_key_path)
}

function requireUsername(value: string) {
  const username = value.trim()
  if (!username) throw new Error('Username is required.')
  return username
}

export function ServerDevUsersPanel({ server }: { server: Server }) {
  const devUsers = useQuery(serverDevUsersQuery(server.id))
  const [username, setUsername] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [addingUser, setAddingUser] = useState(false)
  const [editingUser, setEditingUser] = useState('')
  const [editingValue, setEditingValue] = useState('')
  const addUser = useMutation({
    mutationFn: () => addServerDevUser(server.id, requireUsername(username)),
    onSuccess: () => {
      setUsername('')
      setAddingUser(false)
    },
  })
  const renameUser = useMutation({
    mutationFn: () => updateServerDevUser(server.id, editingUser, requireUsername(editingValue)),
    onSuccess: () => setEditingUser(''),
  })
  const removeUser = useMutation({
    mutationFn: (user: string) => deleteServerDevUser(server.id, user),
  })
  const pending = addUser.isPending || renameUser.isPending || removeUser.isPending
  const errorMessage = devUsers.error?.message ?? addUser.error?.message ?? renameUser.error?.message ?? removeUser.error?.message
  const visibleUsers = (devUsers.data?.users ?? []).filter((user) => matchesSearch(searchQuery, [user]))

  function startEditing(user: string) {
    setEditingUser(user)
    setEditingValue(user)
  }

  return (
    <section className="space-y-4">
      <div className="flex gap-3">
        <div className="flex size-9 shrink-0 items-center justify-center rounded-prosights-md bg-prosights-surface-muted text-prosights-muted">
          <ShieldCheck className="size-4" aria-hidden="true" />
        </div>
        <div>
          <h2 className="text-[14px] font-semibold text-prosights-text">Privileged access</h2>
          <p className="mt-1 max-w-md text-[11px] leading-4 text-prosights-muted">Grants passwordless sudo plus Docker and deployer group access.</p>
        </div>
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-prosights-muted focus-within:ring-2 focus-within:ring-prosights-ring sm:max-w-sm">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search privileged users"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-prosights-text outline-none placeholder:text-prosights-subtle"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search users"
          />
        </label>
        <Button type="button" variant="primary" className="ml-auto" disabled={pending || addingUser} onClick={() => setAddingUser(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add user
        </Button>
      </div>
      {addingUser && (
        <form className="grid gap-2 rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); addUser.mutate() }}>
          <TextInput label="Username" value={username} onChange={setUsername} placeholder="narasaka" disabled={pending} />
          <Button type="button" variant="ghost" className="self-end" disabled={pending} onClick={() => { setAddingUser(false); setUsername('') }}>
            Cancel
          </Button>
          <Button variant="primary" className="self-end" disabled={pending || !username.trim()}>Save user</Button>
        </form>
      )}
      {errorMessage && <PanelError message={errorMessage} />}
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-prosights-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user} className="border-t border-prosights-border">
                  <td className="px-4 py-3 font-mono text-xs text-prosights-text">
                    {editingUser === user ? (
                      <input
                        aria-label={`Edit ${user}`}
                        className="h-9 w-full max-w-60 rounded-prosights-lg border border-prosights-border bg-prosights-surface px-3 text-sm text-prosights-text outline-none focus-visible:border-prosights-text focus-visible:ring-2 focus-visible:ring-prosights-ring"
                        value={editingValue}
                        onChange={(event) => setEditingValue(event.target.value)}
                      />
                    ) : user}
                  </td>
                  <td className="px-4 py-3 text-xs text-prosights-muted">sudo / docker / deployers</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                      {editingUser === user ? (
                        <>
                          <Button variant="secondary" disabled={pending || !editingValue.trim()} onClick={() => renameUser.mutate()}>
                            <Check className="size-4" />
                            Update
                          </Button>
                          <Button variant="ghost" disabled={pending} onClick={() => setEditingUser('')}>
                            <X className="size-4" />
                            Cancel
                          </Button>
                        </>
                      ) : (
                        <>
                          <Button variant="ghost" disabled={pending} onClick={() => startEditing(user)}>
                            <Pencil className="size-4" />
                            Rename
                          </Button>
                          <Button variant="ghost" disabled={pending} onClick={() => removeUser.mutate(user)}>
                            <Trash2 className="size-4" />
                            Remove
                          </Button>
                        </>
                      )}
                    </div>
                  </td>
                </tr>
              ))}
              {visibleUsers.length === 0 && (
                <tr className="border-t border-prosights-border">
                  <td colSpan={3} className="px-4 py-6 text-center text-xs text-prosights-muted">
                    {devUsers.isFetching ? 'Loading users...' : searchQuery ? 'No users match your search.' : 'No privileged users configured.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="truncate border-t px-4 py-2.5 font-mono text-[10px] text-prosights-muted">
          {devUsers.data?.path ?? '/srv/deploy-manager/ops/dev-sudo-users.txt'}
        </div>
      </Panel>
    </section>
  )
}

const serverLogsCommand = 'if command -v journalctl >/dev/null 2>&1; then journalctl --no-pager -n 300 -r -o short-iso 2>&1; else for container in $(docker ps --format "{{.Names}}"); do docker logs --timestamps --tail 100 "$container" 2>&1 | awk -v name="$container" \'{ stamp=$1; $1=""; print stamp " [" name "]" $0 }\'; done | sort -r | head -n 300; fi'

export function ServerLogsPanel({ server }: { server: Server }) {
  const logs = useQuery({ ...serverCommandQuery(server.id, serverLogsCommand), refetchInterval: 10_000 })
  return (
    <section className="flex min-h-0 max-w-5xl flex-1 flex-col overflow-hidden rounded-prosights-lg border border-prosights-border bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-100">Server logs</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">Latest system or container logs from {server.name}.</p>
        </div>
        <Button variant="secondary" className="border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10" disabled={logs.isFetching} onClick={() => void logs.refetch()}>
          <RefreshCw className={`size-3.5 ${logs.isFetching ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {logs.error
        ? <div className="p-4"><PanelError message={logs.error.message} /></div>
        : <pre aria-label="Server logs" className="min-h-80 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5 text-zinc-300">{logs.data || (logs.isFetching ? 'Loading logs…' : 'No journal entries returned.')}</pre>}
    </section>
  )
}

const terminalOptions: ITerminalOptions = {
  allowProposedApi: false,
  convertEol: true,
  cursorBlink: false,
  cursorStyle: 'block',
  cursorInactiveStyle: 'block',
  fontFamily: 'SFMono-Regular, Consolas, "Liberation Mono", Menlo, monospace',
  fontSize: 13.5,
  lineHeight: 1.35,
  scrollback: 4000,
  theme: {
    background: '#0a0a0a',
    foreground: '#d4d4d8',
    cursor: '#f4f4f5',
    selectionBackground: '#334155',
    black: '#18181b',
    red: '#f87171',
    green: '#4ade80',
    yellow: '#facc15',
    blue: '#60a5fa',
    magenta: '#c084fc',
    cyan: '#22d3ee',
    white: '#e4e4e7',
    brightBlack: '#71717a',
    brightRed: '#fb7185',
    brightGreen: '#86efac',
    brightYellow: '#fde047',
    brightBlue: '#93c5fd',
    brightMagenta: '#d8b4fe',
    brightCyan: '#67e8f9',
    brightWhite: '#ffffff',
  },
}

type TerminalStatus = 'connecting' | 'connected' | 'closed' | 'error'

export function ApplicationTerminal({
  server,
  application,
  active = true,
}: {
  server?: Server
  application?: Application
  active?: boolean
}) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const serverID = server?.id
  const applicationID = application?.id
  // The socket this terminal should hold open; empty when idle. Status is
  // tagged with it so a new connection starts at "connecting" without an
  // effect resetting state.
  const connection = active && serverID ? `${serverID}/${applicationID ?? ''}` : ''
  const [reported, setReported] = useState<{ connection: string, status: TerminalStatus }>()
  const status = !connection ? 'idle' : reported?.connection === connection ? reported.status : 'connecting'

  useEffect(() => {
    const element = terminalRef.current
    if (!active || !serverID || !element) return
    const opened = `${serverID}/${applicationID ?? ''}`
    const report = (next: TerminalStatus) => setReported({ connection: opened, status: next })

    const terminal = new XTerm(terminalOptions)
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(element)
    fitAddon.fit()
    terminal.focus()

    const applicationQuery = applicationID ? `?application_id=${encodeURIComponent(applicationID)}` : ''
    const socket = new WebSocket(webSocketURL(`/api/servers/${serverID}/terminal${applicationQuery}`))
    // Aborting removes every listener, so the close event fired by our own
    // cleanup never writes to the disposed terminal.
    const listeners = new AbortController()
    const { signal } = listeners
    const sendResize = () => {
      fitAddon.fit()
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }

    socket.addEventListener('open', () => {
      report('connected')
      sendResize()
    }, { signal })
    socket.addEventListener('message', (event) => terminal.write(String(event.data)), { signal })
    socket.addEventListener('close', () => {
      report('closed')
      terminal.writeln('\r\nconnection closed')
    }, { signal })
    socket.addEventListener('error', () => {
      report('error')
      terminal.writeln('\r\nterminal connection failed')
    }, { signal })
    window.addEventListener('resize', () => {
      if (socket.readyState === WebSocket.OPEN) sendResize()
    }, { signal })
    const input = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })

    return () => {
      listeners.abort()
      input.dispose()
      socket.close()
      terminal.dispose()
    }
  }, [active, serverID, applicationID])

  if (!server) return <PanelError message="This application does not have a server target." />

  return (
    <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-inner">
      <div className="flex h-9 items-center justify-between border-b border-white/10 px-3">
        <div className="flex items-center gap-2 text-xs text-zinc-400">
          <span className="flex items-center gap-1.5">
            <span className="size-2 rounded-full bg-red-400" />
            <span className="size-2 rounded-full bg-yellow-300" />
            <span className="size-2 rounded-full bg-emerald-400" />
          </span>
          <span className="font-mono">ssh console</span>
        </div>
        <div className="font-mono text-xs text-zinc-400">{status} · {server.hostname}:{server.ssh_port}</div>
      </div>
      <div ref={terminalRef} className="terminal-shell h-[420px] [&_.xterm]:h-full [&_.xterm-viewport]:overflow-y-auto" />
    </div>
  )
}

export function applicationTerminalDirectory(application: Pick<Application, 'remote_directory' | 'compose_path'>) {
  const composeDirectory = application.compose_path.split('/').slice(0, -1).filter((segment) => segment && segment !== '.').join('/')
  return composeDirectory ? `${application.remote_directory.replace(/\/+$/, '')}/${composeDirectory}` : application.remote_directory
}
