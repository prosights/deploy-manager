import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Check, CircleAlert, Ellipsis, ExternalLink, Github, Globe2, Hammer, History, Play, RefreshCw, RotateCcw, Server, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { InlineError } from '../../components/ui/error-message'
import {
  cancelDeployment,
  createDeployment,
  dispatchGitHubBuild,
  retryDeployment,
  rollbackApplication,
  type Application,
  type BuildRun,
  type Deployment,
  type GitHubCommitMetadata,
  type GitHubRepository,
} from '../../lib/api'
import { cn } from '../../lib/cn'
import { deploymentTitle, formatRelativeTime } from '../../lib/format'
import { buildRunsQuery, deploymentSlotsQuery, deploymentsQuery, githubCommitQuery, githubRepositoriesQuery, projectsQuery, proxyRoutesQuery } from '../../lib/queries'
import type { DeploymentTab } from '../../lib/route-search'
import { statusTone } from '../status'
import { activeDeploymentID, deploymentConfigurationSnapshot, forApplication, githubRepositoryForApplication, newestFirst, repositoryDisplayName } from './helpers'
import { ServiceRouteLinks } from './parts'

const historyPageSize = 10

export function DeploymentsTab({
  application,
  onOpenDeployment,
  onOpenSettings,
}: {
  application: Application
  onOpenDeployment: (deploymentID: string, view?: DeploymentTab) => void
  onOpenSettings: () => void
}) {
  const [historyPage, setHistoryPage] = useState(1)
  const { data: deployments } = useSuspenseQuery({ ...deploymentsQuery, select: forApplication(application.id) })
  const { data: buildRuns } = useSuspenseQuery({ ...buildRunsQuery, select: forApplication(application.id) })
  const { data: routes } = useSuspenseQuery({ ...proxyRoutesQuery, select: forApplication(application.id) })
  const { data: repository } = useSuspenseQuery({ ...githubRepositoriesQuery, select: (repositories) => githubRepositoryForApplication(application, repositories) })
  const { data: projectRevision } = useSuspenseQuery({ ...projectsQuery, select: (projects) => projects.find((project) => project.id === application.project_id)?.configuration_revision ?? 0 })
  const { data: slots = [] } = useQuery(deploymentSlotsQuery(application.id))
  const orderedDeployments = newestFirst(deployments)
  const latestArtifact = orderedDeployments.find((deployment) => Boolean(deployment.image_ref))
  const activeBuilds = newestFirst(buildRuns).filter((build) => build.status === 'dispatched' || build.status === 'running')
  const inFlightDeployments = orderedDeployments.filter((deployment) => deployment.status === 'queued' || deployment.status === 'running')
  const activeID = activeDeploymentID(slots, deployments)
  const activeDeployment = orderedDeployments.find((deployment) => deployment.id === activeID)
  const visibleDeploymentIDs = new Set([...inFlightDeployments.map((deployment) => deployment.id), activeDeployment?.id].filter(Boolean))
  const history = orderedDeployments.filter((deployment) => !visibleDeploymentIDs.has(deployment.id))
  const historyPageCount = Math.max(1, Math.ceil(history.length / historyPageSize))
  const currentHistoryPage = Math.min(historyPage, historyPageCount)
  const historyPageItems = history.slice((currentHistoryPage - 1) * historyPageSize, currentHistoryPage * historyPageSize)
  const useGitHubBuild = Boolean(repository?.workflow_id && repository.image_ref && application.github_auto_deploy)
  const hasSource = Boolean(useGitHubBuild || (application.repository_url && application.compose_path) || latestArtifact?.image_ref)
  const hasHealthCheck = Boolean(application.health_check_url?.includes('{color}'))
  const ready = hasSource && hasHealthCheck
  const busy = activeBuilds.length > 0 || inFlightDeployments.length > 0
  const pendingChanges = applicationPendingChanges(application, projectRevision, activeDeployment)
  const latestVersion = application.target_version || application.current_version
  const latestDiffers = Boolean(application.current_version && application.target_version && application.current_version !== application.target_version)
  const deploy = useMutation({
    mutationFn: async (): Promise<unknown> => {
      if (useGitHubBuild && repository) {
        return await dispatchGitHubBuild(repository.connector_id, {
          repository: repository.repository,
          application_id: repository.application_id || application.id,
          branch: application.branch,
        })
      }
      return await createDeployment({
        application_id: application.id,
        trigger: 'manual',
        strategy: 'blue_green',
        image_ref: latestArtifact?.image_ref ?? undefined,
        image_digest: latestArtifact?.image_digest ?? undefined,
        actor: 'manual',
      })
    },
  })

  return (
    <div className="space-y-6 p-7">
      <section className="flex flex-col gap-4 border-b border-prosights-border pb-6 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0 space-y-2 text-[12px] text-prosights-muted">
          <div className="flex min-w-0 flex-wrap items-center gap-x-5 gap-y-2">
            <span className="inline-flex min-w-0 items-center gap-1.5"><Github className="size-3.5 shrink-0" /><span className="truncate">{repositoryDisplayName(application.repository_url)}#{application.branch}</span></span>
            <span className="inline-flex items-center gap-1.5"><Server className="size-3.5" />{application.server_name}</span>
            <span className="inline-flex items-center gap-1.5"><span className={cn('size-2 rounded-full', application.status === 'healthy' ? 'bg-success' : application.status === 'failed' ? 'bg-danger' : 'bg-prosights-subtle')} />{application.status === 'healthy' ? 'Online' : application.status}</span>
          </div>
          <div className="flex min-w-0 items-start gap-1.5">
            <Globe2 className="mt-0.5 size-3.5 shrink-0" />
            <ServiceRouteLinks routes={routes} fallbackDomain={application.domain} stacked />
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {(application.current_version || latestVersion) && (
            <div className="grid gap-0.5 text-right text-[11px] leading-4 text-prosights-muted">
              {application.current_version && <span>Current <span className="font-mono">{shortVersion(application.current_version)}</span></span>}
              {latestVersion && <span className={latestDiffers ? 'text-warning' : undefined}>Latest <span className="font-mono">{shortVersion(latestVersion)}</span></span>}
            </div>
          )}
          <Button type="button" variant="primary" disabled={!ready || busy || deploy.isPending} onClick={() => deploy.mutate()}>
            {deploy.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
            {deploy.isPending ? 'Starting…' : 'Deploy latest'}
          </Button>
        </div>
      </section>

      {pendingChanges.length > 0 && (
        <PendingChangesBanner changes={pendingChanges} disabled={!ready || busy} pending={deploy.isPending} onDeploy={() => deploy.mutate()} />
      )}

      {!ready && (
        <button type="button" className="flex w-full items-center justify-between gap-3 rounded-prosights-lg border border-prosights-border bg-prosights-surface px-4 py-3 text-left text-[12px] text-prosights-muted transition-colors hover:border-prosights-subtle hover:text-prosights-text" onClick={onOpenSettings}>
          <span className="inline-flex items-center gap-2">
            <CircleAlert className="size-4 text-warning" />
            {!hasSource ? 'Connect a repository or deployable image before deploying.' : 'Add a health check containing {color} and {port} before deploying.'}
          </span>
          <span className="font-medium text-prosights-text">Open settings</span>
        </button>
      )}
      {deploy.error && <InlineError message={deploy.error.message} />}

      {activeBuilds.map((build) => (
        <article key={build.id} className="overflow-hidden rounded-prosights-lg border border-warning/40 bg-prosights-surface">
          <div className="flex items-center gap-3 px-4 py-4">
            <div className="flex size-9 items-center justify-center rounded-prosights-md bg-warning/10 text-warning"><Hammer className="size-4 animate-pulse" /></div>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2"><Badge tone="warning">BUILDING</Badge><span className="text-[13px] font-medium text-prosights-text">New deployment</span></div>
              <div className="mt-1 truncate font-mono text-[11px] text-prosights-muted">{build.repository}#{build.branch}</div>
            </div>
            {(build.external_url || build.provider === 'github_actions') && <Button asChild><a href={build.external_url || githubActionsWorkflowURL(build)} target="_blank" rel="noreferrer">View build <ExternalLink className="size-4" /></a></Button>}
          </div>
          <div className="flex items-center gap-2 border-t border-warning/20 bg-warning/5 px-4 py-2.5 text-[11px] font-medium text-warning"><RefreshCw className="size-3.5 animate-spin" />Build {build.status}</div>
        </article>
      ))}

      {inFlightDeployments.map((item) => (
        <DeploymentReleaseCard key={item.id} applicationID={application.id} deployment={item} repository={repository} onOpen={onOpenDeployment} />
      ))}

      {activeDeployment && (
        <DeploymentReleaseCard applicationID={application.id} deployment={activeDeployment} repository={repository} active onOpen={onOpenDeployment} />
      )}

      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h2 className="text-[11px] font-semibold tracking-[0.14em] text-prosights-muted">HISTORY</h2>
          <span className="text-[11px] text-prosights-subtle">{history.length} release{history.length === 1 ? '' : 's'}</span>
        </div>
        {history.length > 0
          ? (
              <div className="space-y-2">
                {historyPageItems.map((item) => (
                  <DeploymentReleaseCard key={item.id} applicationID={application.id} deployment={item} repository={repository} compact onOpen={onOpenDeployment} />
                ))}
                {historyPageCount > 1 && (
                  <div className="flex items-center justify-end gap-2 pt-2">
                    <Button type="button" disabled={currentHistoryPage === 1} onClick={() => setHistoryPage(currentHistoryPage - 1)}>Previous</Button>
                    <span className="min-w-16 text-center text-[11px] tabular-nums text-prosights-muted">{currentHistoryPage} of {historyPageCount}</span>
                    <Button type="button" disabled={currentHistoryPage === historyPageCount} onClick={() => setHistoryPage(currentHistoryPage + 1)}>Next</Button>
                  </div>
                )}
              </div>
            )
          : <div className="rounded-prosights-lg border border-dashed border-prosights-border bg-prosights-surface px-4 py-10 text-center text-[13px] text-prosights-muted">No previous deployments yet.</div>}
      </section>
    </div>
  )
}

// Restart, redeploy, cancel, and roll back one deployment.
export function DeploymentActionsMenu({ applicationID, deployment }: { applicationID: string, deployment: Deployment }) {
  const { data: slots = [] } = useQuery(deploymentSlotsQuery(applicationID))
  const slot = slots.find((item) => item.deployment_id === deployment.id)
  const hasStandby = slots.some((item) => item.status === 'standby')
  const inFlight = deployment.status === 'queued' || deployment.status === 'running'
  const pinnedImageRef = deployment.image_ref ?? slot?.image_ref
  const pinnedImageDigest = deployment.image_digest ?? slot?.image_digest
  const restart = useMutation({
    mutationFn: () => createDeployment({
      application_id: applicationID,
      trigger: 'manual',
      strategy: 'blue_green',
      commit_sha: deployment.commit_sha ?? undefined,
      image_ref: pinnedImageRef ?? undefined,
      image_digest: pinnedImageDigest ?? undefined,
      actor: 'restart',
    }),
  })
  const redeploy = useMutation({
    mutationFn: () => deployment.status === 'failed' || deployment.status === 'cancelled'
      ? retryDeployment(deployment.id)
      : createDeployment({
          application_id: applicationID,
          trigger: 'manual',
          strategy: 'blue_green',
          commit_sha: deployment.commit_sha ?? undefined,
          image_ref: deployment.image_ref ?? undefined,
          image_digest: deployment.image_digest ?? undefined,
          actor: 'redeploy',
        }),
  })
  const cancel = useMutation({ mutationFn: () => cancelDeployment(deployment.id) })
  const rollback = useMutation({ mutationFn: () => rollbackApplication(applicationID) })
  const error = restart.error ?? redeploy.error ?? cancel.error ?? rollback.error
  const busy = restart.isPending || redeploy.isPending || cancel.isPending || rollback.isPending

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" className="size-8" aria-label="Deployment actions" disabled={busy}>
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Ellipsis className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        <DropdownMenuItem className="cursor-pointer" disabled={inFlight || !pinnedImageRef} onSelect={() => restart.mutate()}>
          <RefreshCw className="size-4" /> Restart
        </DropdownMenuItem>
        <DropdownMenuItem className="cursor-pointer" disabled={inFlight} onSelect={() => redeploy.mutate()}>
          <RotateCcw className="size-4" /> Redeploy
        </DropdownMenuItem>
        {deployment.status === 'queued' && (
          <DropdownMenuItem className="cursor-pointer" onSelect={() => cancel.mutate()}>
            <X className="size-4" /> Cancel
          </DropdownMenuItem>
        )}
        {hasStandby && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem className="cursor-pointer" onSelect={() => rollback.mutate()}>
              <History className="size-4" /> Roll back
            </DropdownMenuItem>
          </>
        )}
        {error && (
          <>
            <DropdownMenuSeparator />
            <DropdownMenuItem disabled className="text-[11px] leading-4 text-prosights-muted">{error.message}</DropdownMenuItem>
          </>
        )}
      </DropdownMenuContent>
    </DropdownMenu>
  )
}

function PendingChangesBanner({ changes, disabled, pending, onDeploy }: { changes: string[], disabled: boolean, pending: boolean, onDeploy: () => void }) {
  const [detailsOpen, setDetailsOpen] = useState(false)
  return (
    <section className="overflow-hidden rounded-prosights-lg border border-warning/40 bg-warning/5">
      <div className="flex flex-col gap-3 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-center gap-2.5 text-[12px] font-semibold text-prosights-text">
          <CircleAlert className="size-4 shrink-0 text-warning" />
          {changes.length} pending change{changes.length === 1 ? '' : 's'}
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" onClick={() => setDetailsOpen((open) => !open)}>{detailsOpen ? 'Hide details' : 'Details'}</Button>
          <Button type="button" variant="primary" disabled={disabled || pending} onClick={onDeploy}>{pending ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}{pending ? 'Starting…' : 'Deploy changes'}</Button>
        </div>
      </div>
      {detailsOpen && (
        <ul className="border-t border-warning/20 px-4 py-3 text-[11px] leading-5 text-prosights-muted">
          {changes.map((change) => <li key={change} className="flex gap-2"><span className="text-warning">•</span><span>{change}</span></li>)}
        </ul>
      )}
    </section>
  )
}

function DeploymentReleaseCard({
  applicationID,
  deployment,
  repository,
  active = false,
  compact = false,
  onOpen,
}: {
  applicationID: string
  deployment: Deployment
  repository?: GitHubRepository
  active?: boolean
  compact?: boolean
  onOpen: (deploymentID: string, view?: DeploymentTab) => void
}) {
  const inFlight = deployment.status === 'queued' || deployment.status === 'running'
  const status = active ? 'ACTIVE' : deployment.status === 'running' ? 'DEPLOYING' : deployment.status.toUpperCase()
  const tone = active ? 'success' : statusTone(deployment.status)
  const { data: commitMetadata } = useQuery({
    ...githubCommitQuery(repository?.connector_id ?? '', repository?.repository ?? '', deployment.commit_sha ?? ''),
    enabled: Boolean(repository && deployment.commit_sha),
  })

  return (
    <article className={cn('overflow-hidden rounded-prosights-lg border bg-prosights-surface transition-[border-color,box-shadow] hover:border-prosights-subtle hover:shadow-sm', inFlight ? 'border-warning/40' : 'border-prosights-border')}>
      <div className={cn('flex items-center gap-3', compact ? 'px-3 py-3' : 'px-4 py-4')}>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 bg-transparent text-left" aria-label={`Open deployment ${deployment.id.slice(0, 8)}`} onClick={() => onOpen(deployment.id)}>
          <DeploymentSourceIcon deployment={deployment} metadata={commitMetadata} inFlight={inFlight} compact={compact} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Badge tone={tone}>{status}</Badge>
              <span className="truncate text-[13px] font-semibold text-prosights-text">{deploymentTitle(deployment, commitMetadata?.message)}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-prosights-muted">{formatRelativeTime(deployment.created_at)} via {deployment.trigger.replaceAll('_', ' ')} · <span className="font-mono">{deployment.id.slice(0, 8)}</span></p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={() => onOpen(deployment.id, 'deploy-logs')}>View logs</Button>
          <DeploymentActionsMenu applicationID={applicationID} deployment={deployment} />
        </div>
      </div>
      {!compact && (active || inFlight) && (
        <div className={cn('flex items-center gap-2 border-t px-4 py-2.5 text-[11px] font-medium', active ? 'border-success/20 bg-success/5 text-success' : 'border-warning/20 bg-warning/5 text-warning')}>
          {active ? <Check className="size-3.5" /> : <RefreshCw className="size-3.5 animate-spin" />}
          {active ? 'Deployment successful' : deployment.status === 'queued' ? 'Waiting for the deployment runner' : 'Deployment in progress'}
        </div>
      )}
    </article>
  )
}

function DeploymentSourceIcon({ deployment, metadata, inFlight, compact }: { deployment: Deployment, metadata?: GitHubCommitMetadata, inFlight: boolean, compact: boolean }) {
  const identity = metadata?.author_login || metadata?.author_name || deployment.trigger.replaceAll('_', ' ')
  return (
    <div className={cn('relative flex shrink-0 items-center justify-center rounded-full border border-prosights-border bg-prosights-surface-muted text-prosights-muted', compact ? 'size-8' : 'size-9')} title={identity}>
      {inFlight
        ? <RefreshCw className="size-4 animate-spin text-warning" />
        : metadata?.author_avatar_url
          ? <img src={metadata.author_avatar_url} alt="" className="size-full rounded-full object-cover" />
          : deployment.commit_sha
            ? <Github className="size-4" aria-hidden="true" />
            : <Play className="size-4" />}
      {deployment.trigger === 'github_push' && (
        <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-prosights-text text-prosights-surface ring-2 ring-prosights-surface">
          <Github className="size-3" aria-hidden="true" />
        </span>
      )}
    </div>
  )
}

function applicationPendingChanges(application: Application, projectRevision: number, activeDeployment?: Deployment): string[] {
  if (!activeDeployment) return ['Service imported and ready for its first deployment.']
  if (!application.redeploy_required) return []
  const snapshot = deploymentConfigurationSnapshot(activeDeployment)
  const changes: string[] = []
  if (application.configuration_revision > application.deployed_configuration_revision) changes.push(`Service settings changed (revision ${application.deployed_configuration_revision} → ${application.configuration_revision}).`)
  if (projectRevision > application.deployed_project_configuration_revision) changes.push(`Shared project variables changed (revision ${application.deployed_project_configuration_revision} → ${projectRevision}).`)
  if (snapshot.repository_url !== undefined && snapshot.repository_url !== application.repository_url) changes.push('Source repository changed.')
  if (snapshot.branch !== undefined && snapshot.branch !== application.branch) changes.push(`Branch changed from ${snapshot.branch} to ${application.branch}.`)
  if (snapshot.compose_path !== undefined && snapshot.compose_path !== application.compose_path) changes.push(`Compose path changed from ${snapshot.compose_path} to ${application.compose_path}.`)
  if (changes.length === 0) changes.push('Runtime configuration changed after the active deployment.')
  return [...new Set(changes)]
}

function githubActionsWorkflowURL(build: BuildRun): string {
  return `https://github.com/${build.repository}/actions/workflows/${encodeURIComponent(build.workflow_id)}`
}

function shortVersion(value: string | null): string {
  return value ? value.slice(0, 12) : 'pending'
}
