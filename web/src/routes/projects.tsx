import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Boxes, Container, GitBranch, Globe2, Plus, Server, Settings, ShieldCheck } from 'lucide-react'
import { useEffect, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
import { SelectInput } from '../components/ui/select-input'
import { TextInput } from '../components/ui/text-input'
import { statusTone } from '../features/status'
import {
  applyProxyRoute,
  createApplication,
  createEnvironment,
  createProject,
  createProxyRoute,
  updateProjectRegistry,
  upsertContainerRegistry,
  type Application,
  type ContainerRegistry,
  type CreateApplicationInput,
  type CreateEnvironmentInput,
  type CreateProjectInput,
  type CreateProxyRouteInput,
  type Environment,
  type Project,
  type ProxyRoute as ProxyRouteRecord,
  type Server as ServerRecord,
  type UpsertContainerRegistryInput,
} from '../lib/api'
import { validateDomain } from '../lib/domains'
import { applicationsQuery, containerRegistriesQuery, environmentsQuery, projectsQuery, proxyRoutesQuery, serversQuery } from '../lib/queries'
import { validateHealthCheckURL } from '../lib/urls'

type ProjectSection = 'overview' | 'environments' | 'targets' | 'registry' | 'routes' | 'settings'

type ProjectForm = {
  name: string
  slug: string
  description: string
}

type EnvironmentForm = {
  name: string
  slug: string
  kind: 'production' | 'development' | 'preview'
  pull_request_number: string
  branch: string
}

type TargetForm = {
  environment_id: string
  server_id: string
  name: string
  repository_url: string
  branch: string
  compose_path: string
  remote_directory: string
  domain: string
  health_check_url: string
  doppler_project: string
  doppler_config: string
}

type RegistryForm = {
  name: string
  provider: ContainerRegistry['provider']
  registry_host: string
  namespace: string
  repository: string
  default_image: string
  enabled: boolean
}

type RouteForm = {
  application_id: string
  domain: string
  upstream_url: string
  blue_upstream_url: string
  green_upstream_url: string
  tls_enabled: boolean
}

const projectSections: ProjectSection[] = ['overview', 'environments', 'targets', 'registry', 'routes', 'settings']

const defaultProjectForm: ProjectForm = { name: '', slug: '', description: '' }
const defaultRegistryForm: RegistryForm = {
  name: '',
  provider: 'gcp_artifact_registry',
  registry_host: 'us-east1-docker.pkg.dev',
  namespace: 'prosights-platform',
  repository: '',
  default_image: '',
  enabled: true,
}

export function ProjectsRoute() {
  const queryClient = useQueryClient()
  const [
    { data: projects },
    { data: environments },
    { data: applications },
    { data: servers },
    { data: registries },
    { data: proxyRoutes },
  ] = useSuspenseQueries({
    queries: [projectsQuery, environmentsQuery, applicationsQuery, serversQuery, containerRegistriesQuery, proxyRoutesQuery],
  })
  const [selectedProjectID, setSelectedProjectID] = useState(projects[0]?.id ?? '')
  const [section, setSection] = useState<ProjectSection>(() => sectionFromHash(window.location.hash))
  const [projectForm, setProjectForm] = useState<ProjectForm>(defaultProjectForm)
  const selectedProject = projects.find((project) => project.id === selectedProjectID) ?? projects[0]
  const projectEnvironments = selectedProject ? environments.filter((environment) => environment.project_id === selectedProject.id) : []
  const projectApplications = selectedProject ? applications.filter((application) => application.project_id === selectedProject.id) : []
  const projectRoutes = proxyRoutes.filter((route) => projectApplications.some((application) => application.id === route.application_id))

  const createProjectMutation = useMutation({
    mutationFn: () => createProject(projectInput(projectForm)),
    onSuccess: async (project) => {
      setProjectForm(defaultProjectForm)
      setSelectedProjectID(project.id)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }),
      ])
    },
  })

  useEffect(() => {
    function syncSectionFromHash() {
      setSection(sectionFromHash(window.location.hash))
    }
    syncSectionFromHash()
    window.addEventListener('hashchange', syncSectionFromHash)
    return () => window.removeEventListener('hashchange', syncSectionFromHash)
  }, [])

  return (
    <div className="space-y-5">
      <PageHeader
        title="Projects"
        description="A project is the app boundary. Configure its environments, deploy targets, registry, routes, and project settings here."
      />
      <div className="grid gap-5 xl:grid-cols-[280px_minmax(0,1fr)]">
        <ProjectSidebar
          projects={projects}
          selectedProject={selectedProject}
          projectForm={projectForm}
          isSaving={createProjectMutation.isPending}
          errorMessage={createProjectMutation.error?.message}
          onProjectChange={setSelectedProjectID}
          onProjectFormChange={(updates) => setProjectForm((state) => ({ ...state, ...updates }))}
          onCreateProject={() => {
            validateProjectForm(projectForm)
            createProjectMutation.mutate()
          }}
        />
        {selectedProject ? (
          <ProjectWorkspace
            project={selectedProject}
            section={section}
            environments={projectEnvironments}
            applications={projectApplications}
            servers={servers}
            registries={registries}
            proxyRoutes={projectRoutes}
          />
        ) : (
          <Panel>
            <div className="p-6 text-sm text-muted">Create a project to configure deploy targets and project-specific settings.</div>
          </Panel>
        )}
      </div>
    </div>
  )
}

function ProjectSidebar({
  projects,
  selectedProject,
  projectForm,
  isSaving,
  errorMessage,
  onProjectChange,
  onProjectFormChange,
  onCreateProject,
}: {
  projects: Project[]
  selectedProject?: Project
  projectForm: ProjectForm
  isSaving: boolean
  errorMessage?: string
  onProjectChange: (projectID: string) => void
  onProjectFormChange: (updates: Partial<ProjectForm>) => void
  onCreateProject: () => void
}) {
  const [formError, setFormError] = useState<string>()
  return (
    <div className="space-y-4">
      <Panel title="Project">
        <div className="divide-y">
          {projects.map((project) => (
            <button
              key={project.id}
              type="button"
              className={`block w-full px-4 py-3 text-left transition-colors hover:bg-panel ${project.id === selectedProject?.id ? 'bg-accent/10' : ''}`}
              onClick={() => onProjectChange(project.id)}
            >
              <div className="truncate text-sm font-medium text-ink">{project.name}</div>
              <div className="mt-1 truncate text-xs text-muted">{project.slug}</div>
            </button>
          ))}
          {projects.length === 0 && <div className="px-4 py-5 text-sm text-muted">No projects yet.</div>}
        </div>
      </Panel>
      <Panel title="New project">
        <form
          className="space-y-3 p-4"
          onSubmit={(event) => {
            event.preventDefault()
            setFormError(undefined)
            try {
              onCreateProject()
            } catch (error) {
              setFormError(error instanceof Error ? error.message : 'Project is invalid.')
            }
          }}
        >
          <TextInput label="Name" value={projectForm.name} onChange={(name) => onProjectFormChange({ name, slug: projectForm.slug || slugify(name) })} required />
          <TextInput label="Slug" value={projectForm.slug} onChange={(slug) => onProjectFormChange({ slug })} required />
          <label className="flex flex-col gap-1 text-xs text-muted">
            <span>Description</span>
            <textarea
              className="min-h-20 resize-y rounded-md border bg-background px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
              value={projectForm.description}
              onChange={(event) => onProjectFormChange({ description: event.target.value })}
            />
          </label>
          <Button variant="primary" disabled={isSaving || !projectForm.name || !projectForm.slug}>
            <Plus className="size-4" />
            {isSaving ? 'Saving...' : 'Create'}
          </Button>
        </form>
        {(formError || errorMessage) && <div className="border-t px-4 py-3"><InlineError message={formError ?? errorMessage ?? 'Project could not be saved.'} /></div>}
      </Panel>
    </div>
  )
}

function ProjectWorkspace({
  project,
  section,
  environments,
  applications,
  servers,
  registries,
  proxyRoutes,
}: {
  project: Project
  section: ProjectSection
  environments: Environment[]
  applications: Application[]
  servers: ServerRecord[]
  registries: ContainerRegistry[]
  proxyRoutes: ProxyRouteRecord[]
}) {
  return (
    <div className="space-y-5">
      <ProjectHeader project={project} environments={environments} applications={applications} proxyRoutes={proxyRoutes} />
      {section === 'overview' && <ProjectOverview project={project} environments={environments} applications={applications} proxyRoutes={proxyRoutes} />}
      {section === 'environments' && <ProjectEnvironments project={project} environments={environments} applications={applications} />}
      {section === 'targets' && <ProjectTargets project={project} environments={environments} applications={applications} servers={servers} />}
      {section === 'registry' && <ProjectRegistry project={project} registries={registries} />}
      {section === 'routes' && <ProjectRoutes applications={applications} routes={proxyRoutes} />}
      {section === 'settings' && <ProjectSettings project={project} />}
    </div>
  )
}

function ProjectHeader({ project, environments, applications, proxyRoutes }: { project: Project, environments: Environment[], applications: Application[], proxyRoutes: ProxyRouteRecord[] }) {
  return (
    <Panel>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
        <div className="min-w-0">
          <div className="flex flex-wrap items-center gap-2">
            <h2 className="truncate text-xl font-semibold text-ink">{project.name}</h2>
            <Badge tone={project.default_registry_id ? 'success' : 'neutral'}>{project.default_registry_name ?? 'registry not set'}</Badge>
          </div>
          <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">{project.description || 'No project description yet.'}</p>
        </div>
        <dl className="grid grid-cols-3 gap-3 text-sm">
          <ProjectFact label="Envs" value={String(environments.length)} />
          <ProjectFact label="Targets" value={String(applications.length)} />
          <ProjectFact label="Routes" value={String(proxyRoutes.length)} />
        </dl>
      </div>
    </Panel>
  )
}

function ProjectOverview({ project, environments, applications, proxyRoutes }: { project: Project, environments: Environment[], applications: Application[], proxyRoutes: ProxyRouteRecord[] }) {
  const production = environments.find((environment) => environment.kind === 'production')
  const activeTargets = applications.filter((application) => application.status === 'healthy' || application.status === 'deploying')
  return (
    <div className="grid gap-5 xl:grid-cols-[0.9fr_1.1fr]">
      <Panel title="Project map">
        <div className="space-y-3 p-4 text-sm">
          <ProjectSignal icon={ShieldCheck} label="Production" value={production?.name ?? 'not created'} />
          <ProjectSignal icon={Container} label="Registry" value={project.default_registry_name ?? 'not configured'} />
          <ProjectSignal icon={Boxes} label="Active targets" value={String(activeTargets.length)} />
          <ProjectSignal icon={Globe2} label="Domains" value={proxyRoutes.length ? proxyRoutes.map((route) => route.domain).join(', ') : 'not routed'} />
        </div>
      </Panel>
      <EnvironmentBoard environments={environments} applications={applications} />
    </div>
  )
}

function ProjectEnvironments({ project, environments, applications }: { project: Project, environments: Environment[], applications: Application[] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<EnvironmentForm>(defaultEnvironmentForm())
  const [error, setError] = useState<string>()
  const create = useMutation({
    mutationFn: () => createEnvironment(environmentInput(project.id, form)),
    onSuccess: async () => {
      setForm(defaultEnvironmentForm())
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey })
    },
  })
  return (
    <div className="space-y-5">
      <Panel title="Add environment">
        <form
          className="grid gap-3 p-4 md:grid-cols-[1fr_1fr_150px_120px_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            try {
              validateEnvironmentForm(form)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Environment is invalid.')
              return
            }
            create.mutate()
          }}
        >
          <TextInput label="Name" value={form.name} onChange={(name) => setForm((state) => ({ ...state, name, slug: state.slug || slugify(name) }))} required />
          <TextInput label="Slug" value={form.slug} onChange={(slug) => setForm((state) => ({ ...state, slug }))} required />
          <SelectInput label="Kind" value={form.kind} onChange={(kind) => setForm((state) => ({ ...state, kind: kind as EnvironmentForm['kind'] }))}>
            <option value="production">Production</option>
            <option value="development">Development</option>
            <option value="preview">PR preview</option>
          </SelectInput>
          <TextInput label="PR" value={form.pull_request_number} onChange={(pull_request_number) => setForm((state) => ({ ...state, pull_request_number }))} placeholder="42" />
          <div className="flex items-end">
            <Button variant="primary" disabled={create.isPending || !form.name || !form.slug}>{create.isPending ? 'Saving...' : 'Add'}</Button>
          </div>
          <TextInput label="Branch" value={form.branch} onChange={(branch) => setForm((state) => ({ ...state, branch }))} placeholder="feature/api" />
        </form>
        {(error || create.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? create.error?.message ?? 'Environment could not be saved.'} /></div>}
      </Panel>
      <EnvironmentBoard environments={environments} applications={applications} />
    </div>
  )
}

function ProjectTargets({ project, environments, applications, servers }: { project: Project, environments: Environment[], applications: Application[], servers: ServerRecord[] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<TargetForm>(defaultTargetForm(environments[0]?.id, servers[0]?.id))
  const [error, setError] = useState<string>()
  const create = useMutation({
    mutationFn: () => createApplication(targetInput(form)),
    onSuccess: async () => {
      setForm((state) => defaultTargetForm(state.environment_id, state.server_id))
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })
  const projectEnvironmentIDs = new Set(environments.map((environment) => environment.id))
  const validEnvironmentID = projectEnvironmentIDs.has(form.environment_id) ? form.environment_id : environments[0]?.id ?? ''
  return (
    <div className="space-y-5">
      <Panel title="Add deploy target">
        <form
          className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            try {
              validateTargetForm({ ...form, environment_id: validEnvironmentID })
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Deploy target is invalid.')
              return
            }
            create.mutate()
          }}
        >
          <SelectInput label="Environment" value={validEnvironmentID} onChange={(environment_id) => setForm((state) => ({ ...state, environment_id }))} required>
            <option value="" disabled>Select environment</option>
            {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
          </SelectInput>
          <SelectInput label="Server" value={form.server_id} onChange={(server_id) => setForm((state) => ({ ...state, server_id }))} required>
            <option value="" disabled>Select server</option>
            {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
          </SelectInput>
          <TextInput label="Target name" value={form.name} onChange={(name) => setForm((state) => ({ ...state, name }))} required />
          <TextInput label="Remote directory" value={form.remote_directory} onChange={(remote_directory) => setForm((state) => ({ ...state, remote_directory }))} required placeholder="/srv/app" />
          <div className="flex items-end">
            <Button variant="primary" disabled={create.isPending || !validEnvironmentID || !form.server_id || !form.name || !form.remote_directory}>{create.isPending ? 'Saving...' : 'Add'}</Button>
          </div>
          <TextInput label="Repository" value={form.repository_url} onChange={(repository_url) => setForm((state) => ({ ...state, repository_url }))} placeholder="git@github.com:org/app.git" />
          <TextInput label="Branch" value={form.branch} onChange={(branch) => setForm((state) => ({ ...state, branch }))} />
          <TextInput label="Compose path" value={form.compose_path} onChange={(compose_path) => setForm((state) => ({ ...state, compose_path }))} />
          <TextInput label="Domain" value={form.domain} onChange={(domain) => setForm((state) => ({ ...state, domain }))} />
          <TextInput label="Health check URL" value={form.health_check_url} onChange={(health_check_url) => setForm((state) => ({ ...state, health_check_url }))} placeholder="http://127.0.0.1:{port}/healthz" />
          <TextInput label="Doppler project" value={form.doppler_project} onChange={(doppler_project) => setForm((state) => ({ ...state, doppler_project }))} />
          <TextInput label="Doppler config" value={form.doppler_config} onChange={(doppler_config) => setForm((state) => ({ ...state, doppler_config }))} />
        </form>
        <div className="border-t px-4 py-3 text-sm text-muted">Deploy targets are runtime placements for {project.name}. The project registry is inherited automatically at deployment time.</div>
        {(error || create.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? create.error?.message ?? 'Deploy target could not be saved.'} /></div>}
      </Panel>
      <TargetList applications={applications} />
    </div>
  )
}

function ProjectRegistry({ project, registries }: { project: Project, registries: ContainerRegistry[] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<RegistryForm>(defaultRegistryForm)
  const [error, setError] = useState<string>()
  const saveRegistry = useMutation({
    mutationFn: () => upsertContainerRegistry(registryInput(form)),
    onSuccess: async (registry) => {
      setForm(defaultRegistryForm)
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: containerRegistriesQuery.queryKey })
      assignRegistry.mutate(registry.id)
    },
  })
  const assignRegistry = useMutation({
    mutationFn: (registryID: string) => updateProjectRegistry(project.id, registryID || undefined),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
      ])
    },
  })
  const activeRegistry = registries.find((registry) => registry.id === project.default_registry_id)
  return (
    <div className="space-y-5">
      <Panel title="Project artifact registry">
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_320px]">
          <div>
            <SelectInput label="Registry" value={project.default_registry_id ?? ''} onChange={(registryID) => assignRegistry.mutate(registryID)}>
              <option value="">No project default</option>
              {registries.filter((registry) => registry.enabled).map((registry) => <option key={registry.id} value={registry.id}>{registry.name}</option>)}
            </SelectInput>
            <div className="mt-3 text-sm text-muted">Deployments for this project use this registry by default. You can still override with a manual image ref during deployment.</div>
          </div>
          <div className="rounded-md border bg-background p-3 text-sm">
            <div className="text-xs text-muted">Current base</div>
            <div className="mt-2 break-all font-mono text-xs text-ink">{activeRegistry ? registryBasePath(activeRegistry) : 'not configured'}</div>
            <div className="mt-3 text-xs text-muted">Default image: {activeRegistry?.default_image || 'set per deploy'}</div>
          </div>
        </div>
      </Panel>
      <Panel title="Create and assign registry">
        <form
          className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            try {
              validateRegistryForm(form)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Registry is invalid.')
              return
            }
            saveRegistry.mutate()
          }}
        >
          <TextInput label="Name" value={form.name} onChange={(name) => setForm((state) => ({ ...state, name }))} required />
          <TextInput label="Host" value={form.registry_host} onChange={(registry_host) => setForm((state) => ({ ...state, registry_host }))} required />
          <TextInput label="Namespace" value={form.namespace} onChange={(namespace) => setForm((state) => ({ ...state, namespace }))} />
          <TextInput label="Repository" value={form.repository} onChange={(repository) => setForm((state) => ({ ...state, repository }))} required />
          <div className="flex items-end">
            <Button variant="primary" disabled={saveRegistry.isPending || !form.name || !form.registry_host || !form.repository}>{saveRegistry.isPending ? 'Saving...' : 'Create'}</Button>
          </div>
          <TextInput label="Default image" value={form.default_image} onChange={(default_image) => setForm((state) => ({ ...state, default_image }))} placeholder="workflows-server" />
          <SelectInput label="Provider" value={form.provider} onChange={(provider) => setForm((state) => ({ ...state, provider: provider as RegistryForm['provider'] }))}>
            <option value="gcp_artifact_registry">GCP Artifact Registry</option>
            <option value="docker_hub">Docker Hub</option>
            <option value="ghcr">GHCR</option>
            <option value="ecr">ECR</option>
            <option value="custom">Custom</option>
          </SelectInput>
        </form>
        <div className="border-t px-4 py-3 text-sm text-muted">Registry records are base paths only. Auth stays on the remote server or provider system.</div>
        {(error || saveRegistry.error || assignRegistry.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? saveRegistry.error?.message ?? assignRegistry.error?.message ?? 'Registry could not be saved.'} /></div>}
      </Panel>
    </div>
  )
}

function ProjectRoutes({ applications, routes }: { applications: Application[], routes: ProxyRouteRecord[] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<RouteForm>(defaultRouteForm(applications[0]))
  const [error, setError] = useState<string>()
  const selectedApplication = applications.find((application) => application.id === form.application_id)
  const create = useMutation({
    mutationFn: () => createProxyRoute(routeInput(form)),
    onSuccess: async () => {
      setForm(defaultRouteForm(selectedApplication))
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey })
    },
  })
  const apply = useMutation({
    mutationFn: (routeID: string) => applyProxyRoute(routeID),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey })
    },
  })
  return (
    <div className="space-y-5">
      <Panel title="Add proxy route">
        <form
          className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_1fr_1fr_auto]"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            try {
              validateRouteForm(form)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Proxy route is invalid.')
              return
            }
            create.mutate()
          }}
        >
          <SelectInput
            label="Deploy target"
            value={form.application_id}
            onChange={(application_id) => {
              const app = applications.find((item) => item.id === application_id)
              setForm((state) => ({ ...state, application_id, domain: app?.domain ?? state.domain }))
            }}
          >
            <option value="" disabled>Select target</option>
            {applications.map((application) => <option key={application.id} value={application.id}>{application.name} / {application.environment_name}</option>)}
          </SelectInput>
          <TextInput label="Domain" value={form.domain} onChange={(domain) => setForm((state) => ({ ...state, domain }))} required />
          <TextInput label="Upstream" value={form.upstream_url} onChange={(upstream_url) => setForm((state) => ({ ...state, upstream_url }))} required placeholder="http://127.0.0.1:3101" />
          <div className="flex items-end">
            <Button variant="primary" disabled={create.isPending || !form.application_id || !form.domain || !form.upstream_url}>{create.isPending ? 'Saving...' : 'Add'}</Button>
          </div>
          <TextInput label="Blue upstream" value={form.blue_upstream_url} onChange={(blue_upstream_url) => setForm((state) => ({ ...state, blue_upstream_url }))} placeholder="http://127.0.0.1:3101" />
          <TextInput label="Green upstream" value={form.green_upstream_url} onChange={(green_upstream_url) => setForm((state) => ({ ...state, green_upstream_url }))} placeholder="http://127.0.0.1:3102" />
          <SelectInput label="TLS" value={form.tls_enabled ? 'true' : 'false'} onChange={(value) => setForm((state) => ({ ...state, tls_enabled: value === 'true' }))}>
            <option value="true">Enabled</option>
            <option value="false">Disabled</option>
          </SelectInput>
        </form>
        {(error || create.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? create.error?.message ?? 'Proxy route could not be saved.'} /></div>}
      </Panel>
      <Panel title="Project routes">
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Domain</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Upstream</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{route.domain}</td>
                  <td className="px-4 py-3 text-muted">{route.application_name ?? 'unlinked'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{route.upstream_url}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(route.status)}>{route.status}</Badge></td>
                  <td className="px-4 py-3"><Button variant="ghost" disabled={apply.isPending || route.proxy_type === 'none'} onClick={() => apply.mutate(route.id)}>Apply</Button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {routes.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No routes for this project.</div>}
        {apply.error && <div className="border-t px-4 py-3"><InlineError message={apply.error.message} /></div>}
      </Panel>
    </div>
  )
}

function ProjectSettings({ project }: { project: Project }) {
  return (
    <Panel title="Project settings">
      <div className="grid gap-4 p-4 lg:grid-cols-2">
        <ProjectSignal icon={Settings} label="Project ID" value={project.id} />
        <ProjectSignal icon={GitBranch} label="Slug" value={project.slug} />
        <ProjectSignal icon={Container} label="Default registry" value={project.default_registry_name ?? 'not configured'} />
      </div>
      <div className="border-t px-4 py-3 text-sm text-muted">Editing project metadata is intentionally separate from creating runtime targets. Rename/edit can be added here next.</div>
    </Panel>
  )
}

function EnvironmentBoard({ environments, applications }: { environments: Environment[], applications: Application[] }) {
  if (environments.length === 0) {
    return <Panel><div className="p-5 text-sm text-muted">No environments yet. Add production first, then development or PR previews.</div></Panel>
  }
  return (
    <Panel title="Environment map">
      <div className="grid gap-3 p-4 xl:grid-cols-3">
        {environmentOrder(environments).map((environment) => (
          <EnvironmentColumn
            key={environment.id}
            environment={environment}
            applications={applications.filter((application) => application.environment_id === environment.id)}
          />
        ))}
      </div>
    </Panel>
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
        <div className="text-xs text-muted">{applications.length} target{applications.length === 1 ? '' : 's'}</div>
      </header>
      <div className="divide-y">
        {applications.map((application) => <ApplicationRow key={application.id} application={application} />)}
        {applications.length === 0 && <div className="px-3 py-4 text-sm text-muted">No deploy targets.</div>}
      </div>
    </section>
  )
}

function TargetList({ applications }: { applications: Application[] }) {
  return (
    <Panel title="Deploy targets">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Environment</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Directory</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {applications.map((application) => (
              <tr key={application.id} className="border-t">
                <td className="px-4 py-3">
                  <div className="font-medium">{application.name}</div>
                  <div className="text-xs text-muted">{application.repository_url ?? 'manual compose source'}</div>
                </td>
                <td className="px-4 py-3 text-muted">{application.environment_name}</td>
                <td className="px-4 py-3 text-muted">{application.server_name}</td>
                <td className="px-4 py-3 text-muted">{application.remote_directory}</td>
                <td className="px-4 py-3 text-muted">{application.domain ?? 'not routed'}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(application.status)}>{application.status}</Badge></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applications.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No deploy targets for this project.</div>}
    </Panel>
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

function defaultEnvironmentForm(): EnvironmentForm {
  return { name: '', slug: '', kind: 'development', pull_request_number: '', branch: '' }
}

function defaultTargetForm(environmentID = '', serverID = ''): TargetForm {
  return {
    environment_id: environmentID,
    server_id: serverID,
    name: '',
    repository_url: '',
    branch: 'main',
    compose_path: 'docker-compose.yml',
    remote_directory: '',
    domain: '',
    health_check_url: '',
    doppler_project: '',
    doppler_config: '',
  }
}

function defaultRouteForm(application?: Application): RouteForm {
  return {
    application_id: application?.id ?? '',
    domain: application?.domain ?? '',
    upstream_url: 'http://127.0.0.1:3000',
    blue_upstream_url: '',
    green_upstream_url: '',
    tls_enabled: true,
  }
}

function projectInput(form: ProjectForm): CreateProjectInput {
  return { name: form.name.trim(), slug: slugify(form.slug), description: form.description.trim() }
}

function environmentInput(projectID: string, form: EnvironmentForm): CreateEnvironmentInput {
  const prNumber = Number.parseInt(form.pull_request_number.trim(), 10)
  return {
    project_id: projectID,
    name: form.name.trim(),
    slug: slugify(form.slug),
    kind: form.kind,
    is_ephemeral: form.kind === 'preview',
    pull_request_number: Number.isFinite(prNumber) ? prNumber : undefined,
    branch: optionalTrimmed(form.branch),
  }
}

function targetInput(form: TargetForm): CreateApplicationInput {
  return {
    environment_id: form.environment_id.trim(),
    server_id: form.server_id.trim(),
    name: form.name.trim(),
    remote_directory: form.remote_directory.trim(),
    repository_url: optionalTrimmed(form.repository_url),
    branch: form.branch.trim() || 'main',
    compose_path: form.compose_path.trim() || 'docker-compose.yml',
    domain: optionalTrimmed(form.domain)?.toLowerCase(),
    health_check_url: optionalTrimmed(form.health_check_url),
    doppler_project: optionalTrimmed(form.doppler_project),
    doppler_config: optionalTrimmed(form.doppler_config),
  }
}

function registryInput(form: RegistryForm): UpsertContainerRegistryInput {
  return {
    name: form.name.trim(),
    provider: form.provider,
    registry_host: form.registry_host.trim(),
    namespace: cleanPathPart(form.namespace),
    repository: cleanPathPart(form.repository),
    default_image: cleanPathPart(form.default_image),
    enabled: form.enabled,
  }
}

function routeInput(form: RouteForm): CreateProxyRouteInput {
  return {
    application_id: form.application_id,
    domain: form.domain.trim().toLowerCase(),
    upstream_url: form.upstream_url.trim(),
    blue_upstream_url: optionalTrimmed(form.blue_upstream_url),
    green_upstream_url: optionalTrimmed(form.green_upstream_url),
    tls_enabled: form.tls_enabled,
  }
}

function validateProjectForm(form: ProjectForm): void {
  if (!form.name.trim() || !form.slug.trim()) {
    throw new Error('Project name and slug are required.')
  }
  validateSlug(form.slug)
}

function validateEnvironmentForm(form: EnvironmentForm): void {
  if (!form.name.trim() || !form.slug.trim()) {
    throw new Error('Environment name and slug are required.')
  }
  validateSlug(form.slug)
  if (form.kind === 'preview' && form.pull_request_number.trim()) {
    const prNumber = Number.parseInt(form.pull_request_number.trim(), 10)
    if (!Number.isInteger(prNumber) || prNumber <= 0) {
      throw new Error('PR number must be greater than zero.')
    }
  }
}

function validateTargetForm(form: TargetForm): void {
  if (!form.environment_id || !form.server_id || !form.name.trim() || !form.remote_directory.trim()) {
    throw new Error('Environment, server, target name, and remote directory are required.')
  }
  validateRemoteDirectory(form.remote_directory)
  validateGitBranch(form.branch)
  validateComposePath(form.compose_path)
  validateRepositoryURL(form.repository_url)
  if (form.domain.trim()) validateDomain(form.domain)
  validateHealthCheckURL(form.health_check_url)
  validateDopplerScope(form.doppler_project, form.doppler_config)
}

function validateRegistryForm(form: RegistryForm): void {
  const input = registryInput(form)
  if (!input.name || !input.registry_host || !input.repository) {
    throw new Error('Name, host, and repository are required.')
  }
  if (/[\s/:]/.test(input.registry_host)) {
    throw new Error('Host must not include scheme, path, or whitespace.')
  }
  for (const value of [input.namespace, input.repository, input.default_image]) {
    if (value && (/[\s]/.test(value) || value.includes('//'))) {
      throw new Error('Namespace, repository, and default image cannot contain whitespace or empty path segments.')
    }
  }
}

function validateRouteForm(form: RouteForm): void {
  if (!form.application_id.trim()) {
    throw new Error('Deploy target is required.')
  }
  validateDomain(form.domain)
  validateProxyUpstream(form.upstream_url)
  if (form.blue_upstream_url.trim()) validateProxyUpstream(form.blue_upstream_url)
  if (form.green_upstream_url.trim()) validateProxyUpstream(form.green_upstream_url)
}

function validateRemoteDirectory(value: string): void {
  const remoteDirectory = value.trim()
  if (hasControlCharacters(remoteDirectory) || remoteDirectory === '/' || !remoteDirectory.startsWith('/') || remoteDirectory.includes('//') || remoteDirectory.split('/').includes('..')) {
    throw new Error('Remote directory must be a safe absolute path below root.')
  }
}

function validateGitBranch(value: string): void {
  const branch = value.trim()
  if (!branch || branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.includes('//') || branch.endsWith('.') || branch.includes('..') || branch.includes('@{') || branch.endsWith('.lock') || !/^[A-Za-z0-9/._-]+$/.test(branch)) {
    throw new Error('Branch is not a safe git ref.')
  }
}

function validateComposePath(value: string): void {
  const composePath = value.trim()
  if (!composePath || composePath.startsWith('/') || hasControlCharacters(composePath) || composePath.split('/').includes('..') || composePath === '.') {
    throw new Error('Compose path must be a safe relative compose file path.')
  }
}

function validateRepositoryURL(value: string): void {
  const repositoryURL = value.trim()
  if (!repositoryURL) return
  if (hasControlCharacters(repositoryURL)) {
    throw new Error('Repository URL cannot contain control characters.')
  }
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repositoryURL)) return
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repositoryURL)) return
  throw new Error('Repository URL must be a GitHub owner/repository remote.')
}

function validateDopplerScope(project: string, config: string): void {
  const dopplerProject = project.trim()
  const dopplerConfig = config.trim()
  if (!!dopplerProject !== !!dopplerConfig) {
    throw new Error('Doppler project and config must be provided together.')
  }
  if (hasControlCharacters(dopplerProject) || hasControlCharacters(dopplerConfig)) {
    throw new Error('Doppler scope cannot contain control characters.')
  }
}

function validateProxyUpstream(value: string): void {
  if (hasControlCharacters(value)) {
    throw new Error('Upstream URL cannot contain control characters.')
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Upstream URL must be an absolute HTTP URL.')
  }
  if (!parsed.host || parsed.username || parsed.password || (parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash || (parsed.protocol !== 'http:' && parsed.protocol !== 'https:')) {
    throw new Error('Upstream URL must be an origin HTTP URL without credentials, path, query, or fragment.')
  }
}

function environmentOrder(environments: Environment[]): Environment[] {
  const rank = { production: 0, development: 1, preview: 2 }
  return [...environments].sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name))
}

function environmentTone(environment: Environment): 'success' | 'warning' | 'neutral' {
  if (environment.kind === 'production') return 'success'
  if (environment.kind === 'preview') return 'warning'
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

function registryBasePath(registry: ContainerRegistry): string {
  return [registry.registry_host, registry.namespace, registry.repository].map(cleanPathPart).filter(Boolean).join('/')
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

function cleanPathPart(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function hasControlCharacters(value: string): boolean {
  return value.includes('\n') || value.includes('\r') || value.includes('\t')
}

function sectionFromHash(hash: string): ProjectSection {
  const value = hash.replace(/^#/, '')
  return projectSections.includes(value as ProjectSection) ? value as ProjectSection : 'overview'
}
