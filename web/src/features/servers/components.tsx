import { useEffect, useRef, useState } from 'react'
import { Terminal as XTerm } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import '@xterm/xterm/css/xterm.css'
import { Check, LogOut, Pencil, Plus, RefreshCw, Terminal as TerminalIcon, Trash2, Wifi, X } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import { webSocketURL, type Application, type Server, type ServerDevUsersResponse, type TailscaleDevicesResponse } from '../../lib/api'
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
  form: ServerFormState
  tailscaleDevices?: TailscaleDevicesResponse
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ServerFormState>) => void
  onSubmit: () => void
}

export function ServerCreatePanel({
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
    <Panel title="Register server">
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
  isChecking: boolean
  onCheck: (serverID: string) => void
  onOpenConsole: (serverID: string) => void
}

export function ServerList({ servers, checkResults, isChecking, onCheck, onOpenConsole }: ServerListProps) {
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
              <tr key={server.id} className="border-t">
                <td className="px-4 py-3 font-medium">{server.name}</td>
                <td className="px-4 py-3">
                  <div className="font-mono text-xs text-ink">{server.ssh_user}@{server.hostname}:{server.ssh_port}</div>
                  <div className="mt-1 text-xs text-muted">{server.connection_mode === 'tailscale_ssh' ? 'keyless via tailnet policy' : server.ssh_key_path ?? 'ssh key not configured'}</div>
                </td>
                <td className="px-4 py-3 text-muted">{connectionModeLabel(server.connection_mode)}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(server.status)}>{server.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted">CPU {percent(server.cpu_usage)} / RAM {percent(server.memory_usage)} / Disk {percent(server.disk_usage)}</td>
                <td className="px-4 py-3 text-muted">{formatLastChecked(server.last_checked_at)}</td>
                <td className="px-4 py-3 text-muted">{server.proxy_type}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" disabled={!canConnectToServer(server) || isChecking} onClick={() => onCheck(server.id)}>
                      <Wifi className="size-4" />
                      Check
                    </Button>
                    <Button variant="secondary" disabled={!canConnectToServer(server)} onClick={() => onOpenConsole(server.id)}>
                      <TerminalIcon className="size-4" />
                      Console
                    </Button>
                  </div>
                  {checkResults[server.id] && <ServerCheckSummary result={checkResults[server.id]} />}
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
  servers: Server[]
  selectedServerID: string
  users?: ServerDevUsersResponse
  pending: boolean
  loading: boolean
  errorMessage?: string
  onSelectServer: (serverID: string) => void
  onAdd: (username: string) => void
  onUpdate: (currentUsername: string, username: string) => void
  onDelete: (username: string) => void
  onApply: () => void
}

export function ServerDevUsersPanel({
  servers,
  selectedServerID,
  users,
  pending,
  loading,
  errorMessage,
  onSelectServer,
  onAdd,
  onUpdate,
  onDelete,
  onApply,
}: ServerDevUsersPanelProps) {
  const [username, setUsername] = useState('')
  const [editingUser, setEditingUser] = useState('')
  const [editingValue, setEditingValue] = useState('')
  const selectedServer = servers.find((server) => server.id === selectedServerID)
  const canSubmit = Boolean(username.trim()) && !pending && Boolean(selectedServerID)

  function submit() {
    const value = username.trim()
    if (!value) {
      return
    }
    onAdd(value)
    setUsername('')
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

  return (
    <Panel
      title="Dev sudo users"
      action={
        <Button variant="ghost" disabled={pending || !selectedServerID} onClick={onApply}>
          <RefreshCw className="size-4" />
          Apply
        </Button>
      }
    >
      <div className="grid gap-3 p-4 md:grid-cols-[240px_1fr_auto]">
        <SelectInput label="Server" value={selectedServerID} onChange={onSelectServer} disabled={servers.length === 0}>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </SelectInput>
        <TextInput label="Username" value={username} onChange={setUsername} placeholder="narasaka" disabled={!selectedServerID || pending} />
        <div className="flex items-end">
          <Button variant="primary" disabled={!canSubmit} onClick={submit}>
            <Plus className="size-4" />
            Add user
          </Button>
        </div>
      </div>
      <div className="border-t px-4 py-3 text-xs text-muted">
        {selectedServer ? `${selectedServer.name} · ${users?.path ?? '/srv/deploy-manager/ops/dev-sudo-users.txt'}` : 'Select a server'}
      </div>
      {errorMessage && <PanelError message={errorMessage} />}
      <div className="overflow-x-auto border-t">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Username</th>
              <th className="px-4 py-3 font-medium">Access</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {(users?.users ?? []).map((user) => (
              <tr key={user} className="border-t">
                <td className="px-4 py-3 font-mono text-xs text-ink">
                  {editingUser === user ? (
                    <input
                      aria-label={`Edit ${user}`}
                      className="h-9 w-full max-w-60 rounded-md border bg-background px-3 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
                      value={editingValue}
                      onChange={(event) => setEditingValue(event.target.value)}
                    />
                  ) : user}
                </td>
                <td className="px-4 py-3 text-muted">sudo / docker / deployers</td>
                <td className="px-4 py-3">
                  {editingUser === user ? (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="secondary" disabled={pending || !editingValue.trim()} onClick={submitEdit}>
                        <Check className="size-4" />
                        Update
                      </Button>
                      <Button variant="ghost" disabled={pending} onClick={() => setEditingUser('')}>
                        <X className="size-4" />
                        Cancel
                      </Button>
                    </div>
                  ) : (
                    <div className="flex flex-wrap gap-2">
                      <Button variant="ghost" disabled={pending} onClick={() => startEditing(user)}>
                        <Pencil className="size-4" />
                        Rename
                      </Button>
                      <Button variant="ghost" disabled={pending} onClick={() => onDelete(user)}>
                        <Trash2 className="size-4" />
                        Remove
                      </Button>
                    </div>
                  )}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {!loading && (users?.users.length ?? 0) === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No dev sudo users found.</div>}
      {loading && <div className="border-t px-4 py-6 text-sm text-muted">Loading users...</div>}
    </Panel>
  )
}

type ServerTerminalPanelProps = {
  servers: Server[]
  applications: Application[]
  selectedServerID: string
  selectedApplicationID: string
  isOpen: boolean
  onSelectServer: (serverID: string) => void
  onSelectApplication: (applicationID: string) => void
  onClose: () => void
}

export function ServerTerminalPanel({
  servers,
  applications,
  selectedServerID,
  selectedApplicationID,
  isOpen,
  onSelectServer,
  onSelectApplication,
  onClose,
}: ServerTerminalPanelProps) {
  const terminalRef = useRef<HTMLDivElement>(null)
  const [status, setStatus] = useState<'idle' | 'connecting' | 'connected' | 'closed' | 'error'>('idle')
  const selectedServer = servers.find((server) => server.id === selectedServerID)
  const serverApplications = applications.filter((application) => application.server_id === selectedServerID)
  const selectedApplication = serverApplications.find((application) => application.id === selectedApplicationID)
  const selectedServerName = selectedServer?.name ?? ''
  const selectedApplicationDirectory = selectedApplication?.remote_directory ?? ''

  useEffect(() => {
    if (!isOpen || !selectedServerName || !selectedApplicationDirectory || !terminalRef.current) {
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

    const socket = new WebSocket(webSocketURL(`/api/servers/${selectedServerID}/terminal?application_id=${encodeURIComponent(selectedApplicationID)}`))
    const sendResize = () => {
      fitAddon.fit()
      socket.send(JSON.stringify({ type: 'resize', cols: terminal.cols, rows: terminal.rows }))
    }
    const resize = () => {
      if (socket.readyState === WebSocket.OPEN) {
        sendResize()
      }
    }

    socket.addEventListener('open', () => {
      setStatus('connected')
      sendResize()
    })
    socket.addEventListener('message', (event) => {
      terminal.write(String(event.data))
    })
    socket.addEventListener('close', () => {
      setStatus('closed')
      terminal.writeln('\r\nconnection closed')
    })
    socket.addEventListener('error', () => {
      setStatus('error')
      terminal.writeln('\r\nterminal connection failed')
    })
    const disposable = terminal.onData((data) => {
      if (socket.readyState === WebSocket.OPEN) {
        socket.send(JSON.stringify({ type: 'input', data }))
      }
    })
    window.addEventListener('resize', resize)

    return () => {
      window.removeEventListener('resize', resize)
      disposable.dispose()
      socket.close()
      terminal.dispose()
    }
  }, [isOpen, selectedApplicationDirectory, selectedApplicationID, selectedServerID, selectedServerName])

  if (!isOpen) {
    return null
  }

  return (
    <Panel
      title="Terminal console"
      action={
        <div className="flex items-center gap-3">
          {selectedServer && <span className="font-mono text-xs text-muted">{terminalStatusLabel(status)} · {selectedServer.hostname}:{selectedServer.ssh_port}</span>}
          <Button variant="ghost" onClick={onClose}>
            <LogOut className="size-4" />
            Leave
          </Button>
        </div>
      }
    >
      <div className="grid gap-3 p-4 lg:grid-cols-[220px_260px_1fr]">
        <SelectInput label="Server" value={selectedServerID} onChange={onSelectServer}>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </SelectInput>
        <SelectInput label="Application" value={selectedApplicationID} onChange={onSelectApplication}>
          {serverApplications.map((application) => (
            <option key={application.id} value={application.id}>{application.name}</option>
          ))}
        </SelectInput>
        <div className="flex items-end">
          <div className="flex h-9 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted">
            <TerminalIcon className="size-4" />
            <span className="truncate">{selectedApplication?.remote_directory ?? 'No application target selected'}</span>
          </div>
        </div>
      </div>
      <div className="border-t p-4">
        {!selectedServer && <PanelError message="Select a server before opening the terminal." />}
        {selectedServer && !selectedApplication && <PanelError message="Select an application target before opening the terminal." />}
        <div className="overflow-hidden rounded-md border border-zinc-800 bg-zinc-950 text-zinc-100 shadow-inner">
          <div className="flex h-9 items-center justify-between border-b border-white/10 px-3">
            <div className="flex items-center gap-2 text-xs text-zinc-400">
              <span className="size-2 rounded-full bg-red-400" />
              <span className="size-2 rounded-full bg-yellow-300" />
              <span className="size-2 rounded-full bg-emerald-400" />
            </div>
            <div className="font-mono text-xs text-zinc-400">ssh console</div>
          </div>
          <div ref={terminalRef} className="terminal-shell h-[420px] [&_.xterm]:h-full [&_.xterm-viewport]:overflow-y-auto" />
        </div>
      </div>
    </Panel>
  )
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

function canConnectToServer(server: Server) {
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
