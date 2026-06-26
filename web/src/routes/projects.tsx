import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { GitBranch, Globe2, Server, ShieldCheck } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
import { SelectInput } from '../components/ui/select-input'
import { TextInput } from '../components/ui/text-input'
import { createEnvironment, createProject, type Application, type CreateEnvironmentInput, type CreateProjectInput, type Environment, type Project } from '../lib/api'
import { applicationsQuery, environmentsQuery, projectsQuery } from '../lib/queries'
import { statusTone } from '../features/status'

type ProjectForm = {
  name: string
  slug: string
  description: string
}

type EnvironmentForm = {
  project_id: string
  name: string
  slug: string
  kind: 'production' | 'development' | 'preview'
  pull_request_number: string
  branch: string
}

export function ProjectsRoute() {
  const queryClient = useQueryClient()
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: environments } = useSuspenseQuery(environmentsQuery)
  const { data: applications } = useSuspenseQuery(applicationsQuery)
  const [projectForm, setProjectForm] = useState<ProjectForm>({ name: '', slug: '', description: '' })
  const [environmentForm, setEnvironmentForm] = useState<EnvironmentForm>(() => defaultEnvironmentForm(projects[0]?.id))
  const [projectError, setProjectError] = useState<string>()
  const [environmentError, setEnvironmentError] = useState<string>()

  const createProjectMutation = useMutation({
    mutationFn: () => createProject(projectInput(projectForm)),
    onSuccess: async (project) => {
      setProjectForm({ name: '', slug: '', description: '' })
      setProjectError(undefined)
      setEnvironmentForm(defaultEnvironmentForm(project.id))
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }),
      ])
    },
  })
  const createEnvironmentMutation = useMutation({
    mutationFn: () => createEnvironment(environmentInput(environmentForm)),
    onSuccess: async () => {
      setEnvironmentForm((state) => defaultEnvironmentForm(state.project_id))
      setEnvironmentError(undefined)
      await queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey })
    },
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Projects" description="Group applications by project and run production, development, or ephemeral PR environments." />
      <div className="grid gap-5 xl:grid-cols-[1fr_1.2fr]">
        <Panel title="Create project">
          <form
            className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              setProjectError(undefined)
              try {
                validateProjectForm(projectForm)
              } catch (error) {
                setProjectError(error instanceof Error ? error.message : 'Project is invalid.')
                return
              }
              createProjectMutation.mutate()
            }}
          >
            <TextInput label="Name" value={projectForm.name} onChange={(name) => setProjectForm((state) => ({ ...state, name, slug: state.slug || slugify(name) }))} required />
            <TextInput label="Slug" value={projectForm.slug} onChange={(slug) => setProjectForm((state) => ({ ...state, slug }))} required />
            <div className="flex items-end">
              <Button variant="primary" disabled={createProjectMutation.isPending || !projectForm.name || !projectForm.slug}>
                {createProjectMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <label className="flex flex-col gap-1 text-xs text-muted md:col-span-3">
              <span>Description</span>
              <textarea
                className="min-h-20 resize-y rounded-md border bg-background px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
                value={projectForm.description}
                onChange={(event) => setProjectForm((state) => ({ ...state, description: event.target.value }))}
              />
            </label>
          </form>
          {(projectError || createProjectMutation.error) && <div className="border-t px-4 py-3"><InlineError message={projectError ?? createProjectMutation.error?.message ?? 'Project could not be saved.'} /></div>}
        </Panel>
        <Panel title="Create environment">
          <form
            className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_1fr_auto]"
            onSubmit={(event) => {
              event.preventDefault()
              setEnvironmentError(undefined)
              try {
                validateEnvironmentForm(environmentForm)
              } catch (error) {
                setEnvironmentError(error instanceof Error ? error.message : 'Environment is invalid.')
                return
              }
              createEnvironmentMutation.mutate()
            }}
          >
            <SelectInput label="Project" value={environmentForm.project_id} onChange={(project_id) => setEnvironmentForm((state) => ({ ...state, project_id }))} required>
              <option value="" disabled>Select project</option>
              {projects.map((project) => <option key={project.id} value={project.id}>{project.name}</option>)}
            </SelectInput>
            <TextInput label="Name" value={environmentForm.name} onChange={(name) => setEnvironmentForm((state) => ({ ...state, name, slug: state.slug || slugify(name) }))} required />
            <TextInput label="Slug" value={environmentForm.slug} onChange={(slug) => setEnvironmentForm((state) => ({ ...state, slug }))} required />
            <div className="flex items-end">
              <Button variant="primary" disabled={createEnvironmentMutation.isPending || !environmentForm.project_id || !environmentForm.name || !environmentForm.slug}>
                {createEnvironmentMutation.isPending ? 'Saving...' : 'Save'}
              </Button>
            </div>
            <SelectInput label="Kind" value={environmentForm.kind} onChange={(kind) => setEnvironmentForm((state) => ({ ...state, kind: kind as EnvironmentForm['kind'] }))}>
              <option value="production">Production</option>
              <option value="development">Development</option>
              <option value="preview">PR preview</option>
            </SelectInput>
            <TextInput label="PR number" value={environmentForm.pull_request_number} onChange={(pull_request_number) => setEnvironmentForm((state) => ({ ...state, pull_request_number }))} placeholder="42" />
            <TextInput label="Branch" value={environmentForm.branch} onChange={(branch) => setEnvironmentForm((state) => ({ ...state, branch }))} placeholder="feature/api" />
          </form>
          <div className="border-t px-4 py-3 text-sm text-muted">Preview environments are ephemeral PR stacks for the whole compose target.</div>
          {(environmentError || createEnvironmentMutation.error) && <div className="border-t px-4 py-3"><InlineError message={environmentError ?? createEnvironmentMutation.error?.message ?? 'Environment could not be saved.'} /></div>}
        </Panel>
      </div>
      <ProjectCockpit projects={projects} environments={environments} applications={applications} />
    </div>
  )
}

function ProjectCockpit({ projects, environments, applications }: { projects: Project[], environments: Environment[], applications: Application[] }) {
  return (
    <div className="space-y-4">
      {projects.map((project) => {
        const projectEnvironments = environments.filter((environment) => environment.project_id === project.id)
        const projectApplications = applications.filter((application) => application.project_id === project.id)
        return (
          <Panel
            key={project.id}
            title={project.name}
            action={<div className="font-mono text-xs text-muted">{project.slug}</div>}
          >
            <div className="grid gap-0 lg:grid-cols-[280px_1fr]">
              <ProjectSummary project={project} environments={projectEnvironments} applications={projectApplications} />
              <EnvironmentBoard environments={projectEnvironments} applications={projectApplications} />
            </div>
          </Panel>
        )
      })}
      {projects.length === 0 && (
        <Panel>
          <div className="px-4 py-6 text-sm text-muted">Create a project to group environments, compose targets, deployments, and credentials.</div>
        </Panel>
      )}
    </div>
  )
}

function ProjectSummary({ project, environments, applications }: { project: Project, environments: Environment[], applications: Application[] }) {
  const production = environments.find((environment) => environment.kind === 'production')
  const previews = environments.filter((environment) => environment.kind === 'preview')
  const routedApps = applications.filter((application) => application.domain)

  return (
    <div className="border-b p-4 lg:border-b-0 lg:border-r">
      <p className="text-sm text-muted">{project.description || 'No description yet.'}</p>
      <dl className="mt-4 grid grid-cols-2 gap-3 text-sm">
        <ProjectFact label="Apps" value={String(applications.length)} />
        <ProjectFact label="Envs" value={String(environments.length)} />
        <ProjectFact label="Routes" value={String(routedApps.length)} />
        <ProjectFact label="Previews" value={String(previews.length)} />
      </dl>
      <div className="mt-4 space-y-2 text-xs text-muted">
        <ProjectSignal icon={ShieldCheck} label="Production" value={production?.name ?? 'not created'} />
        <ProjectSignal icon={Globe2} label="Domains" value={routedApps.length ? routedApps.map((application) => application.domain).join(', ') : 'not routed'} />
      </div>
    </div>
  )
}

function EnvironmentBoard({ environments, applications }: { environments: Environment[], applications: Application[] }) {
  if (environments.length === 0) {
    return <div className="p-4 text-sm text-muted">No environments yet. Add production first, then development or PR previews.</div>
  }

  return (
    <div className="grid gap-3 p-4 xl:grid-cols-3">
      {environmentOrder(environments).map((environment) => (
        <EnvironmentColumn
          key={environment.id}
          environment={environment}
          applications={applications.filter((application) => application.environment_id === environment.id)}
        />
      ))}
    </div>
  )
}

function EnvironmentColumn({ environment, applications }: { environment: Environment, applications: Application[] }) {
  return (
    <section className="min-w-0 rounded-md border bg-background">
      <header className="flex items-start justify-between gap-3 border-b px-3 py-3">
        <div className="min-w-0">
          <div className="flex items-center gap-2">
            <h3 className="truncate text-sm font-medium">{environment.name}</h3>
            <Badge tone={environmentTone(environment)}>{environment.kind}</Badge>
          </div>
          <div className="mt-1 truncate text-xs text-muted">{environmentDetail(environment)}</div>
        </div>
        <div className="text-xs text-muted">{applications.length} app{applications.length === 1 ? '' : 's'}</div>
      </header>
      <div className="divide-y">
        {applications.map((application) => <ApplicationRow key={application.id} application={application} />)}
        {applications.length === 0 && <div className="px-3 py-4 text-sm text-muted">No application targets.</div>}
      </div>
    </section>
  )
}

function ApplicationRow({ application }: { application: Application }) {
  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{application.name}</div>
          <div className="truncate text-xs text-muted">{application.repository_url ?? 'manual compose source'}</div>
        </div>
        <Badge tone={statusTone(application.status)}>{application.status}</Badge>
      </div>
      <div className="grid gap-2 text-xs text-muted">
        <ProjectSignal icon={Server} label="Server" value={application.server_name} />
        <ProjectSignal icon={GitBranch} label="Branch" value={application.branch} />
        <ProjectSignal icon={Globe2} label="Domain" value={application.domain ?? 'not routed'} />
        <ProjectSignal icon={ShieldCheck} label="Doppler" value={dopplerScope(application)} />
      </div>
    </div>
  )
}

function ProjectFact({ label, value }: { label: string, value: string }) {
  return (
    <div className="rounded-md border bg-background px-3 py-2">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className="mt-1 text-lg font-semibold text-ink">{value}</dd>
    </div>
  )
}

function ProjectSignal({ icon: Icon, label, value }: { icon: typeof Server, label: string, value: string }) {
  return (
    <div className="flex min-w-0 items-center gap-2">
      <Icon className="size-3.5 shrink-0 text-muted" aria-hidden="true" />
      <span className="shrink-0 text-muted">{label}</span>
      <span className="truncate text-ink">{value}</span>
    </div>
  )
}

function environmentOrder(environments: Environment[]): Environment[] {
  const rank = { production: 0, development: 1, preview: 2 }
  return [...environments].sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
}

function environmentTone(environment: Environment): 'success' | 'warning' | 'neutral' {
  if (environment.kind === 'production') {
    return 'success'
  }
  if (environment.kind === 'preview') {
    return 'warning'
  }
  return 'neutral'
}

function environmentDetail(environment: Environment): string {
  if (environment.pull_request_number) {
    return `PR ${environment.pull_request_number}${environment.branch ? ` from ${environment.branch}` : ''}`
  }
  return environment.branch || environment.slug
}

function dopplerScope(application: Application): string {
  if (application.doppler_project && application.doppler_config) {
    return `${application.doppler_project} / ${application.doppler_config}`
  }
  return 'not scoped'
}

function defaultEnvironmentForm(projectID = ''): EnvironmentForm {
  return { project_id: projectID, name: '', slug: '', kind: 'development', pull_request_number: '', branch: '' }
}

function projectInput(form: ProjectForm): CreateProjectInput {
  return { name: form.name.trim(), slug: slugify(form.slug), description: form.description.trim() }
}

function environmentInput(form: EnvironmentForm): CreateEnvironmentInput {
  const prNumber = Number.parseInt(form.pull_request_number.trim(), 10)
  return {
    project_id: form.project_id.trim(),
    name: form.name.trim(),
    slug: slugify(form.slug),
    kind: form.kind,
    is_ephemeral: form.kind === 'preview',
    pull_request_number: Number.isFinite(prNumber) ? prNumber : undefined,
    branch: optionalTrimmed(form.branch),
  }
}

function validateProjectForm(form: ProjectForm): void {
  if (!form.name.trim() || !form.slug.trim()) {
    throw new Error('Project name and slug are required.')
  }
  validateSlug(form.slug)
}

function validateEnvironmentForm(form: EnvironmentForm): void {
  if (!form.project_id.trim() || !form.name.trim() || !form.slug.trim()) {
    throw new Error('Project, environment name, and slug are required.')
  }
  validateSlug(form.slug)
  if (form.kind === 'preview' && form.pull_request_number.trim()) {
    const prNumber = Number.parseInt(form.pull_request_number.trim(), 10)
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error('PR number must be greater than zero.')
    }
  }
}

function validateSlug(value: string): void {
  if (!/^[a-z0-9]([a-z0-9-]*[a-z0-9])?$/.test(slugify(value))) {
    throw new Error('Slug must use lowercase letters, numbers, and hyphens.')
  }
}

function slugify(value: string): string {
  return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-')
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}
