import { useMutation, useQuery } from '@tanstack/react-query'
import { CircleAlert, Container, Plus, RefreshCw, RotateCcw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { InlineError } from '../../components/ui/error-message'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import {
  redeployApplicationConfiguration,
  replaceApplicationServiceRuntimeConfig,
  type Application,
  type ApplicationServiceRuntimeConfig,
  type ComposeService,
  type ProjectRuntimeVariable,
} from '../../lib/api'
import { applicationServiceVariablesQuery, dopplerConfigsQuery, dopplerProjectsQuery } from '../../lib/queries'
import { validateDopplerScope } from '../../lib/validation'
import { applicationComposeServices, normalizeProjectRuntimeVariables } from './helpers'

// The runtime config row that applies to every service in the stack.
const stackRuntimeConfigName = '__stack__'

export function VariablesTab({ application }: { application: Application }) {
  const redeploy = useMutation({ mutationFn: () => redeployApplicationConfiguration(application.id) })

  return (
    <div className="space-y-5 p-6">
      {application.redeploy_required && (
        <section className="flex flex-col gap-3 rounded-prosights-lg border border-warning/40 bg-warning/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div><div className="text-[12px] font-semibold text-prosights-text">Redeploy required</div><p className="mt-0.5 text-[11px] leading-4 text-prosights-muted">Service variables changed after the active release. Redeploy the stack to apply them.</p></div>
          </div>
          <Button type="button" disabled={redeploy.isPending} onClick={() => redeploy.mutate()}>{redeploy.isPending ? <RefreshCw className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{redeploy.isPending ? 'Queuing…' : 'Redeploy'}</Button>
        </section>
      )}
      <ComposeServiceVariables application={application} />
      {redeploy.error && <InlineError message={redeploy.error.message} />}
    </div>
  )
}

function ComposeServiceVariables({ application }: { application: Application }) {
  const composeServices = applicationComposeServices(application)
  const [selectedService, setSelectedService] = useState<string>()
  const configs = useQuery(applicationServiceVariablesQuery(application.id))

  if (composeServices.length === 0) {
    return (
      <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4">
        <div className="text-[13px] font-semibold text-prosights-text">Service variables</div>
        <p className="mt-1 text-[11px] text-prosights-muted">Scan the repository first so Paddock can find the services in this Compose stack.</p>
      </section>
    )
  }
  if (configs.isPending) {
    return <section className="flex items-center gap-2 rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4 text-[12px] text-prosights-muted"><RefreshCw className="size-4 animate-spin" /> Loading service variables…</section>
  }
  if (configs.error) {
    return <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4"><InlineError message={configs.error.message} /></section>
  }

  const defaultService = defaultComposeServiceName(composeServices)
  // Until the user picks one, show the first service that already has Doppler connected.
  const configuredService = configs.data.find((item) => item.doppler_project && item.doppler_config && composeServices.some((service) => service.name === item.compose_service))?.compose_service
  const composeService = selectedService ?? configuredService ?? defaultService
  const config = configs.data.find((item) => item.compose_service === composeService)
    ?? legacyServiceConfig(application, composeService, defaultService)
  const stackConfig = configs.data.find((item) => item.compose_service === stackRuntimeConfigName)
  return (
    <>
      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-prosights-text">Stack shared variables</h2>
          <p className="mt-1 text-[11px] text-prosights-muted">Non-secret values injected into every Compose service in this stack.</p>
        </div>
        <div className="p-4"><ComposeServiceVariablesForm key={`stack:${stackConfig?.configuration_revision ?? 0}`} applicationID={application.id} composeService={stackRuntimeConfigName} config={stackConfig} stackWide /></div>
      </section>
      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3">
          <div className="flex items-center gap-2"><Container className="size-4 text-prosights-muted" /><h2 className="text-[13px] font-semibold text-prosights-text">Service variables</h2></div>
          <p className="mt-1 text-[11px] text-prosights-muted">Choose a service, connect its Doppler config, and add any non-secret overrides.</p>
        </div>
        <div className="space-y-4 p-4">
          <SelectInput label="Service" value={composeService} onChange={setSelectedService}>
            {composeServices.map((service) => <option key={service.name} value={service.name}>{service.name}</option>)}
          </SelectInput>
          <ComposeServiceVariablesForm key={`${composeService}:${config?.configuration_revision ?? 0}`} applicationID={application.id} composeService={composeService} config={config} />
        </div>
      </section>
    </>
  )
}

function ComposeServiceVariablesForm({ applicationID, composeService, config, stackWide = false }: { applicationID: string, composeService: string, config?: ApplicationServiceRuntimeConfig, stackWide?: boolean }) {
  const [dopplerProject, setDopplerProject] = useState(config?.doppler_project ?? '')
  const [dopplerConfig, setDopplerConfig] = useState(config?.doppler_config ?? '')
  const [variables, setVariables] = useState<ProjectRuntimeVariable[]>(() => config?.variables.map((variable) => ({ ...variable })) ?? [])
  const projects = useQuery(dopplerProjectsQuery)
  const configs = useQuery({ ...dopplerConfigsQuery(dopplerProject), enabled: Boolean(dopplerProject) })
  const projectOptions = [...new Set([...(projects.data ?? []), dopplerProject].filter(Boolean))]
  const configOptions = [...new Set([...(configs.data ?? []), dopplerConfig].filter(Boolean))]
  const save = useMutation({
    mutationFn: () => {
      validateDopplerScope(dopplerProject, dopplerConfig)
      return replaceApplicationServiceRuntimeConfig(applicationID, composeService, {
        doppler_project: dopplerProject.trim(),
        doppler_config: dopplerConfig.trim(),
        variables: normalizeProjectRuntimeVariables(variables),
      })
    },
  })

  function updateVariable(index: number, change: Partial<ProjectRuntimeVariable>) {
    setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, ...change } : item))
  }

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
      <div className="space-y-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3">
        <div><div className="text-[12px] font-semibold text-prosights-text">Doppler</div><p className="mt-0.5 text-[11px] text-prosights-muted">Secrets are fetched when this stack deploys and are sent {stackWide ? 'to every service in this stack' : `only to ${composeService}`}.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput label={stackWide ? 'Stack Doppler project' : 'Doppler project'} value={dopplerProject} disabled={projects.isPending} onChange={(project) => { setDopplerProject(project); setDopplerConfig('') }}>
            <option value="">Not connected</option>
            {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
          </SelectInput>
          <SelectInput label={stackWide ? 'Stack Doppler config' : 'Doppler config'} value={dopplerConfig} disabled={!dopplerProject || configs.isPending} onChange={setDopplerConfig}>
            <option value="">Select config</option>
            {configOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectInput>
        </div>
        {projects.error && <InlineError message="Doppler project list is unavailable. Existing saved Doppler scopes still apply." />}
        {configs.error && <InlineError message="Doppler config list is unavailable. Existing saved config still applies." />}
      </div>
      <div className="space-y-3">
        <div><div className="text-[12px] font-semibold text-prosights-text">{stackWide ? 'Shared variables' : 'Additional variables'}</div><p className="mt-0.5 text-[11px] text-prosights-muted">{stackWide ? 'Applied to every service in this stack, after project-shared values.' : `Applied only to ${composeService}, after project and stack-shared values.`}</p></div>
        {variables.map((variable, index) => (
          <div key={index} className="grid gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] sm:items-end">
            <TextInput label="Key" value={variable.key} onChange={(key) => updateVariable(index, { key })} placeholder="PUBLIC_API_URL" />
            <TextInput label="Value" value={variable.value} onChange={(value) => updateVariable(index, { value })} placeholder="https://api.example.com" />
            <Button type="button" size="icon" aria-label={`Remove ${stackWide ? 'stack' : composeService} variable ${variable.key || index + 1}`} onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        {variables.length === 0 && <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-5 text-center text-[12px] text-prosights-muted">No additional variables.</div>}
      </div>
      <div className="flex flex-col gap-3 border-t border-prosights-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-4 text-prosights-muted">Saving marks the Compose stack for redeployment.</p>
        <div className="flex gap-2"><Button type="button" onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}><Plus className="size-4" /> Add {stackWide ? 'stack' : 'service'} variable</Button><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : stackWide ? 'Save stack' : `Save ${composeService}`}</Button></div>
      </div>
      {save.error && <InlineError message={save.error.message} />}
    </form>
  )
}

function defaultComposeServiceName(services: ComposeService[]): string {
  return services.find((service) => !isInfrastructureComposeService(service.name) && (service.ports ?? []).length > 0)?.name
    ?? services.find((service) => !isInfrastructureComposeService(service.name))?.name
    ?? services[0]?.name
    ?? ''
}

// Services created before per-service variables kept one Doppler scope on the
// application; show it on the default service until that service is saved.
function legacyServiceConfig(application: Application, composeService: string, defaultService: string): ApplicationServiceRuntimeConfig | undefined {
  if (composeService !== defaultService || !application.doppler_project || !application.doppler_config) return undefined
  return {
    compose_service: composeService,
    doppler_project: application.doppler_project,
    doppler_config: application.doppler_config,
    variables: [],
    configuration_revision: application.configuration_revision ?? 0,
    changed: Boolean(application.redeploy_required),
  }
}

function isInfrastructureComposeService(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized.includes('cloud-sql')
    || normalized.includes('postgres')
    || normalized.includes('redis')
    || normalized === 'db'
    || normalized.endsWith('-db')
}
