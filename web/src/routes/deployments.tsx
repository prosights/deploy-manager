import { useQuery, useSuspenseQueries } from '@tanstack/react-query'
import { getRouteApi, useNavigate } from '@tanstack/react-router'
import { ArrowRight, GitCommitHorizontal, Github, Rocket, Search } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Panel } from '../components/ui/panel'
import { SelectInput } from '../components/ui/select-input'
import { statusTone } from '../features/status'
import type { Application, Deployment, GitHubCommitMetadata, GitHubRepository } from '../lib/api'
import { applicationsQuery, deploymentsQuery, githubCommitQuery, githubRepositoriesQuery, projectsQuery } from '../lib/queries'
import type { DeploymentsSearch } from '../lib/route-search'
import { ApplicationDrawer } from '../features/applications/drawer'
import { githubRepositoryForApplication, newestFirst } from '../features/applications/helpers'
import { deploymentTitle, formatFullTime, formatRelativeTime, shortImageRef } from '../lib/format'

const PAGE_SIZE = 10

const routeApi = getRouteApi('/app/deployments')

export function DeploymentsRoute() {
  const [{ data: deployments }, { data: applications }, { data: projects }, { data: githubRepositories }] = useSuspenseQueries({
    queries: [deploymentsQuery, applicationsQuery, projectsQuery, githubRepositoriesQuery],
  })
  const search = routeApi.useSearch()
  const navigate = useNavigate({ from: '/deployments' })
  const [query, setQuery] = useState('')
  const [selectedServiceID, setSelectedServiceID] = useState('')
  const [page, setPage] = useState(1)
  const selectedProjectID = projects.some((project) => project.id === search.project) ? search.project ?? '' : ''
  const applicationsByID = new Map(applications.map((application) => [application.id, application]))
  const projectNamesByID = new Map(projects.map((project) => [project.id, project.name]))
  const deploymentsInProject = deployments.filter((deployment) => !selectedProjectID || deploymentProjectID(deployment, applicationsByID) === selectedProjectID)
  const serviceOptions = deploymentServiceOptions(deploymentsInProject, applicationsByID, projectNamesByID)
  const visibleDeployments = newestFirst(deploymentsInProject.filter((deployment) => (!selectedServiceID || deployment.application_id === selectedServiceID) && matchesDeploymentSearch(deployment, query)))
  const pageCount = Math.max(1, Math.ceil(visibleDeployments.length / PAGE_SIZE))
  const currentPage = Math.min(page, pageCount)
  const pageDeployments = visibleDeployments.slice((currentPage - 1) * PAGE_SIZE, currentPage * PAGE_SIZE)

  function updateSearch(next: DeploymentsSearch) {
    void navigate({ search: (previous: DeploymentsSearch) => ({ ...previous, ...next }), replace: true })
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
            updateSearch({ project: projectID || undefined, service: undefined, deployment: undefined, view: undefined })
            setSelectedServiceID('')
            setPage(1)
          }}
        >
          <option value="">All projects</option>
          {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
        </SelectInput>
      </div>

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
              {pageDeployments.map((deployment) => {
                const application = applicationsByID.get(deployment.application_id)
                const projectID = deploymentProjectID(deployment, applicationsByID)
                return (
                  <DeploymentRow
                    key={deployment.id}
                    deployment={deployment}
                    repository={application ? githubRepositoryForApplication(application, githubRepositories) : undefined}
                    projectName={deployment.project_name ?? (projectID ? projectNamesByID.get(projectID) : undefined) ?? '—'}
                    serviceName={deployment.application_name ?? application?.name ?? '—'}
                    onOpen={() => updateSearch({ service: deployment.application_id, deployment: deployment.id, view: undefined })}
                  />
                )
              })}
            </tbody>
          </table>
        </div>
        {pageDeployments.length === 0 && (
          <div className="border-t border-prosights-border px-4 py-8 text-center text-[12px] text-prosights-muted">
            {query || selectedServiceID ? 'No deployments match these filters.' : 'No deployments yet. Open a service inside a project to deploy it.'}
          </div>
        )}
      </Panel>

      {visibleDeployments.length > 0 && (
        <Pagination page={currentPage} pageCount={pageCount} total={visibleDeployments.length} onPageChange={setPage} />
      )}

      {search.service && (
        <ApplicationDrawer
          search={{ service: search.service, deployment: search.deployment, view: search.view }}
          onNavigate={updateSearch}
        />
      )}
    </div>
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
  const { data: commitMetadata } = useQuery({
    ...githubCommitQuery(repository?.connector_id ?? '', repository?.repository ?? '', deployment.commit_sha ?? ''),
    enabled: Boolean(repository && deployment.commit_sha),
  })
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

function deploymentProjectID(deployment: Deployment, applicationsByID: Map<string, Application>): string | undefined {
  return deployment.project_id ?? applicationsByID.get(deployment.application_id)?.project_id
}

function deploymentServiceOptions(
  deployments: Deployment[],
  applicationByID: Map<string, Application>,
  projectByID: Map<string, string>,
): Array<{ id: string, label: string }> {
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

function triggerLabel(trigger: Deployment['trigger']): string {
  if (trigger === 'github_push') return 'via GitHub'
  if (trigger === 'connector_sync') return 'via connector'
  return trigger.replaceAll('_', ' ')
}
