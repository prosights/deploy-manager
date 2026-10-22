import { useSuspenseQuery } from '@tanstack/react-query'
import { Check, CircleAlert, Container, ExternalLink, Hammer, RefreshCw } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { SelectInput } from '../../components/ui/select-input'
import type { Application, BuildRun, ComposeService, Deployment, DeploymentLog, ProxyRoute } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatFullTime } from '../../lib/format'
import { buildRunsQuery, proxyRoutesQuery } from '../../lib/queries'
import type { DeploymentTab } from '../../lib/route-search'
import { DeploymentLogStream, useDeploymentLogs } from '../deployments/logs'
import { statusTone } from '../status'
import { applicationComposeServices, deploymentConfigurationSnapshot, deploymentDurationSeconds, forApplication, formatSeconds, repositoryDisplayName, type SnapshotServiceConfig } from './helpers'
import { DetailItem, ServiceRouteLinks } from './parts'

export function DeploymentDetail({
  application,
  deployment,
  tab,
  onSelectTab,
}: {
  application: Application
  deployment: Deployment
  tab: DeploymentTab
  onSelectTab: (tab: DeploymentTab) => void
}) {
  const { data: buildRuns } = useSuspenseQuery({ ...buildRunsQuery, select: forApplication(application.id) })
  const { data: routes } = useSuspenseQuery({ ...proxyRoutesQuery, select: forApplication(application.id) })
  const { logs, live } = useDeploymentLogs(deployment.id)
  const [logService, setLogService] = useState('all')
  const { buildLogs, deployLogs } = splitDeploymentLogs(logs)
  const buildRun = buildRunForDeployment(deployment, buildRuns)
  const snapshot = deploymentConfigurationSnapshot(deployment)
  const composeServices = snapshot.configuration_state?.application?.compose_services ?? applicationComposeServices(application)
  const serviceConfigs = snapshot.configuration_state?.service_runtime_configs ?? []
  const selectedLogService = logService === 'all' || composeServices.some((service) => service.name === logService) ? logService : 'all'

  if (tab === 'build-logs') {
    const visibleLogs = filterDeploymentLogsByService(buildLogs, selectedLogService)
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-6">
        <DeploymentLogScope services={composeServices} value={selectedLogService} onChange={setLogService} />
        {visibleLogs.length > 0
          ? <DeploymentLogStream deployment={deployment} logs={visibleLogs} live={live} className="flex-1 rounded-prosights-lg border border-prosights-border" />
          : (
              <EmptyLogState
                icon={Hammer}
                title={selectedLogService === 'all' ? (buildRun ? 'Build logs live in GitHub Actions' : 'No separate build logs') : `No build output for ${selectedLogService}`}
                description={selectedLogService === 'all' && buildRun ? 'Paddock records the build result and artifact. Open the workflow for the full build output.' : 'This service used a prebuilt image, or the runner did not emit service-tagged build output.'}
                action={buildRun?.external_url ? <Button asChild><a href={buildRun.external_url} target="_blank" rel="noreferrer">Open GitHub Actions <ExternalLink className="size-4" /></a></Button> : undefined}
              />
            )}
      </div>
    )
  }

  if (tab === 'deploy-logs') {
    const visibleLogs = filterDeploymentLogsByService(deployLogs, selectedLogService)
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-6">
        <DeploymentLogScope services={composeServices} value={selectedLogService} onChange={setLogService} />
        {visibleLogs.length > 0
          ? <DeploymentLogStream deployment={deployment} logs={visibleLogs} live={live} className="flex-1 rounded-prosights-lg border border-prosights-border" />
          : <EmptyLogState icon={Container} title={`No deploy output for ${selectedLogService}`} description="The runner did not emit any Docker Compose lines tagged with this service." />}
      </div>
    )
  }

  const durationSeconds = deploymentDurationSeconds(deployment)
  return (
    <div className="space-y-5 p-7">
      <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="flex items-center gap-3 p-4">
          <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border', deployment.status === 'succeeded' ? 'border-success/30 bg-success/10 text-success' : deployment.status === 'failed' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-warning/30 bg-warning/10 text-warning')}>
            {deployment.status === 'succeeded' ? <Check className="size-4" /> : deployment.status === 'failed' ? <CircleAlert className="size-4" /> : <RefreshCw className="size-4 animate-spin" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold text-prosights-text">{deploymentStatusMessage(deployment.status)}</h2><Badge tone={statusTone(deployment.status)}>{deployment.status}</Badge></div>
            <p className="mt-1 text-[11px] text-prosights-muted">Started {formatFullTime(deployment.created_at)} · {durationSeconds === undefined ? 'not started' : formatSeconds(durationSeconds)}</p>
          </div>
        </div>
      </section>

      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3"><h2 className="text-[13px] font-semibold text-prosights-text">Source</h2></div>
        <div className="grid gap-4 p-4 text-[12px] sm:grid-cols-2">
          <DetailItem label="Deployed via" value={deployment.trigger.replaceAll('_', ' ')} />
          <DetailItem label="Repository" value={`${repositoryDisplayName(deployment.source_repository_url ?? snapshot.repository_url ?? application.repository_url)}#${deployment.source_branch ?? snapshot.branch ?? application.branch}`} />
          <DetailItem label="Commit" value={deployment.commit_sha ?? 'not pinned'} />
          <DetailItem label="Actor" value={deployment.actor ?? 'system'} />
        </div>
      </section>

      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-prosights-text">Compose services</h2>
          <p className="mt-1 text-[11px] text-prosights-muted">Build, runtime, and route configuration captured for this release.</p>
        </div>
        {composeServices.length > 0
          ? (
              <div className="divide-y divide-prosights-border">
                {composeServices.map((service) => (
                  <DeploymentServiceConfiguration
                    key={service.name}
                    service={service}
                    runtimeConfig={serviceConfigs.find((config) => config.compose_service === service.name)}
                    routes={routes.filter((route) => route.compose_service === service.name)}
                    snapshotRecorded={Boolean(snapshot.configuration_state)}
                  />
                ))}
              </div>
            )
          : <div className="p-4 text-[12px] text-prosights-muted">No Compose service metadata was recorded.</div>}
      </section>

      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-prosights-text">Configuration</h2>
        </div>
        <div className="divide-y divide-prosights-border">
          <div className="grid gap-4 p-4 text-[12px] sm:grid-cols-2">
            <DetailItem label="Build" value={buildRun ? `${buildRun.provider.replaceAll('_', ' ')} · ${buildRun.status}` : deployment.image_ref ? 'prebuilt image' : 'built on target'} />
            <DetailItem label="Image" value={deployment.image_ref ?? 'built from source'} />
            <DetailItem label="Digest" value={deployment.image_digest ?? 'not pinned'} />
            <DetailItem label="Compose path" value={snapshot.compose_path ?? application.compose_path} />
          </div>
          <div className="grid gap-4 p-4 text-[12px] sm:grid-cols-2">
            <DetailItem label="Server" value={application.server_name} />
            <DetailItem label="Environment" value={application.environment_name} />
            <DetailItem label="Strategy" value={deployment.strategy.replaceAll('_', ' ')} />
            <DetailItem label="Health check" value={snapshot.health_check_url ?? application.health_check_url ?? 'not configured'} />
          </div>
          <div className="grid gap-4 p-4 text-[12px] sm:grid-cols-2">
            <DetailItem label="Service config revision" value={String(snapshot.application_revision ?? 'not recorded')} />
            <DetailItem label="Project config revision" value={String(snapshot.project_revision ?? 'not recorded')} />
            <DetailItem label="Stack Doppler (legacy)" value={snapshot.doppler_project && snapshot.doppler_config ? `${snapshot.doppler_project}/${snapshot.doppler_config}` : 'not configured'} />
          </div>
        </div>
      </section>

      <div className="flex flex-wrap items-center justify-between gap-3 px-1 text-[11px] text-prosights-muted">
        <span>Deployment ID <span className="font-mono text-prosights-text">{deployment.id}</span></span>
        <div className="flex gap-2"><Button onClick={() => onSelectTab('build-logs')}>Build logs</Button><Button onClick={() => onSelectTab('deploy-logs')}>Deploy logs</Button></div>
      </div>
    </div>
  )
}

function DeploymentLogScope({ services, value, onChange }: { services: ComposeService[], value: string, onChange: (value: string) => void }) {
  return (
    <div className="flex shrink-0 flex-col gap-2 rounded-prosights-lg border border-prosights-border bg-prosights-surface px-3 py-2.5 sm:flex-row sm:items-center sm:justify-between">
      <div>
        <div className="text-[12px] font-semibold text-prosights-text">Compose output</div>
        <p className="mt-0.5 text-[11px] text-prosights-muted">Inspect the whole stack or isolate lines tagged by Docker and BuildKit for one service.</p>
      </div>
      <SelectInput label="Log service" labelHidden value={value} onChange={onChange} className="w-full shrink-0 sm:w-52">
        <option value="all">All services</option>
        {services.map((service) => <option key={service.name} value={service.name}>{service.name}</option>)}
      </SelectInput>
    </div>
  )
}

function DeploymentServiceConfiguration({
  service,
  runtimeConfig,
  routes,
  snapshotRecorded,
}: {
  service: ComposeService
  runtimeConfig?: SnapshotServiceConfig
  routes: ProxyRoute[]
  snapshotRecorded: boolean
}) {
  const ports = service.ports?.map((port) => {
    const published = port.published_port ? `${port.published_port}:` : ''
    const variable = port.variable ? ` (${port.variable})` : ''
    return `${published}${port.container_port}/${port.protocol ?? 'tcp'}${variable}`
  }).join(', ') || 'none exposed'
  const variables = runtimeConfig?.variables ?? []

  return (
    <article className="p-4">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div className="flex items-center gap-2">
          <div className="flex size-7 items-center justify-center rounded-prosights-md bg-prosights-surface-muted text-prosights-muted"><Container className="size-3.5" /></div>
          <h3 className="font-mono text-[13px] font-semibold text-prosights-text">{service.name}</h3>
        </div>
        <ServiceRouteLinks routes={routes} emptyLabel="Private only" showServiceLabel={false} />
      </div>
      <dl className="mt-3 grid gap-4 text-[11px] sm:grid-cols-2">
        <DetailItem label="Build source" value={serviceBuildSource(service)} />
        <DetailItem label="Ports" value={ports} />
        <DetailItem label="Depends on" value={service.depends_on?.join(', ') || 'none'} />
        <DetailItem label="Doppler" value={runtimeConfig?.doppler_project && runtimeConfig.doppler_config ? `${runtimeConfig.doppler_project}/${runtimeConfig.doppler_config}` : 'not connected'} />
      </dl>
      <details className="mt-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5">
        <summary className="cursor-pointer text-[11px] font-medium text-prosights-text">Environment variables</summary>
        {variables.length > 0
          ? <div className="mt-2 space-y-1 font-mono text-[11px] text-prosights-text">{variables.map((variable) => <div key={variable.key} className="break-all"><span className="font-semibold">{variable.key}</span>=<span>{variable.value}</span></div>)}</div>
          : <p className="mt-2 text-[11px] text-prosights-muted">{snapshotRecorded ? 'No additional variables for this service.' : 'Not recorded for this older deployment.'}</p>}
      </details>
    </article>
  )
}

function EmptyLogState({ icon: Icon, title, description, action }: { icon: typeof Hammer, title: string, description: string, action?: ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-prosights-lg border border-prosights-border bg-prosights-surface p-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-prosights-md bg-prosights-surface-muted text-prosights-muted"><Icon className="size-5" /></div>
      <h2 className="mt-4 text-[14px] font-semibold text-prosights-text">{title}</h2>
      <p className="mt-1 max-w-md text-[12px] leading-5 text-prosights-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function serviceBuildSource(service: ComposeService): string {
  if (service.image) return service.image
  if (service.dockerfile) return service.dockerfile
  return service.build_context && service.build_context !== '.' ? service.build_context : 'Compose default'
}

function deploymentStatusMessage(status: Deployment['status']): string {
  if (status === 'succeeded') return 'Deployment successful'
  if (status === 'failed') return 'Deployment failed'
  if (status === 'cancelled') return 'Deployment cancelled'
  if (status === 'queued') return 'Deployment queued'
  return 'Deployment in progress'
}

// Docker Compose and BuildKit tag lines with the service name; BuildKit also
// numbers steps (#12) and only names the service on the step's first line.
function filterDeploymentLogsByService(logs: DeploymentLog[], composeService: string): DeploymentLog[] {
  if (composeService === 'all') return logs
  const servicePattern = new RegExp(`(^|[^A-Za-z0-9])${escapeRegExp(composeService)}([^A-Za-z0-9]|$)`, 'i')
  const buildSteps = new Set<string>()
  return logs.flatMap((entry) => entry.message.replaceAll('\r\n', '\n').split('\n').flatMap((message) => {
    const buildStage = message.match(/^#(\d+)\s+\[([^\s\]]+)/)
    if (buildStage?.[2]?.toLowerCase() === composeService.toLowerCase()) buildSteps.add(buildStage[1])
    const buildStep = message.match(/^#(\d+)\b/)
    if (!servicePattern.test(message) && (!buildStep || !buildSteps.has(buildStep[1]))) return []
    return [{ ...entry, message }]
  }))
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// The runner logs system lines that mark when it moves between build and deploy.
function splitDeploymentLogs(logs: DeploymentLog[]): { buildLogs: DeploymentLog[], deployLogs: DeploymentLog[] } {
  const buildLogs: DeploymentLog[] = []
  const deployLogs: DeploymentLog[] = []
  let phase: 'build' | 'deploy' = 'deploy'
  for (const entry of logs) {
    if (entry.stream === 'system') {
      if (/^(Syncing repository|Validating compose config|Building (compose|next color) images)$/.test(entry.message)) phase = 'build'
      if (/^(Starting (compose|next color) stack|Checking next color health|Promoting next color|Applying proxy route|Deployment completed)/.test(entry.message)) phase = 'deploy'
    }
    if (phase === 'build') buildLogs.push(entry)
    else deployLogs.push(entry)
  }
  return { buildLogs, deployLogs }
}

function buildRunForDeployment(deployment: Deployment, builds: BuildRun[]): BuildRun | undefined {
  const buildID = deployment.actor?.startsWith('build:') ? deployment.actor.slice('build:'.length) : ''
  return builds.find((build) => build.id === buildID)
}
