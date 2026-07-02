import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import type { Application, Environment, Server } from '../../lib/api'
import { suggestedRemoteDirectory } from '../../lib/remote-directory'
import { statusTone } from '../status'

export type ApplicationFormState = {
  environment_id: string
  server_id: string
  name: string
  repository_url: string
  branch: string
  compose_path: string
  remote_directory: string
  domain: string
  health_check_url: string
  doppler_project: string
  doppler_config: string
}

export function defaultApplicationForm(serverID = '', environmentID = ''): ApplicationFormState {
  return {
    environment_id: environmentID,
    server_id: serverID,
    name: '',
    repository_url: '',
    branch: 'main',
    compose_path: 'docker-compose.yml',
    remote_directory: '',
    domain: '',
    health_check_url: '',
    doppler_project: '',
    doppler_config: '',
  }
}

type ApplicationCreatePanelProps = {
  form: ApplicationFormState
  servers: Server[]
  environments: Environment[]
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ApplicationFormState>) => void
  onSubmit: () => void
}

export function ApplicationCreatePanel({
  form,
  servers,
  environments,
  isSaving,
  errorMessage,
  onChange,
  onSubmit,
}: ApplicationCreatePanelProps) {
  return (
    <Panel title="Create application target">
      <form
        className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <SelectInput label="Environment" value={form.environment_id} onChange={(environment_id) => onChange({ environment_id })} required>
          <option value="" disabled>Select environment</option>
          {environments.map((environment) => (
            <option key={environment.id} value={environment.id}>{environment.project_name ? `${environment.project_name} / ${environment.name}` : environment.name}</option>
          ))}
        </SelectInput>
        <SelectInput label="Server" value={form.server_id} onChange={(server_id) => onChange({ server_id })} required>
          <option value="" disabled>Select server</option>
          {servers.map((server) => (
            <option key={server.id} value={server.id}>{server.name}</option>
          ))}
        </SelectInput>
        <TextInput
          label="Name"
          value={form.name}
          onChange={(name) => onChange({
            name,
            ...(!form.remote_directory.trim() ? { remote_directory: suggestedRemoteDirectory(name) } : {}),
          })}
          required
        />
        <TextInput label="Repository" value={form.repository_url} onChange={(repository_url) => onChange({ repository_url })} placeholder="git@github.com:org/app.git" />
        <TextInput label="Remote directory" value={form.remote_directory} onChange={(remote_directory) => onChange({ remote_directory })} required placeholder="/srv/deploy-manager/apps/api" />
        <TextInput label="Domain" value={form.domain} onChange={(domain) => onChange({ domain })} />
        <div className="flex items-end">
          <Button variant="primary" disabled={isSaving || !form.environment_id || !form.server_id || !form.name || !form.remote_directory}>
            {isSaving ? 'Saving...' : 'Save'}
          </Button>
        </div>
        <TextInput label="Branch" value={form.branch} onChange={(branch) => onChange({ branch })} />
        <TextInput label="Compose path" value={form.compose_path} onChange={(compose_path) => onChange({ compose_path })} />
        <TextInput label="Health check URL" value={form.health_check_url} onChange={(health_check_url) => onChange({ health_check_url })} placeholder="https://api-{color}.example.com/healthz" />
        <TextInput label="Doppler project" value={form.doppler_project} onChange={(doppler_project) => onChange({ doppler_project })} />
        <TextInput label="Doppler config" value={form.doppler_config} onChange={(doppler_config) => onChange({ doppler_config })} placeholder="prd" />
      </form>
      <div className="border-t px-4 py-3 text-sm text-muted">Doppler tokens stay outside this app. Blue-green health checks must include <span className="font-mono text-ink">{'{color}'}</span> so the next color is checked before promotion.</div>
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

export function ApplicationList({ applications }: { applications: Application[] }) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Application</th>
              <th className="px-4 py-3 font-medium">Project</th>
              <th className="px-4 py-3 font-medium">Environment</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium">Compose</th>
              <th className="px-4 py-3 font-medium">Directory</th>
              <th className="px-4 py-3 font-medium">Domain</th>
              <th className="px-4 py-3 font-medium">Health</th>
              <th className="px-4 py-3 font-medium">Doppler</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id} className="border-t">
                <td className="px-4 py-3">
                  <div className="font-medium">{application.name}</div>
                  <div className="text-xs text-muted">{application.repository_url ?? 'manual compose source'}</div>
                  <div className="mt-1 text-xs text-muted">{applicationVersionText(application)}</div>
                </td>
                <td className="px-4 py-3 text-muted">{application.project_name}</td>
                <td className="px-4 py-3">
                  <Badge tone={application.environment_kind === 'preview' ? 'warning' : application.environment_kind === 'production' ? 'success' : 'neutral'}>
                    {application.environment_name}{application.environment_is_ephemeral ? ' PR' : ''}
                  </Badge>
                </td>
                <td className="px-4 py-3 text-muted">{application.server_name}</td>
                <td className="px-4 py-3 text-muted">{application.branch}</td>
                <td className="px-4 py-3 text-muted">{application.compose_path}</td>
                <td className="px-4 py-3 text-muted">{application.remote_directory}</td>
                <td className="px-4 py-3 text-muted">{application.domain ?? 'not routed'}</td>
                <td className="px-4 py-3 text-muted">{application.health_check_url ?? 'not configured'}</td>
                <td className="px-4 py-3">
                  {application.doppler_project && application.doppler_config ? (
                    <Badge tone="accent">{application.doppler_project} / {application.doppler_config}</Badge>
                  ) : (
                    <span className="text-muted">not scoped</span>
                  )}
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(application.status)}>{application.status}</Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applications.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No applications found.</div>}
    </Panel>
  )
}

function applicationVersionText(application: Application): string {
  if (application.target_version) {
    return `target ${shortVersion(application.target_version)}`
  }
  if (application.current_version) {
    return `current ${shortVersion(application.current_version)}`
  }
  return 'version pending'
}

function shortVersion(version: string): string {
  return version.length > 12 ? version.slice(0, 12) : version
}
