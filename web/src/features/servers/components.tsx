import { Wifi } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import type { Server } from '../../lib/api'
import { percent, statusTone } from '../status'

export type ServerFormState = {
  name: string
  hostname: string
  ssh_user: string
  ssh_port: string
  ssh_key_path: string
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
    proxy_type: 'caddy',
  }
}

type ServerCreatePanelProps = {
  form: ServerFormState
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ServerFormState>) => void
  onSubmit: () => void
}

export function ServerCreatePanel({
  form,
  isSaving,
  errorMessage,
  onChange,
  onSubmit,
}: ServerCreatePanelProps) {
  return (
    <Panel title="Register server">
      <form
        className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_110px_110px_1fr_120px_auto]"
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
        <TextInput label="SSH key path" value={form.ssh_key_path} onChange={(ssh_key_path) => onChange({ ssh_key_path })} placeholder="~/.ssh/id_ed25519" required />
        <SelectInput label="Proxy" value={form.proxy_type} onChange={(proxy_type) => onChange({ proxy_type: proxy_type as ServerFormState['proxy_type'] })}>
          <option value="caddy">Caddy</option>
          <option value="traefik">Traefik</option>
          <option value="none">None</option>
        </SelectInput>
        <div className="flex items-end">
          <Button variant="primary" disabled={isSaving || !form.name || !form.hostname || !form.ssh_key_path}>
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
}

export function ServerList({ servers, checkResults, isChecking, onCheck }: ServerListProps) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Name</th>
              <th className="px-4 py-3 font-medium">Host</th>
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
                  <div className="mt-1 text-xs text-muted">{server.ssh_key_path ?? 'ssh key not configured'}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(server.status)}>{server.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted">CPU {percent(server.cpu_usage)} / RAM {percent(server.memory_usage)} / Disk {percent(server.disk_usage)}</td>
                <td className="px-4 py-3 text-muted">{formatLastChecked(server.last_checked_at)}</td>
                <td className="px-4 py-3 text-muted">{server.proxy_type}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" disabled={!server.ssh_key_path || isChecking} onClick={() => onCheck(server.id)}>
                    <Wifi className="size-4" />
                    Check
                  </Button>
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
