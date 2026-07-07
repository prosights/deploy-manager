import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Link, useNavigate } from '@tanstack/react-router'
import { ArrowRight, FolderKanban, GitBranch, Layers3, Package, Plus, Rocket } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
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
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }),
      ])
      void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
    },
  })

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="A project is one product boundary: a GitHub repository, its environments, and every service deployed from it."
      />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {projects.map((project) => (
          <ProjectTile
            key={project.id}
            project={project}
            environments={environments.filter((environment) => environment.project_id === project.id)}
            applications={applications.filter((application) => application.project_id === project.id)}
            deployments={deployments.filter((deployment) => deployment.project_id === project.id)}
          />
        ))}
        <NewProjectTile
          form={form}
          isSaving={create.isPending}
          errorMessage={formError ?? create.error?.message}
          onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
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
  const lastDeployment = deployments[0]
  return (
    <Link
      to="/projects/$projectId"
      params={{ projectId: project.id }}
      aria-label={`Open project ${project.name}`}
      className="group flex min-h-44 flex-col rounded-lg border bg-surface p-4 text-left transition-colors hover:border-accent/60 hover:bg-panel focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
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
        <div className="flex min-w-0 items-center gap-2 text-xs text-muted">
          <GitBranch className="size-3.5 shrink-0" aria-hidden="true" />
          <span className="truncate font-mono">
            {project.repository_full_name
              ? `${project.repository_full_name}#${project.repository_branch ?? 'main'}`
              : 'no repository connected'}
          </span>
        </div>
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

function NewProjectTile({
  form,
  isSaving,
  errorMessage,
  onChange,
  onSubmit,
}: {
  form: ProjectForm
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ProjectForm>) => void
  onSubmit: () => void
}) {
  return (
    <form
      className="flex min-h-44 flex-col justify-between rounded-lg border border-dashed bg-background p-4"
      onSubmit={(event) => {
        event.preventDefault()
        onSubmit()
      }}
    >
      <div>
        <div className="flex items-center gap-2 text-sm font-medium text-ink">
          <Plus className="size-4" aria-hidden="true" />
          New project
        </div>
        <p className="mt-1 text-xs leading-5 text-muted">
          One project per product. Connect its repository and deploy services inside it.
        </p>
      </div>
      <div className="space-y-3 pt-3">
        <TextInput
          label="Project name"
          value={form.name}
          onChange={(name) => onChange({ name, slug: slugify(name) })}
          required
          placeholder="recreate"
        />
        <Button variant="primary" disabled={isSaving || !form.name || !form.slug}>
          {isSaving ? 'Creating...' : 'Create project'}
        </Button>
        {errorMessage && <InlineError message={errorMessage} />}
      </div>
    </form>
  )
}

function projectStatus(applications: Application[]): string {
  if (applications.length === 0) return 'empty'
  if (applications.some((application) => application.status === 'failed')) return 'failed'
  if (applications.some((application) => application.status === 'deploying')) return 'deploying'
  if (applications.every((application) => application.status === 'healthy')) return 'healthy'
  return 'idle'
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
