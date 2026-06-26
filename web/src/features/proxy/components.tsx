import { Route } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import type { Application, ProxyRoute as ProxyRouteRecord, Server } from '../../lib/api'
import { statusTone } from '../status'

export type ProxyFormState = {
  server_id: string
  application_id: string
  domain: string
  upstream_url: string
  tls_enabled: boolean
}

export function defaultProxyForm(serverID = ''): ProxyFormState {
  return {
    server_id: serverID,
    application_id: '',
    domain: '',
    upstream_url: 'http://127.0.0.1:3000',
    tls_enabled: true,
  }
}

type ProxyRouteFormProps = {
  form: ProxyFormState
  servers: Server[]
  applications: Application[]
  selectedApplication?: Application
  defaultServerID: string
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ProxyFormState>) => void
  onSelectApplication: (applicationID: string) => void
  onSubmit: () => void
}

export function ProxyRouteForm({
  form,
  servers,
  applications,
  selectedApplication,
  defaultServerID,
  isSaving,
  errorMessage,
  onChange,
  onSelectApplication,
  onSubmit,
}: ProxyRouteFormProps) {
  return (
    <Panel title="Route domain">
      <form
        className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_1fr_110px_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <SelectInput label="Server" value={form.server_id || defaultServerID} onChange={(server_id) => onChange({ server_id })} disabled={Boolean(form.application_id)} required>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>{server.name} / {server.proxy_type}</option>
          ))}
        </SelectInput>
        <SelectInput label="Application" value={form.application_id} onChange={onSelectApplication}>
          <option value="">No application</option>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>{application.name}</option>
          ))}
        </SelectInput>
        <TextInput label="Domain" value={form.domain} onChange={(domain) => onChange({ domain })} placeholder="app.example.com" required />
        <TextInput label="Upstream" value={form.upstream_url} onChange={(upstream_url) => onChange({ upstream_url })} placeholder="http://127.0.0.1:3000" required />
        <SelectInput label="TLS" value={form.tls_enabled ? 'true' : 'false'} onChange={(value) => onChange({ tls_enabled: value === 'true' })}>
          <option value="true">On</option>
          <option value="false">Off</option>
        </SelectInput>
        <div className="flex items-end">
          <Button variant="primary" disabled={isSaving || !form.server_id || !form.domain || !form.upstream_url}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
      </form>
      {selectedApplication && <div className="border-t px-4 py-3 text-sm text-muted">Linked to {selectedApplication.name} on {selectedApplication.server_name}. Server selection is derived from the application target.</div>}
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

type ProxyRouteListProps = {
  routes: ProxyRouteRecord[]
  isApplying: boolean
  errorMessage?: string
  onApply: (routeID: string) => void
}

export function ProxyRouteList({ routes, isApplying, errorMessage, onApply }: ProxyRouteListProps) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Upstream</th>
              <th className="px-4 py-3 font-medium">TLS</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Last applied</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {routes.map((route) => (
              <tr key={route.id} className="border-t">
                <td className="px-4 py-3 font-medium">{route.domain}</td>
                <td className="px-4 py-3 text-muted">{route.application_name ?? route.server_name} / {route.proxy_type}</td>
                <td className="px-4 py-3 text-muted">{route.upstream_url}</td>
                <td className="px-4 py-3 text-muted">{route.tls_enabled ? 'On' : 'Off'}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(route.status)}>{route.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted">{formatLastApplied(route.last_applied_at)}</td>
                <td className="px-4 py-3">
                  <Button variant="ghost" disabled={isApplying || route.proxy_type === 'none'} onClick={() => onApply(route.id)}>
                    <Route className="size-4" />
                    Apply
                  </Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {routes.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No proxy routes registered.</div>}
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

function formatLastApplied(value: string | null) {
  if (!value) {
    return 'not applied'
  }
  return new Date(value).toLocaleString()
}
