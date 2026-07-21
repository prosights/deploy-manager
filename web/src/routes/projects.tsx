import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import { ArrowRight, FolderKanban, Layers3, Package, Plus, Rocket, Search, X } from 'lucide-react'
import { useEffect, useState } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
import { SelectInput } from '../components/ui/select-input'
import { TextInput } from '../components/ui/text-input'
import { statusTone } from '../features/status'
import {
  createProject,
  type Application,
  type CreateProjectInput,
  type Deployment,
  type Environment,
  type Project,
} from '../lib/api'
import { applicationsQuery, deploymentsQuery, environmentsQuery, projectsQuery } from '../lib/queries'

type ProjectForm = {
  name: string
  slug: string
  description: string
}

type ProjectStatus = 'empty' | 'failed' | 'deploying' | 'healthy' | 'idle'
type ProjectStatusFilter = 'all' | ProjectStatus

const defaultProjectForm: ProjectForm = { name: '', slug: '', description: '' }

export function ProjectsRoute() {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [
    { data: projects },
    { data: environments },
    { data: applications },
    { data: deployments },
  ] = useSuspenseQueries({
    queries: [projectsQuery, environmentsQuery, applicationsQuery, deploymentsQuery],
  })
  const [form, setForm] = useState<ProjectForm>(defaultProjectForm)
  const [formError, setFormError] = useState<string>()
  const [query, setQuery] = useState('')
  const [statusFilter, setStatusFilter] = useState<ProjectStatusFilter>('all')
  const [creating, setCreating] = useState(false)

  // Legacy URLs looked like /projects?project=<id>#section. Forward them to
  // the project page so old links and bookmarks keep working.
  useEffect(() => {
    const legacyProjectID = new URLSearchParams(window.location.search).get('project')
    if (legacyProjectID) {
      void navigate({
        to: '/projects/$projectId',
        params: { projectId: legacyProjectID },
        hash: window.location.hash.replace(/^#/, '') || undefined,
        replace: true,
      })
    }
  }, [navigate])

  const create = useMutation({
    mutationFn: () => createProject(projectInput(form)),
    onSuccess: async (project) => {
      setForm(defaultProjectForm)
      setFormError(undefined)
      setCreating(false)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }),
      ])
      void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
    },
  })

  const closeCreateProject = () => {
    setCreating(false)
    setForm(defaultProjectForm)
    setFormError(undefined)
    create.reset()
  }

  const visibleProjects = projects.filter((project) => {
    const status = projectStatus(applications.filter((application) => application.project_id === project.id))
    return matchesProjectSearch(project, query)
      && (statusFilter === 'all' || status === statusFilter)
  })

  return (
    <div className="space-y-4">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-prosights-muted focus-within:ring-2 focus-within:ring-prosights-ring sm:max-w-sm">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            aria-label="Search projects"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-prosights-text outline-none placeholder:text-prosights-subtle"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Search projects"
          />
        </label>
        <SelectInput
          label="Filter projects by status"
          labelHidden
          className="w-40"
          value={statusFilter}
          onChange={(value) => setStatusFilter(value as ProjectStatusFilter)}
        >
          <option value="all">All statuses</option>
          <option value="healthy">Healthy</option>
          <option value="deploying">Deploying</option>
          <option value="failed">Failed</option>
          <option value="idle">Idle</option>
          <option value="empty">Empty</option>
        </SelectInput>
        <DialogPrimitive.Root
          open={creating}
          onOpenChange={(open) => {
            if (open) setCreating(true)
            else closeCreateProject()
          }}
        >
          <DialogPrimitive.Trigger asChild>
            <Button type="button" variant="primary" className="ml-auto">
              <Plus className="size-4" aria-hidden="true" />
              Create project
            </Button>
          </DialogPrimitive.Trigger>
          <DialogPrimitive.Portal>
            <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/60 data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out" />
            <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 w-[calc(100%-2rem)] max-w-[28rem] -translate-x-1/2 -translate-y-1/2 overflow-hidden rounded-prosights-xl border border-prosights-border bg-prosights-surface shadow-prosights-float outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out">
              <div className="px-6 pb-3 pt-6 pr-14">
                <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.01em] text-prosights-text">
                  Create project
                </DialogPrimitive.Title>
                <DialogPrimitive.Description className="mt-1 text-[13px] leading-5 text-prosights-muted">
                  Create the project first, then connect its repository and services.
                </DialogPrimitive.Description>
              </div>
              <DialogPrimitive.Close asChild>
                <button
                  type="button"
                  aria-label="Close create project"
                  className="absolute right-5 top-5 inline-flex size-7 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prosights-ring"
                >
                  <X className="size-4" aria-hidden="true" />
                </button>
              </DialogPrimitive.Close>
              <NewProjectForm
                form={form}
                isSaving={create.isPending}
                errorMessage={formError ?? create.error?.message}
                onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
                onCancel={closeCreateProject}
                onSubmit={() => {
                  setFormError(undefined)
                  try {
                    validateProjectForm(form)
                  } catch (error) {
                    setFormError(error instanceof Error ? error.message : 'Project is invalid.')
                    return
                  }
                  create.mutate()
                }}
              />
            </DialogPrimitive.Content>
          </DialogPrimitive.Portal>
        </DialogPrimitive.Root>
      </div>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {visibleProjects.map((project) => (
          <ProjectTile key={project.id} project={project} environments={environments.filter((environment) => environment.project_id === project.id)} applications={applications.filter((application) => application.project_id === project.id)} deployments={projectDeployments(project.id, applications, deployments)} />
        ))}
        {projects.length > 0 && visibleProjects.length === 0 && (
          <div className="rounded-lg border border-dashed bg-surface px-4 py-10 text-center text-sm text-muted sm:col-span-2 xl:col-span-3">
            No projects match these filters.
          </div>
        )}
      </div>
      {projects.length === 0 && (
        <Panel>
          <div className="flex items-start gap-3 p-5 text-sm text-muted">
            <FolderKanban className="mt-0.5 size-4 shrink-0" aria-hidden="true" />
            <p className="max-w-2xl leading-6">
              Create your first project above, then open it to connect a GitHub repository, pick the branch to deploy,
              and choose which services inside that repository run on your servers.
            </p>
          </div>
        </Panel>
      )}
    </div>
  )
}

function ProjectTile({
  project,
  environments,
  applications,
  deployments,
}: {
  project: Project
  environments: Environment[]
  applications: Application[]
  deployments: Deployment[]
}) {
  const status = projectStatus(applications)
  const lastDeployment = newestDeployment(deployments)
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      aria-label={`Open project ${project.name}`}
      className="group flex min-h-44 flex-col rounded-lg border bg-surface p-4 text-left transition-colors hover:border-prosights-subtle hover:bg-prosights-surface-muted focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
    >
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h2 className="truncate text-base font-semibold text-ink">{project.name}</h2>
            <Badge tone={statusTone(status)}>{status}</Badge>
          </div>
          <div className="mt-0.5 truncate text-xs text-muted">{project.slug}</div>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-muted transition-transform group-hover:translate-x-0.5 group-hover:text-accent-text" aria-hidden="true" />
      </div>
      <p className="mt-2 line-clamp-2 text-sm leading-5 text-muted">
        {project.description || 'No description yet.'}
      </p>
      <div className="mt-auto space-y-2 pt-3">
        <div className="flex items-center gap-4 text-xs text-muted">
          <span className="inline-flex items-center gap-1.5">
            <Package className="size-3.5" aria-hidden="true" />
            {applications.length} service{applications.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex items-center gap-1.5">
            <Layers3 className="size-3.5" aria-hidden="true" />
            {environments.length} env{environments.length === 1 ? '' : 's'}
          </span>
          <span className="inline-flex min-w-0 items-center gap-1.5">
            <Rocket className="size-3.5 shrink-0" aria-hidden="true" />
            <span className="truncate">{lastDeployment ? `last deploy ${deploymentAge(lastDeployment)}` : 'never deployed'}</span>
          </span>
        </div>
      </div>
    </Link>
  )
}

function NewProjectForm({
  form,
  isSaving,
  errorMessage,
  onChange,
  onCancel,
  onSubmit,
}: {
  form: ProjectForm
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ProjectForm>) => void
  onCancel: () => void
  onSubmit: () => void
}) {
  return (
    <form
      className="space-y-5 px-6 pb-5 pt-3"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <TextInput
        label="Project name"
        value={form.name}
        onChange={(name) => onChange({ name, slug: slugify(name) })}
        required
        placeholder="recreate"
      />
      {errorMessage && <InlineError message={errorMessage} />}
      <div className="flex items-center justify-end gap-2 border-t border-prosights-border pt-4">
        <Button type="button" onClick={onCancel}>Cancel</Button>
        <Button variant="primary" disabled={isSaving || !form.name || !form.slug}>
          {isSaving ? 'Creating...' : 'Create'}
        </Button>
      </div>
    </form>
  )
}

function projectStatus(applications: Application[]): ProjectStatus {
  if (applications.length === 0) return 'empty'
  if (applications.some((application) => application.status === 'failed')) return 'failed'
  if (applications.some((application) => application.status === 'deploying')) return 'deploying'
  if (applications.every((application) => application.status === 'healthy')) return 'healthy'
  return 'idle'
}

function matchesProjectSearch(project: Project, query: string): boolean {
  const value = query.trim().toLowerCase()
  if (!value) return true
  return [project.name, project.slug, project.description]
    .some((field) => field?.toLowerCase().includes(value))
}

function projectDeployments(projectID: string, applications: Application[], deployments: Deployment[]): Deployment[] {
  const applicationIDs = new Set(applications.filter((application) => application.project_id === projectID).map((application) => application.id))
  return deployments.filter((deployment) => applicationIDs.has(deployment.application_id))
}

function newestDeployment(deployments: Deployment[]): Deployment | undefined {
  return deployments.reduce<Deployment | undefined>((newest, deployment) => (
    !newest || Date.parse(deployment.created_at) > Date.parse(newest.created_at) ? deployment : newest
  ), undefined)
}

function deploymentAge(deployment: Deployment): string {
  const timestamp = Date.parse(deployment.created_at)
  if (Number.isNaN(timestamp)) return 'recently'
  const minutes = Math.max(0, Math.floor((Date.now() - timestamp) / 60000))
  if (minutes < 1) return 'just now'
  if (minutes < 60) return `${minutes}m ago`
  const hours = Math.floor(minutes / 60)
  if (hours < 24) return `${hours}h ago`
  return `${Math.floor(hours / 24)}d ago`
}

function projectInput(form: ProjectForm): CreateProjectInput {
  return { name: form.name.trim(), slug: slugify(form.slug), description: form.description.trim() }
}

function validateProjectForm(form: ProjectForm): void {
  if (!form.name.trim() || !form.slug.trim()) {
    throw new Error('Project name and slug are required.')
  }
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slugify(form.slug))) {
    throw new Error('Slug must use lowercase letters, numbers, and hyphens.')
  }
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
}
