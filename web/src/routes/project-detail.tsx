import { useSuspenseQuery } from '@tanstack/react-query'
import { getRouteApi, Link, useNavigate } from '@tanstack/react-router'
import { ArrowLeft, Plus } from 'lucide-react'
import { useState, type ReactNode } from 'react'
import { Button } from '../components/ui/button'
import { SelectInput } from '../components/ui/select-input'
import type { Project } from '../lib/api'
import { applicationsQuery, environmentsQuery, projectsQuery } from '../lib/queries'
import type { ProjectSearch } from '../lib/route-search'
import { ApplicationDrawer } from '../features/applications/drawer'
import { environmentOrder } from '../features/applications/helpers'
import { ProjectCanvas } from '../features/projects/canvas'
import { AddServiceDialog } from '../features/projects/import-dialog'
import { ServicePortsDialog } from '../features/projects/ports-dialog'
import { ProjectSettingsDialog } from '../features/projects/settings-dialog'

const route = getRouteApi('/app/projects/$projectId')

export function ProjectDetailRoute(): ReactNode {
  const { projectId } = route.useParams()
  const { data: project } = useSuspenseQuery({ ...projectsQuery, select: (projects) => projects.find((item) => item.id === projectId) })

  if (!project) {
    return (
      <div className="p-6">
        <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface p-6">
          <h1 className="text-lg font-semibold text-prosights-text">Project not found</h1>
          <Link to="/projects" className="mt-4 inline-flex items-center gap-2 text-sm text-prosights-muted hover:text-prosights-text">
            <ArrowLeft className="size-4" /> Back to projects
          </Link>
        </div>
      </div>
    )
  }

  return <ProjectWorkspace key={project.id} project={project} />
}

function ProjectWorkspace({ project }: { project: Project }) {
  const search = route.useSearch()
  const navigate = useNavigate({ from: '/projects/$projectId' })
  const { data: environments } = useSuspenseQuery({
    ...environmentsQuery,
    select: (items) => environmentOrder(items.filter((environment) => environment.project_id === project.id)),
  })
  const { data: serviceEnvironmentID } = useSuspenseQuery({
    ...applicationsQuery,
    select: (applications) => applications.find((application) => application.id === search.service)?.environment_id,
  })
  const [createOpen, setCreateOpen] = useState(false)
  // The URL wins; otherwise show the open service's environment, then production.
  const environment = environments.find((item) => item.id === search.environment)
    ?? environments.find((item) => item.id === serviceEnvironmentID)
    ?? environments.find((item) => item.kind === 'production')
    ?? environments[0]
  const environmentID = environment?.id ?? ''

  function updateSearch(next: ProjectSearch) {
    void navigate({ search: (prev) => ({ ...prev, ...next }), replace: true })
  }

  return (
    <div className="flex h-full min-h-[640px] flex-col overflow-hidden bg-prosights-canvas">
      <header className="flex h-[60px] shrink-0 items-center justify-between gap-4 border-b border-prosights-border bg-prosights-surface px-4 sm:px-5">
        <div className="flex min-w-0 items-center gap-2">
          <Link
            to="/projects"
            aria-label="Back to projects"
            className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text"
          >
            <ArrowLeft className="size-4" aria-hidden="true" />
          </Link>
          <span className="max-w-48 truncate text-[14px] font-semibold text-prosights-text">{project.name}</span>
          <span className="text-prosights-subtle">/</span>
          <SelectInput
            label="Environment"
            labelHidden
            className="w-44"
            value={environmentID}
            onChange={(id) => updateSearch({ environment: id, service: undefined, deployment: undefined, view: undefined })}
          >
            {environments.map((item) => (
              <option key={item.id} value={item.id}>{item.name}</option>
            ))}
          </SelectInput>
        </div>
        <div className="flex items-center gap-2">
          <ServicePortsDialog environmentID={environmentID} />
          <ProjectSettingsDialog project={project} />
          <Button type="button" variant="primary" className="h-8" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add service
          </Button>
        </div>
      </header>

      <ProjectCanvas
        projectID={project.id}
        environmentID={environmentID}
        environmentName={environment?.name}
        onOpen={(application) => updateSearch({ environment: application.environment_id, service: application.id, deployment: undefined, view: undefined })}
        onAdd={() => setCreateOpen(true)}
      />

      <AddServiceDialog projectID={project.id} defaultEnvironmentID={environmentID} open={createOpen} onOpenChange={setCreateOpen} />

      {search.service && (
        <ApplicationDrawer
          key={search.service}
          search={{ service: search.service, deployment: search.deployment, view: search.view }}
          onNavigate={updateSearch}
        />
      )}
    </div>
  )
}
