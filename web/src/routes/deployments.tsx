import { useQuery, useSuspenseQueries } from '@tanstack/react-query'
import { ArrowRight, GitCommitHorizontal, Github, Rocket, Search } from 'lucide-react'
import { useMemo, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Panel } from '../components/ui/panel'
import { SelectInput } from '../components/ui/select-input'
import { statusTone } from '../features/status'
import type { Deployment, GitHubCommitMetadata, GitHubRepository } from '../lib/api'
import { applicationsQuery, buildRunsQuery, deploymentsQuery, githubCommitQuery, githubRepositoriesQuery, projectsQuery, proxyRoutesQuery } from '../lib/queries'
import { ApplicationDrawer } from './project-detail'

const PAGE_SIZE = 10

export function DeploymentsRoute() {
  const [{ data: deployments }, { data: applications }, { data: projects }, { data: githubRepositories }] = useSuspenseQueries({
    queries: [deploymentsQuery, applicationsQuery, projectsQuery, githubRepositoriesQuery],
  })
  const [scopeSearch, setScopeSearch] = useState(window.location.search)
  const [query, setQuery] = useState('')
  const [selectedServiceID, setSelectedServiceID] = useState('')
  const [page, setPage] = useState(1)
  const selectedDeploymentID = validDeploymentID(deploymentIDFromSearch(scopeSearch), deployments)
  const selectedDeployment = deployments.find((deployment) => deployment.id === selectedDeploymentID)
  const selectedApplication = applications.find((application) => application.id === selectedDeployment?.application_id)
  const selectedProjectID = validProjectID(projectIDFromSearch(scopeSearch, selectedDeploymentID), projects)
  const applicationProjectIDs = useMemo(
    () => new Map(applications.map((application) => [application.id, application.project_id])),
    [applications],
  )
  const applicationsByID = useMemo(
    () => new Map(applications.map((application) => [application.id, application])),
    [applications],
  )
  const projectNamesByID = useMemo(
    () => new Map(projects.map((project) => [project.id, project.name])),
    [projects],
  )
  const githubRepositoriesByApplicationID = useMemo(
    () => new Map(applications.flatMap((application) => {
      const repository = githubRepositoryForApplication(application, githubRepositories)
      return repository ? [[application.id, repository] as const] : []
    })),
    [applications, githubRepositories],
  )
  const deploymentsInProject = useMemo(
    () => deployments.filter((deployment) => {
      if (!selectedProjectID) return true
      return deploymentProjectID(deployment, applicationProjectIDs) === selectedProjectID
    }),
    [applicationProjectIDs, deployments, selectedProjectID],
  )
  const serviceOptions = useMemo(
    () => deploymentServiceOptions(deploymentsInProject, applications, projects),
    [applications, deploymentsInProject, projects],
  )
  const visibleDeployments = useMemo(
    () => newestFirst(deploymentsInProject.filter((deployment) => {
      return (!selectedServiceID || deployment.application_id === selectedServiceID)
        && matchesDeploymentSearch(deployment, query)
    })),
    [deploymentsInProject, query, selectedServiceID],
  )
  const pageCount = Math.max(1, Math.ceil(visibleDeployments.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageDeployments = visibleDeployments.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)
  const drawerProjectID = selectedDeployment ? deploymentProjectID(selectedDeployment, applicationProjectIDs) : undefined
  const drawerProject = projects.find((project) => project.id === drawerProjectID)
  const { data: buildRuns = [] } = useQuery({ ...buildRunsQuery, enabled: Boolean(selectedDeployment) })
  const { data: proxyRoutes = [] } = useQuery({ ...proxyRoutesQuery, enabled: Boolean(selectedDeployment) })

  function closeDeployment() {
    setScopeSearch(replaceDeploymentURL())
  }

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-prosights-muted focus-within:ring-2 focus-within:ring-prosights-ring sm:max-w-sm">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search deployments"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-prosights-text outline-none placeholder:text-prosights-subtle"
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setPage(1)
            }}
            placeholder="Search deployments"
          />
        </label>
        <SelectInput
          label="Service"
          labelHidden
          className="w-full sm:w-56"
          value={selectedServiceID}
          onChange={(serviceID) => {
            setSelectedServiceID(serviceID)
            setPage(1)
          }}
        >
          <option value="">All services</option>
          {serviceOptions.map((service) => <option key={service.id} value={service.id}>{service.label}</option>)}
        </SelectInput>
        <SelectInput
          label="Project"
          labelHidden
          className="w-full sm:w-56"
          value={selectedProjectID}
          onChange={(projectID) => {
            setScopeSearch(replaceProjectScopeURL(projectID))
            setSelectedServiceID('')
            setPage(1)
          }}
        >
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </SelectInput>
      </div>

      <DeploymentList
        deployments={pageDeployments}
        githubRepositoriesByApplicationID={githubRepositoriesByApplicationID}
        applicationsByID={applicationsByID}
        projectNamesByID={projectNamesByID}
        emptyMessage={query || selectedServiceID ? 'No deployments match these filters.' : 'No deployments yet. Open a service inside a project to deploy it.'}
        onOpen={(deploymentID) => setScopeSearch(replaceDeploymentURL(deploymentID))}
      />

      {visibleDeployments.length > 0 && (
        <Pagination
          page={currentPage}
          pageCount={pageCount}
          total={visibleDeployments.length}
          onPageChange={setPage}
        />
      )}

      {selectedDeployment && selectedApplication && drawerProjectID && (
        <ApplicationDrawer
          key={selectedDeployment.id}
          application={selectedApplication}
          deployment={selectedDeployment}
          deployments={deployments.filter((deployment) => deployment.application_id === selectedApplication.id)}
          buildRuns={buildRuns.filter((build) => build.application_id === selectedApplication.id)}
          repository={githubRepositoriesByApplicationID.get(selectedApplication.id)}
          routes={proxyRoutes.filter((route) => route.application_id === selectedApplication.id)}
          projectConfigurationRevision={drawerProject?.configuration_revision ?? 0}
          environments={[]}
          servers={[]}
          open
          onSelectDeployment={(deploymentID) => setScopeSearch(replaceDeploymentURL(deploymentID))}
          onBackToApplication={closeDeployment}
          onOpenChange={(open) => {
            if (!open) closeDeployment()
          }}
          projectHref={`/projects/${encodeURIComponent(drawerProjectID)}?service=${encodeURIComponent(selectedApplication.id)}`}
        />
      )}
    </div>
  )
}

function DeploymentList({
  deployments,
  githubRepositoriesByApplicationID,
  applicationsByID,
  projectNamesByID,
  emptyMessage,
  onOpen,
}: {
  deployments: Deployment[]
  githubRepositoriesByApplicationID: Map<string, GitHubRepository>
  applicationsByID: Map<string, { name: string, project_id: string }>
  projectNamesByID: Map<string, string>
  emptyMessage: string
  onOpen: (deploymentID: string) => void
}) {
  return (
    <Panel className="overflow-hidden">
      <div className="overflow-x-auto">
        <table className="w-full min-w-[1180px] table-fixed text-left text-[12px]">
          <colgroup>
            <col className="w-[110px]" />
            <col className="w-[320px]" />
            <col className="w-[180px]" />
            <col className="w-[125px]" />
            <col className="w-[135px]" />
            <col className="w-[145px]" />
            <col className="w-[130px]" />
            <col className="w-[48px]" />
          </colgroup>
          <thead className="text-[11px] text-prosights-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Commit</th>
              <th className="px-4 py-3 font-medium">Service / Project</th>
              <th className="px-4 py-3 font-medium">Strategy</th>
              <th className="px-4 py-3 font-medium">Trigger</th>
              <th className="px-4 py-3 font-medium">Deployed</th>
              <th className="px-4 py-3 font-medium">SHA</th>
              <th className="px-2 py-3"><span className="sr-only">Action</span></th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => {
              const application = applicationsByID.get(deployment.application_id)
              const projectID = deployment.project_id ?? application?.project_id
              return (
                <DeploymentRow
                  key={deployment.id}
                  deployment={deployment}
                  repository={githubRepositoriesByApplicationID.get(deployment.application_id)}
                  projectName={deployment.project_name ?? (projectID ? projectNamesByID.get(projectID) : undefined) ?? '—'}
                  serviceName={deployment.application_name ?? application?.name ?? '—'}
                  onOpen={() => onOpen(deployment.id)}
                />
              )
            })}
          </tbody>
        </table>
      </div>
      {deployments.length === 0 && <div className="border-t border-prosights-border px-4 py-8 text-center text-[12px] text-prosights-muted">{emptyMessage}</div>}
    </Panel>
  )
}

function DeploymentRow({
  deployment,
  repository,
  projectName,
  serviceName,
  onOpen,
}: {
  deployment: Deployment
  repository?: GitHubRepository
  projectName: string
  serviceName: string
  onOpen: () => void
}) {
  const { data: commitMetadata } = useQuery(githubCommitQuery(repository?.connector_id ?? '', repository?.repository ?? '', deployment.commit_sha ?? ''))
  const title = deploymentTitle(deployment, commitMetadata?.message)
  const deployedAt = deployment.finished_at ?? deployment.created_at

  return (
    <tr className="group cursor-pointer border-t border-prosights-border transition-colors hover:bg-prosights-surface-muted/60" onClick={onOpen}>
      <td className="px-4 py-3">
        <Badge tone={statusTone(deployment.status)} className="w-fit text-[10px] uppercase tracking-[0.06em]">{deployment.status}</Badge>
      </td>
      <td className="px-4 py-3">
        <div className="flex min-w-0 items-center gap-3">
          <SourceIdentity deployment={deployment} metadata={commitMetadata} />
          <p className="truncate text-[13px] font-semibold text-prosights-text" title={title}>{title}</p>
        </div>
      </td>
      <td className="px-4 py-3">
        <div className="truncate font-medium text-prosights-text">{serviceName}</div>
        <div className="mt-0.5 truncate text-[11px] text-prosights-muted">{projectName}</div>
      </td>
      <td className="px-4 py-3 capitalize text-prosights-muted">{deployment.strategy.replaceAll('_', '-')}</td>
      <td className="px-4 py-3 text-prosights-muted">{triggerLabel(deployment.trigger)}</td>
      <td className="px-4 py-3 text-prosights-muted">
        <time dateTime={deployedAt} title={formatFullTime(deployedAt)}>{formatRelativeTime(deployedAt)}</time>
      </td>
      <td className="px-4 py-3">
        <div className="flex items-center gap-1.5 text-[12px] text-prosights-text">
          <GitCommitHorizontal className="size-3.5 shrink-0 text-prosights-subtle" aria-hidden="true" />
          <span className="truncate font-mono">{deployment.commit_sha?.slice(0, 10) ?? shortImageRef(deployment.image_ref) ?? deployment.id.slice(0, 8)}</span>
        </div>
      </td>
      <td className="px-2 py-3 text-right">
        <button
          type="button"
          aria-label={`Open deployment ${deployment.id.slice(0, 8)}`}
          className="inline-flex size-8 items-center justify-center rounded-prosights-md text-prosights-subtle outline-none transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text focus-visible:ring-2 focus-visible:ring-prosights-ring"
          onClick={(event) => {
            event.stopPropagation()
            onOpen()
          }}
        >
          <ArrowRight className="size-4 transition-transform duration-150 group-hover:translate-x-0.5" aria-hidden="true" />
        </button>
      </td>
    </tr>
  )
}

function SourceIdentity({ deployment, metadata }: { deployment: Deployment, metadata?: GitHubCommitMetadata }) {
  const identity = metadata?.author_login || metadata?.author_name || triggerLabel(deployment.trigger)
  const githubSource = deployment.trigger === 'github_push' || Boolean(deployment.commit_sha)

  return (
    <div className="relative flex size-9 shrink-0 items-center justify-center rounded-full border border-prosights-border bg-prosights-surface-muted text-[11px] font-semibold uppercase text-prosights-muted" title={identity}>
      {metadata?.author_avatar_url
        ? <img src={metadata.author_avatar_url} alt="" className="size-full rounded-full object-cover" />
        : githubSource
          ? <Github className="size-4" aria-hidden="true" />
          : <Rocket className="size-4" aria-hidden="true" />}
      {metadata?.author_avatar_url && deployment.trigger === 'github_push' && (
        <span className="absolute -bottom-1 -right-1 flex size-4 items-center justify-center rounded-full bg-prosights-text text-prosights-surface ring-2 ring-prosights-surface">
          <Github className="size-3" aria-hidden="true" />
        </span>
      )}
    </div>
  )
}

function Pagination({
  page,
  pageCount,
  total,
  onPageChange,
}: {
  page: number
  pageCount: number
  total: number
  onPageChange: (page: number) => void
}) {
  const first = (page - 1) * PAGE_SIZE + 1
  const last = Math.min(page * PAGE_SIZE, total)

  return (
    <nav aria-label="Deployment pages" className="flex flex-wrap items-center justify-between gap-3 border-t border-prosights-border pt-4">
      <p className="text-[11px] tabular-nums text-prosights-muted">Showing {first}–{last} of {total}</p>
      <div className="flex items-center gap-2">
        <Button type="button" disabled={page === 1} onClick={() => onPageChange(page - 1)}>Previous</Button>
        <span className="min-w-16 text-center text-[11px] tabular-nums text-prosights-muted">{page} of {pageCount}</span>
        <Button type="button" disabled={page === pageCount} onClick={() => onPageChange(page + 1)}>Next</Button>
      </div>
    </nav>
  )
}

function deploymentIDFromSearch(search: string): string {
  return new URLSearchParams(search).get('deployment') ?? ''
}

function validDeploymentID(deploymentID: string, deployments: Array<{ id: string }>): string {
  return deployments.some((deployment) => deployment.id === deploymentID) ? deploymentID : ''
}

function projectIDFromSearch(search: string, selectedDeploymentID: string): string {
  const params = new URLSearchParams(search)
  return params.get('project') ?? (selectedDeploymentID ? '' : params.get('deployment')) ?? ''
}

function validProjectID(projectID: string, projects: Array<{ id: string }>): string {
  return projects.some((project) => project.id === projectID) ? projectID : ''
}

function replaceProjectScopeURL(projectID: string): string {
  const params = new URLSearchParams(window.location.search)
  params.delete('deployment')
  params.delete('service')
  params.delete('view')
  if (projectID) params.set('project', projectID)
  else params.delete('project')
  const search = params.toString()
  window.history.replaceState(null, '', search ? `/deployments?${search}` : '/deployments')
  return window.location.search
}

function replaceDeploymentURL(deploymentID?: string): string {
  const params = new URLSearchParams(window.location.search)
  params.delete('service')
  params.delete('view')
  if (deploymentID) params.set('deployment', deploymentID)
  else params.delete('deployment')
  const search = params.toString()
  window.history.replaceState(null, '', search ? `/deployments?${search}` : '/deployments')
  return window.location.search
}

function deploymentProjectID(deployment: Deployment, applicationProjectIDs: Map<string, string>): string | undefined {
  return deployment.project_id ?? applicationProjectIDs.get(deployment.application_id)
}

function newestFirst(deployments: Deployment[]): Deployment[] {
  return [...deployments].sort((left, right) => Date.parse(right.created_at) - Date.parse(left.created_at))
}

function deploymentServiceOptions(
  deployments: Deployment[],
  applications: Array<{ id: string, name: string, project_id: string }>,
  projects: Array<{ id: string, name: string }>,
): Array<{ id: string, label: string }> {
  const applicationByID = new Map(applications.map((application) => [application.id, application]))
  const projectByID = new Map(projects.map((project) => [project.id, project.name]))
  const deploymentByApplicationID = new Map(deployments.map((deployment) => [deployment.application_id, deployment]))
  const services = [...deploymentByApplicationID.entries()].map(([id, deployment]) => {
    const application = applicationByID.get(id)
    const name = application?.name ?? deployment.application_name ?? 'Service'
    const projectID = deployment.project_id ?? application?.project_id
    return { id, name, projectName: projectID ? projectByID.get(projectID) : undefined }
  })
  const nameCounts = new Map<string, number>()
  services.forEach((service) => nameCounts.set(service.name, (nameCounts.get(service.name) ?? 0) + 1))

  return services
    .map((service) => ({
      id: service.id,
      label: (nameCounts.get(service.name) ?? 0) > 1 && service.projectName
        ? `${service.name} · ${service.projectName}`
        : service.name,
    }))
    .sort((left, right) => left.label.localeCompare(right.label))
}

function matchesDeploymentSearch(deployment: Deployment, query: string): boolean {
  const normalizedQuery = query.trim().toLowerCase()
  if (!normalizedQuery) return true

  return [
    deploymentTitle(deployment),
    deployment.id,
    deployment.commit_sha,
    deployment.image_ref,
    deployment.actor,
    deployment.application_name,
    deployment.project_name,
    deployment.environment_name,
    deployment.server_name,
    deployment.status,
    triggerLabel(deployment.trigger),
  ].some((value) => value?.toLowerCase().includes(normalizedQuery))
}

function deploymentTitle(deployment: Deployment, fetchedMessage?: string): string {
  const fetchedSubject = commitSubject(fetchedMessage)
  if (fetchedSubject) return fetchedSubject
  const commitMessage = deployment.commit_message?.trim()
  if (commitMessage) return commitMessage
  if (deployment.commit_sha) return `Commit ${deployment.commit_sha.slice(0, 10)}`
  const imageRef = shortImageRef(deployment.image_ref)
  if (imageRef) return `Deploy ${imageRef}`
  return `Deployment ${deployment.id.slice(0, 8)}`
}

function commitSubject(message?: string): string {
  return message?.split(/\r?\n/, 1)[0]?.trim() ?? ''
}

function githubRepositoryForApplication(
  application: { id: string, repository_url: string | null },
  repositories: GitHubRepository[],
): GitHubRepository | undefined {
  return repositories.find((repository) => repository.application_id === application.id)
    ?? repositories.find((repository) => !repository.application_id && repository.clone_url === application.repository_url)
}

function shortImageRef(imageRef: string | null): string | undefined {
  if (!imageRef) return undefined
  const image = imageRef.split('/').at(-1)
  return image && image.length > 28 ? `…${image.slice(-27)}` : image
}

function triggerLabel(trigger: Deployment['trigger']): string {
  if (trigger === 'github_push') return 'via GitHub'
  if (trigger === 'connector_sync') return 'via connector'
  return trigger.replaceAll('_', ' ')
}

function formatRelativeTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'Recently'
  const seconds = Math.round((timestamp - Date.now()) / 1000)
  const absoluteSeconds = Math.abs(seconds)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absoluteSeconds < 60) return 'just now'
  if (absoluteSeconds < 3600) return formatter.format(Math.round(seconds / 60), 'minute')
  if (absoluteSeconds < 86_400) return formatter.format(Math.round(seconds / 3600), 'hour')
  if (absoluteSeconds < 604_800) return formatter.format(Math.round(seconds / 86_400), 'day')
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric' }).format(timestamp)
}

function formatFullTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return value
  return new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(timestamp)
}
