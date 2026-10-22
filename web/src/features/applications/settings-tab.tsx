import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ChevronDown, FileCode2, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { InlineError } from '../../components/ui/error-message'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import { deleteApplication, updateApplication, type Application, type UpdateApplicationInput } from '../../lib/api'
import { cn } from '../../lib/cn'
import { optionalTrimmed } from '../../lib/format'
import { environmentsQuery, githubComposeFileQuery, githubRepositoriesQuery, proxyRoutesQuery, serversQuery } from '../../lib/queries'
import { validateHealthCheckURL } from '../../lib/urls'
import { validateComposePath, validateGitBranch, validateRemoteDirectory, validateRepositoryURL } from '../../lib/validation'
import { ApplicationDomains } from './domains'
import { activeServiceTargets, applicationComposeServices, composeContainerPorts, environmentOrder, forApplication, githubRepositoryForApplication, routeTargets } from './helpers'
import { DetailItem, ServiceRouteLinks, SettingsSection } from './parts'

type ExecutionMode = 'follow_stack' | 'singleton'

type ServiceForm = {
  environment_id: string
  server_id: string
  name: string
  repository_url: string
  branch: string
  compose_path: string
  remote_directory: string
  health_check_url: string
  github_auto_deploy: boolean
  service_execution_modes: Record<string, ExecutionMode>
}

export function SettingsTab({ application, onDeleted }: { application: Application, onDeleted: () => void }) {
  const [form, setForm] = useState<ServiceForm>(() => applicationToServiceForm(application))
  const [composeOpen, setComposeOpen] = useState(false)
  const { data: environments } = useSuspenseQuery({ ...environmentsQuery, select: (items) => environmentOrder(items.filter((environment) => environment.project_id === application.project_id)) })
  const { data: servers } = useSuspenseQuery(serversQuery)
  const { data: routes } = useSuspenseQuery({ ...proxyRoutesQuery, select: forApplication(application.id) })
  const { data: repository } = useSuspenseQuery({ ...githubRepositoriesQuery, select: (repositories) => githubRepositoryForApplication(application, repositories) })
  const composeFile = useQuery({
    ...githubComposeFileQuery(repository?.connector_id ?? '', repository?.repository ?? '', application.branch, application.compose_path),
    enabled: composeOpen && Boolean(repository),
  })
  const composeServices = applicationComposeServices(application)
  const save = useMutation({
    mutationFn: () => {
      validateServiceForm(form)
      return updateApplication(application.id, serviceInput(form, application))
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteApplication(application.id),
    onSuccess: onDeleted,
  })

  function update(change: Partial<ServiceForm>) {
    setForm((current) => ({ ...current, ...change }))
  }

  return (
    <div className="space-y-5 p-6">
      <form className="space-y-5" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
        <SettingsSection title="Source" description="The repository and compose target that produce this service.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Service name" value={form.name} onChange={(name) => update({ name })} required />
            <TextInput label="Repository URL" value={form.repository_url} onChange={(repository_url) => update({ repository_url })} placeholder="https://github.com/org/repo.git" />
            <TextInput label="Branch" value={form.branch} onChange={(branch) => update({ branch })} required />
            <TextInput label="Compose path" value={form.compose_path} onChange={(compose_path) => update({ compose_path })} required />
            <label className="sm:col-span-2 flex items-center justify-between gap-4 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5 text-[12px]">
              <span><span className="block font-medium text-prosights-text">Automatic deployments</span><span className="mt-0.5 block text-prosights-muted">Deploy matching GitHub pushes. Turn this off only to pause releases.</span></span>
              <input type="checkbox" checked={form.github_auto_deploy} onChange={(event) => update({ github_auto_deploy: event.target.checked })} className="size-4 accent-black" />
            </label>
          </div>
          <div className="mt-4 overflow-hidden rounded-prosights-md border border-prosights-border bg-prosights-surface-muted">
            <button type="button" aria-expanded={composeOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setComposeOpen((open) => !open)}>
              <FileCode2 className="size-4 shrink-0 text-prosights-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-prosights-text">Compose file</span><span className="block truncate font-mono text-[10px] text-prosights-muted">{application.compose_path} · {repository ? `${repository.repository}#${application.branch}` : 'GitHub not connected'}</span></span>
              <ChevronDown className={cn('size-4 shrink-0 text-prosights-muted transition-transform', composeOpen && 'rotate-180')} aria-hidden="true" />
            </button>
            {composeOpen && (
              <div className="border-t border-prosights-border">
                {!repository
                  ? <p className="p-3 text-[11px] text-prosights-muted">Connect this service to GitHub to view its Compose file.</p>
                  : composeFile.isPending
                    ? <div className="flex items-center gap-2 p-3 text-[11px] text-prosights-muted"><RefreshCw className="size-3.5 animate-spin" /> Loading Compose file…</div>
                    : composeFile.error
                      ? <div className="p-3"><InlineError message={composeFile.error.message} /></div>
                      : <pre aria-label="Compose file contents" className="max-h-[480px] overflow-auto bg-zinc-950 p-4 font-mono text-[11px] leading-5 text-zinc-300">{composeFile.data.content}</pre>}
              </div>
            )}
          </div>
        </SettingsSection>
        <SettingsSection title="Deploy" description="Where the compose stack runs and how blue-green releases are checked.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput label="Environment" value={form.environment_id} onChange={(environment_id) => update({ environment_id })}>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</SelectInput>
            <SelectInput label="Server" value={form.server_id} onChange={(server_id) => update({ server_id })} disabled>{servers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput>
            <div className="sm:col-span-2"><TextInput label="Remote directory" value={form.remote_directory} onChange={(remote_directory) => update({ remote_directory })} required /></div>
            <div className="sm:col-span-2"><TextInput label="Health check URL" value={form.health_check_url} onChange={(health_check_url) => update({ health_check_url })} placeholder="http://127.0.0.1:{port}/healthz?color={color}" /></div>
            <p className="text-[11px] text-prosights-muted">The server is fixed after creation. Recreate the service to move it.</p>
            <p className="sm:col-span-2 text-[11px] text-prosights-muted">Blue-green deploys require <span className="font-mono text-prosights-text">{'{color}'}</span>. Route targets supply the active color's host port during promotion.</p>
          </div>
        </SettingsSection>
        {composeServices.length > 0 && (
          <SettingsSection title="Compose stack" description="See each container's live host port and choose whether it follows both colors or only the active color.">
            <div className="divide-y divide-prosights-border overflow-hidden rounded-prosights-md border border-prosights-border">
              {composeServices.map((item) => {
                const serviceRoutes = routes.filter((route) => route.compose_service === item.name || (!route.compose_service && composeServices.length === 1))
                return (
                  <div key={item.name} className="bg-prosights-surface-muted p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-prosights-text">{item.name}</div><div className="mt-0.5 truncate font-mono text-[10px] text-prosights-muted">{item.image ?? item.dockerfile ?? 'compose build'}</div></div>
                      <div className="w-full shrink-0 sm:w-48">
                        <SelectInput
                          label="Run mode"
                          value={form.service_execution_modes[item.name] ?? 'follow_stack'}
                          onChange={(mode) => setForm((current) => ({ ...current, service_execution_modes: { ...current.service_execution_modes, [item.name]: mode as ExecutionMode } }))}
                        >
                          <option value="follow_stack">Follow stack</option>
                          <option value="singleton">Singleton</option>
                        </SelectInput>
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem label="Container port" value={composeContainerPorts(item, serviceRoutes)} />
                      <DetailItem label="Active host" value={activeServiceTargets(item, serviceRoutes)} />
                      <DetailItem label="Blue host" value={routeTargets(serviceRoutes, 'blue_upstream_url')} />
                      <DetailItem label="Green host" value={routeTargets(serviceRoutes, 'green_upstream_url')} />
                    </dl>
                    <div className="mt-3 flex flex-col gap-1 text-[10px] text-prosights-muted sm:flex-row sm:items-center sm:justify-between">
                      <ServiceRouteLinks routes={serviceRoutes} emptyLabel="No domain · private service" showServiceLabel={false} />
                      {(item.depends_on ?? []).length > 0 && <span>Depends on {(item.depends_on ?? []).join(', ')}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-prosights-muted">Use “Singleton” for schedulers, queue consumers, and monitoring workers that must have exactly one running copy across blue/green.</p>
          </SettingsSection>
        )}
        {save.error && <InlineError message={save.error.message} />}
        <div className="flex justify-end"><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</Button></div>
      </form>

      <ApplicationDomains application={application} />

      <SettingsSection title="Danger" description="Remove this service and its deployment history from the project.">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12px] text-prosights-muted">This does not delete the source repository.</p>
          <Button disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete ${application.name}?`)) remove.mutate() }}><Trash2 className="size-4" /> Delete service</Button>
        </div>
        {remove.error && <div className="mt-3"><InlineError message={remove.error.message} /></div>}
      </SettingsSection>
    </div>
  )
}

function applicationToServiceForm(application: Application): ServiceForm {
  const service_execution_modes = Object.fromEntries(applicationComposeServices(application).map((service) => [service.name, service.execution_mode ?? 'follow_stack']))
  return { environment_id: application.environment_id, server_id: application.server_id, name: application.name, repository_url: application.repository_url ?? '', branch: application.branch, compose_path: application.compose_path, remote_directory: application.remote_directory, health_check_url: application.health_check_url ?? '', github_auto_deploy: application.github_auto_deploy, service_execution_modes }
}

function serviceInput(form: ServiceForm, current: Application): UpdateApplicationInput {
  return { environment_id: form.environment_id, server_id: form.server_id, name: form.name.trim(), repository_url: optionalTrimmed(form.repository_url), branch: form.branch.trim() || 'main', compose_path: form.compose_path.trim() || 'docker-compose.yml', remote_directory: form.remote_directory.trim(), health_check_url: optionalTrimmed(form.health_check_url), domain: current.domain ?? undefined, doppler_project: current.doppler_project ?? undefined, doppler_config: current.doppler_config ?? undefined, github_auto_deploy: form.github_auto_deploy, service_execution_modes: form.service_execution_modes }
}

function validateServiceForm(form: ServiceForm): void {
  if (!form.environment_id || !form.server_id || !form.name.trim() || !form.remote_directory.trim()) throw new Error('Environment, server, service name, and remote directory are required.')
  validateRemoteDirectory(form.remote_directory)
  validateGitBranch(form.branch)
  validateComposePath(form.compose_path)
  validateRepositoryURL(form.repository_url)
  validateHealthCheckURL(form.health_check_url)
}
