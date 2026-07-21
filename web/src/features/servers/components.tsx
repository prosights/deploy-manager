import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Check, Pencil, Plus, RefreshCw, Search, Settings2, ShieldCheck, Terminal as TerminalIcon, Trash2, X } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import { webSocketURL, type Application, type Server, type ServerDevUsersResponse, type TailscaleDevicesResponse } from '../../lib/api'
import { matchesSearch } from '../../lib/search'
import { percent, statusTone } from '../status'

export type ServerFormState = {
  name: string
  hostname: string
  ssh_user: string
  ssh_port: string
  ssh_key_path: string
  connection_mode: Server['connection_mode']
  proxy_type: 'caddy' | 'traefik' | 'none'
}

export type ServerCheckResults = Record<string, {
  sshOK: boolean
  dockerOK: boolean
  docker?: string
  sshError?: string
  dockerError?: string
}>

export function defaultServerForm(): ServerFormState {
  return {
    name: '',
    hostname: '',
    ssh_user: 'root',
    ssh_port: '22',
    ssh_key_path: '',
    connection_mode: 'direct_ssh',
    proxy_type: 'caddy',
  }
}

type ServerCreatePanelProps = {
  embedded?: boolean
  form: ServerFormState
  tailscaleDevices?: TailscaleDevicesResponse
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ServerFormState>) => void
  onSubmit: () => void
}

export function ServerCreatePanel({
  embedded = false,
  form,
  tailscaleDevices,
  isSaving,
  errorMessage,
  onChange,
  onSubmit,
}: ServerCreatePanelProps) {
  const selectedDeviceKey = tailscaleDevices?.devices.find((device) => device.host === form.hostname)?.host ?? ''
  const requiresSSHKey = form.connection_mode === 'direct_ssh'
  function importTailscaleDevice(host: string) {
    const device = tailscaleDevices?.devices.find((item) => item.host === host)
    if (!device) {
      return
    }
    onChange({
      name: device.name,
      hostname: device.host,
      connection_mode: 'tailscale_ssh',
      ssh_key_path: '',
    })
  }

  function setConnectionMode(connectionMode: ServerFormState['connection_mode']) {
    onChange({
      connection_mode: connectionMode,
      ...(connectionMode === 'tailscale_ssh' ? { ssh_key_path: '' } : {}),
    })
  }

  return (
    <Panel title={embedded ? undefined : 'Register server'} className={embedded ? 'rounded-none border-0' : undefined}>
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
          <div className="mt-2 text-xs text-muted">
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
          onSubmit()
        }}
      >
        <TextInput label="Name" value={form.name} onChange={(name) => onChange({ name })} required />
        <TextInput label="Hostname" value={form.hostname} onChange={(hostname) => onChange({ hostname })} required />
        <TextInput label="SSH user" value={form.ssh_user} onChange={(ssh_user) => onChange({ ssh_user })} required />
        <label className="space-y-1 text-xs text-muted">
          <span>SSH port</span>
          <input
            className="h-9 w-full rounded-md border bg-background px-3 text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
            min={1}
            max={65535}
            type="number"
            value={form.ssh_port}
            onChange={(event) => onChange({ ssh_port: event.target.value })}
            required
          />
        </label>
        <TextInput label="SSH key path" value={form.ssh_key_path} onChange={(ssh_key_path) => onChange({ ssh_key_path })} placeholder={requiresSSHKey ? '~/.ssh/id_ed25519' : 'not used for Tailscale SSH'} disabled={!requiresSSHKey} required={requiresSSHKey} />
        <SelectInput label="Connection" value={form.connection_mode} onChange={(connection_mode) => setConnectionMode(connection_mode as ServerFormState['connection_mode'])}>
          <option value="direct_ssh">Direct SSH</option>
          <option value="tailscale_ssh">Tailscale SSH</option>
        </SelectInput>
        <SelectInput label="Proxy" value={form.proxy_type} onChange={(proxy_type) => onChange({ proxy_type: proxy_type as ServerFormState['proxy_type'] })}>
          <option value="caddy">Caddy</option>
          <option value="traefik">Traefik</option>
          <option value="none">None</option>
        </SelectInput>
        <div className="flex items-end">
          <Button variant="primary" disabled={isSaving || !form.name || !form.hostname || (requiresSSHKey && !form.ssh_key_path)}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

type ServerListProps = {
  servers: Server[]
  checkResults: ServerCheckResults
  onOpen: (serverID: string) => void
  onOpenConsole: (serverID: string) => void
  onConfigure: (serverID: string) => void
}

export function ServerList({ servers, checkResults, onOpen, onOpenConsole, onConfigure }: ServerListProps) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
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
            {servers.map((server) => (
              <tr key={server.id} className="cursor-pointer border-t transition-colors hover:bg-prosights-surface-muted/60" onClick={() => onOpen(server.id)}>
                <td className="px-4 py-3 font-medium">
                  <button type="button" className="bg-transparent text-left hover:underline" onClick={(event) => { event.stopPropagation(); onOpen(server.id) }}>{server.name}</button>
                </td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-ink">{server.ssh_user}@{server.hostname}:{server.ssh_port}</div>
                  <div className="mt-1 text-xs text-muted">{server.connection_mode === 'tailscale_ssh' ? 'keyless via tailnet policy' : server.ssh_key_path ?? 'ssh key not configured'}</div>
                </td>
                <td className="px-4 py-3 text-muted">{connectionModeLabel(server.connection_mode)}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(server.status)}>{server.status}</Badge>
                  {checkResults[server.id] && <ServerCheckSummary result={checkResults[server.id]} />}
                </td>
                <td className="px-4 py-3 text-muted">CPU {percent(server.cpu_usage)} / RAM {percent(server.memory_usage)} / Disk {percent(server.disk_usage)}</td>
                <td className="px-4 py-3 text-muted">{formatLastChecked(server.last_checked_at)}</td>
                <td className="px-4 py-3 text-muted">{server.proxy_type}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="secondary" disabled={!canConnectToServer(server)} onClick={(event) => { event.stopPropagation(); onOpenConsole(server.id) }}>
                      <TerminalIcon className="size-4" />
                      Console
                    </Button>
                    <Button variant="ghost" onClick={(event) => { event.stopPropagation(); onConfigure(server.id) }}>
                      <Settings2 className="size-4" />
                      Configure
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {servers.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No servers found.</div>}
    </Panel>
  )
}

type ServerDevUsersPanelProps = {
  server?: Server
  users?: ServerDevUsersResponse
  pending: boolean
  loading: boolean
  errorMessage?: string
  onAdd: (username: string) => void
  onUpdate: (currentUsername: string, username: string) => void
  onDelete: (username: string) => void
}

export function ServerDevUsersPanel({
  server,
  users,
  pending,
  loading,
  errorMessage,
  onAdd,
  onUpdate,
  onDelete,
}: ServerDevUsersPanelProps) {
  const [username, setUsername] = useState('')
  const [searchQuery, setSearchQuery] = useState('')
  const [addingUser, setAddingUser] = useState(false)
  const [editingUser, setEditingUser] = useState('')
  const [editingValue, setEditingValue] = useState('')
  const canSubmit = Boolean(username.trim()) && !pending && Boolean(server)

  function submit() {
    const value = username.trim()
    if (!value) {
      return
    }
    onAdd(value)
    setUsername('')
    setAddingUser(false)
  }

  function startEditing(user: string) {
    setEditingUser(user)
    setEditingValue(user)
  }

  function submitEdit() {
    const value = editingValue.trim()
    if (!editingUser || !value) {
      return
    }
    onUpdate(editingUser, value)
    setEditingUser('')
    setEditingValue('')
  }

  const configuredUsers = users?.users ?? []
  const visibleUsers = configuredUsers.filter((user) => matchesSearch(searchQuery, [user]))
  const accessPath = users?.path ?? '/srv/deploy-manager/ops/dev-sudo-users.txt'

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
        <Button type="button" variant="primary" className="ml-auto" disabled={!server || pending || addingUser} onClick={() => setAddingUser(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Add user
        </Button>
      </div>
      {addingUser && (
        <form className="grid gap-2 rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4 sm:grid-cols-[minmax(0,1fr)_auto_auto]" onSubmit={(event) => { event.preventDefault(); submit() }}>
          <TextInput label="Username" value={username} onChange={setUsername} placeholder="narasaka" disabled={!server || pending} />
          <Button type="button" variant="ghost" className="self-end" disabled={pending} onClick={() => { setAddingUser(false); setUsername('') }}>
            Cancel
          </Button>
          <Button variant="primary" className="self-end" disabled={!canSubmit}>Save user</Button>
        </form>
      )}
      {errorMessage && <PanelError message={errorMessage} />}
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">User</th>
                <th className="px-4 py-3 font-medium">Access</th>
                <th className="px-4 py-3 text-right font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {visibleUsers.map((user) => (
                <tr key={user} className="border-t border-prosights-border">
                  <td className="px-4 py-3 font-mono text-xs text-ink">
                  {editingUser === user ? (
                    <input
                      aria-label={`Edit ${user}`}
                      className="h-9 w-full max-w-60 rounded-prosights-lg border border-prosights-border bg-prosights-surface px-3 text-sm text-prosights-text outline-none focus-visible:border-prosights-text focus-visible:ring-2 focus-visible:ring-prosights-ring"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                    />
                  ) : user}
                  </td>
                  <td className="px-4 py-3 text-xs text-muted">sudo / docker / deployers</td>
                  <td className="px-4 py-3">
                    <div className="flex justify-end gap-2">
                  {editingUser === user ? (
                    <>
                      <Button variant="secondary" disabled={pending || !editingValue.trim()} onClick={submitEdit}>
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
                      <Button variant="ghost" disabled={pending} onClick={() => onDelete(user)}>
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
                    {loading ? 'Loading users...' : searchQuery ? 'No users match your search.' : 'No privileged users configured.'}
                  </td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
        <div className="truncate border-t px-4 py-2.5 font-mono text-[10px] text-prosights-muted">
          {server ? accessPath : 'Server unavailable'}
        </div>
      </Panel>
    </section>
  )
}

export function ServerLogsPanel({
  server,
  logs,
  loading,
  errorMessage,
  onRefresh,
}: {
  server?: Server
  logs?: string
  loading: boolean
  errorMessage?: string
  onRefresh: () => void
}) {
  return (
    <section className="flex min-h-0 max-w-5xl flex-1 flex-col overflow-hidden rounded-prosights-lg border border-prosights-border bg-zinc-950">
      <div className="flex shrink-0 items-center justify-between gap-3 border-b border-white/10 px-4 py-3">
        <div>
          <h2 className="text-[13px] font-semibold text-zinc-100">Server logs</h2>
          <p className="mt-0.5 text-[11px] text-zinc-400">Latest system or container logs from {server?.name ?? 'this server'}.</p>
        </div>
        <Button variant="secondary" className="border-white/15 bg-white/5 text-zinc-200 hover:bg-white/10" disabled={!server || loading} onClick={onRefresh}>
          <RefreshCw className={`size-3.5 ${loading ? 'animate-spin' : ''}`} aria-hidden="true" />
          Refresh
        </Button>
      </div>
      {errorMessage
        ? <div className="p-4"><PanelError message={errorMessage} /></div>
        : <pre aria-label="Server logs" className="min-h-80 flex-1 overflow-auto whitespace-pre-wrap break-words p-4 font-mono text-[11px] leading-5 text-zinc-300">{logs || (loading ? 'Loading logs…' : 'No journal entries returned.')}</pre>}
    </section>
  )
}

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
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle')

  useEffect(() => {
    if (!active || !server || !terminalRef.current) {
      setStatus('idle')
      return
    }

    setStatus('connecting')
    const terminal = new XTerm({
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
    })
    const fitAddon = new FitAddon()
    terminal.loadAddon(fitAddon)
    terminal.open(terminalRef.current)
    fitAddon.fit()
    terminal.focus()

    const applicationQuery = application ? `?application_id=${encodeURIComponent(application.id)}` : ''
    const socket = new WebSocket(webSocketURL(`/api/servers/${server.id}/terminal${applicationQuery}`))
    const sendResize = () => {
      fitAddon.fit()
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
    const resize = () => {
      if (socket.readyState === WebSocket.OPEN) sendResize()
    }

    socket.addEventListener('open', () => {
      setStatus('connected')
      sendResize()
    })
    socket.addEventListener('message', (event) => terminal.write(String(event.data)))
    socket.addEventListener('close', () => {
      setStatus('closed')
      terminal.writeln('\r\nconnection closed')
    })
    socket.addEventListener('error', () => {
      setStatus('error')
      terminal.writeln('\r\nterminal connection failed')
    })
    const disposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) socket.send(JSON.stringify({ type: 'input', data }))
    })
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      disposable.dispose()
      socket.close()
      terminal.dispose()
    }
  }, [active, application, server])

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
        <div className="font-mono text-xs text-zinc-400">{terminalStatusLabel(status)} · {server.hostname}:{server.ssh_port}</div>
      </div>
      <div ref={terminalRef} className="terminal-shell h-[420px] [&_.xterm]:h-full [&_.xterm-viewport]:overflow-y-auto" />
    </div>
  )
}

export function applicationTerminalDirectory(application: Pick<Application, 'remote_directory' | 'compose_path'>) {
  const composeDirectory = application.compose_path.split('/').slice(0, -1).filter((segment) => segment && segment !== '.').join('/')
  return composeDirectory ? `${application.remote_directory.replace(/\/+$/, '')}/${composeDirectory}` : application.remote_directory
}

function terminalStatusLabel(status: 'idle' | 'connecting' | 'connected' | 'closed' | 'error') {
  switch (status) {
    case 'connecting':
      return 'connecting'
    case 'connected':
      return 'connected'
    case 'error':
      return 'error'
    case 'closed':
      return 'closed'
    default:
      return 'idle'
  }
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

export function canConnectToServer(server: Server) {
  return server.connection_mode === 'tailscale_ssh' || Boolean(server.ssh_key_path)
}

function formatLastChecked(value: string | null) {
  if (!value) {
    return 'not checked'
  }
  return new Date(value).toLocaleString()
}

function ServerCheckSummary({ result }: { result: ServerCheckResults[string] }) {
  return (
    <div className="mt-2 space-y-1">
      <div className="flex flex-wrap gap-2">
        <Badge tone={result.sshOK ? 'success' : 'danger'}>SSH {result.sshOK ? 'ok' : 'failed'}</Badge>
        <Badge tone={result.dockerOK ? 'success' : 'danger'}>Docker {result.dockerOK ? 'ok' : 'failed'}</Badge>
      </div>
      {result.docker && <div className="text-xs text-success">{result.docker}</div>}
      {result.sshError && <div className="max-w-56 truncate text-xs text-danger">{result.sshError}</div>}
      {result.dockerError && <div className="max-w-56 truncate text-xs text-danger">{result.dockerError}</div>}
    </div>
  )
}
