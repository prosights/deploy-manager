import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Link, useNavigate, useParams } from '@tanstack/react-router'
import { ArrowLeft, Container, GitBranch, Globe2, RefreshCw, Rocket, Server, Settings, ShieldCheck, Trash2 } from 'lucide-react'
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
  createDeployment,
  createEnvironment,
  createProxyRoute,
  deleteApplication,
  deleteEnvironment,
  deleteProject,
  deleteProxyRoute,
  detectGitHubRepositoryServices,
  importGitHubRepositoryServices,
  listGitHubRepositoryBranches,
  updateProject,
  updateProjectRegistry,
  updateProjectRepository,
  upsertContainerRegistry,
  type Application,
  type ContainerRegistry,
  type CreateApplicationInput,
  type CreateEnvironmentInput,
  type CreateProxyRouteInput,
  type Environment,
  type GitHubDetectedService,
  type GitHubRepository,
  type Project,
  type ProxyRoute as ProxyRouteRecord,
  type Server as ServerRecord,
  type UpdateProjectInput,
  type UpsertContainerRegistryInput,
} from '../lib/api'
import { validateDomain } from '../lib/domains'
import {
  applicationsQuery,
  containerRegistriesQuery,
  environmentsQuery,
  githubRepositoriesQuery,
  projectsQuery,
  proxyRoutesQuery,
  serversQuery,
} from '../lib/queries'
import { validateHealthCheckURL } from '../lib/urls'
import { toast } from '../store/toasts'

type ProjectSection = 'overview' | 'services' | 'environments' | 'registry' | 'routes' | 'settings'

type EnvironmentForm = {
  name: string
  slug: string
  kind: 'production' | 'development' | 'preview'
  pull_request_number: string
  branch: string
}

type ServiceForm = {
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

const projectSections: ProjectSection[] = ['overview', 'services', 'environments', 'registry', 'routes', 'settings']

const sectionLabels: Record<ProjectSection, string> = {
  overview: 'Overview',
  services: 'Services',
  environments: 'Environments',
  registry: 'Registry',
  routes: 'Routes',
  settings: 'Settings',
}

const defaultRegistryForm: RegistryForm = {
  name: '',
  provider: 'gcp_artifact_registry',
  registry_host: 'us-east1-docker.pkg.dev',
  namespace: 'prosights-platform',
  repository: '',
  default_image: '',
  enabled: true,
}

export function ProjectDetailRoute({ projectId: projectIdProp }: { projectId?: string } = {}) {
  const params = useParams({ strict: false }) as { projectId?: string }
  const projectId = projectIdProp ?? params.projectId ?? ''
  const [
    { data: projects },
    { data: environments },
    { data: applications },
    { data: servers },
    { data: registries },
    { data: proxyRoutes },
    { data: githubRepositories },
  ] = useSuspenseQueries({
    queries: [projectsQuery, environmentsQuery, applicationsQuery, serversQuery, containerRegistriesQuery, proxyRoutesQuery, githubRepositoriesQuery],
  })
  const [section, setSection] = useState<ProjectSection>(() => sectionFromHash(window.location.hash))
  const project = projects.find((item) => item.id === projectId)

  useEffect(() => {
    function syncSectionFromHash() {
      setSection(sectionFromHash(window.location.hash))
    }
    syncSectionFromHash()
    window.addEventListener('hashchange', syncSectionFromHash)
    return () => window.removeEventListener('hashchange', syncSectionFromHash)
  }, [])

  if (!project) {
    return (
      <div className="space-y-5">
        <PageHeader title="Project not found" description="This project does not exist or was deleted." />
        <Panel>
          <div className="p-5">
            <Link to="/projects" className="inline-flex items-center gap-2 text-sm text-accent-text hover:underline">
              <ArrowLeft className="size-4" aria-hidden="true" />
              Back to projects
            </Link>
          </div>
        </Panel>
      </div>
    )
  }

  const projectEnvironments = environments.filter((environment) => environment.project_id === project.id)
  const projectApplications = applications.filter((application) => application.project_id === project.id)
  const projectRoutes = proxyRoutes.filter((route) => projectApplications.some((application) => application.id === route.application_id))

  return (
    <div className="space-y-5">
      <ProjectHeader project={project} section={section} environments={projectEnvironments} applications={projectApplications} proxyRoutes={projectRoutes} />
      {section === 'overview' && (
        <div className="space-y-5">
          <ProjectSourcePanel project={project} githubRepositories={githubRepositories} />
          <ProjectSetupPath project={project} environments={projectEnvironments} applications={projectApplications} proxyRoutes={projectRoutes} />
          <EnvironmentBoard title="Services by environment" environments={projectEnvironments} applications={projectApplications} />
        </div>
      )}
      {section === 'services' && (
        <ProjectServicesSection
          project={project}
          environments={projectEnvironments}
          applications={projectApplications}
          servers={servers}
          githubRepositories={githubRepositories}
        />
      )}
      {section === 'environments' && <ProjectEnvironments project={project} environments={projectEnvironments} applications={projectApplications} />}
      {section === 'registry' && <ProjectRegistry project={project} registries={registries} />}
      {section === 'routes' && <ProjectRoutes applications={projectApplications} routes={projectRoutes} />}
      {section === 'settings' && <ProjectSettings project={project} />}
    </div>
  )
}

function ProjectHeader({
  project,
  section,
  environments,
  applications,
  proxyRoutes,
}: {
  project: Project
  section: ProjectSection
  environments: Environment[]
  applications: Application[]
  proxyRoutes: ProxyRouteRecord[]
}) {
  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2 text-sm text-muted">
        <Link to="/projects" className="inline-flex items-center gap-1.5 hover:text-ink">
          <ArrowLeft className="size-4" aria-hidden="true" />
          Projects
        </Link>
        <span aria-hidden="true">/</span>
        <span className="truncate font-medium text-ink">{project.name}</span>
      </div>
      <Panel>
        <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
          <div className="min-w-0">
            <div className="flex flex-wrap items-center gap-2">
              <h2 className="truncate text-xl font-semibold text-ink">{project.name}</h2>
              <Badge tone={project.repository_full_name ? 'success' : 'neutral'}>
                {project.repository_full_name ? `${project.repository_full_name}#${project.repository_branch ?? 'main'}` : 'no repository'}
              </Badge>
              <Badge tone={project.default_registry_id ? 'success' : 'neutral'}>{project.default_registry_name ?? 'registry not set'}</Badge>
            </div>
            <p className="mt-1 max-w-3xl text-sm leading-6 text-muted">
              {project.description || `${project.name} groups the environments, services, and routes for one product.`}
            </p>
          </div>
          <dl className="grid grid-cols-3 gap-3 text-sm">
            <ProjectFact label="Envs" value={String(environments.length)} />
            <ProjectFact label="Services" value={String(applications.length)} />
            <ProjectFact label="Routes" value={String(proxyRoutes.length)} />
          </dl>
        </div>
        <nav className="flex gap-1 overflow-x-auto border-t px-2 py-2" aria-label="Project sections">
          {projectSections.map((item) => (
            <a
              key={item}
              href={`#${item}`}
              aria-current={section === item ? 'page' : undefined}
              className={`inline-flex h-8 shrink-0 items-center rounded-md px-3 text-sm transition-colors ${
                section === item ? 'bg-accent/15 font-medium text-accent-text' : 'text-muted hover:bg-panel hover:text-ink'
              }`}
            >
              {sectionLabels[item]}
            </a>
          ))}
        </nav>
      </Panel>
    </div>
  )
}

// ProjectSourcePanel connects the project to one GitHub repository and branch.
// Everything deployed inside the project builds from this source.
function ProjectSourcePanel({ project, githubRepositories }: { project: Project, githubRepositories: GitHubRepository[] }) {
  const queryClient = useQueryClient()
  const repoOptions = uniqueRepositoryNames(githubRepositories)
  const [repositoryKey, setRepositoryKey] = useState(() => projectRepositoryKey(project, githubRepositories))
  const [branch, setBranch] = useState(project.repository_branch ?? '')
  const [branches, setBranches] = useState<string[]>([])
  const selectedRepo = repoOptions.find((repository) => repositoryNameKey(repository) === repositoryKey)

  useEffect(() => {
    setRepositoryKey(projectRepositoryKey(project, githubRepositories))
    setBranch(project.repository_branch ?? '')
    setBranches([])
  }, [project.id, project.repository_full_name, project.repository_branch, githubRepositories])

  const loadBranches = useMutation({
    mutationFn: () => {
      if (!selectedRepo) throw new Error('Select a repository first.')
      return listGitHubRepositoryBranches({ connector_id: selectedRepo.connector_id, repository: selectedRepo.repository })
    },
    onSuccess: (result) => setBranches(result.branches),
  })
  const save = useMutation({
    mutationFn: () => {
      if (!selectedRepo) throw new Error('Select a repository first.')
      return updateProjectRepository(project.id, {
        connector_id: selectedRepo.connector_id,
        repository: selectedRepo.repository,
        branch: branch.trim() || selectedRepo.branch || 'main',
      })
    },
    onSuccess: async (updated) => {
      toast.success('Repository connected', `${updated.repository_full_name}#${updated.repository_branch} now feeds every deploy in this project.`)
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey })
    },
  })
  const disconnect = useMutation({
    mutationFn: () => updateProjectRepository(project.id, {}),
    onSuccess: async () => {
      toast.info('Repository disconnected', 'Services keep their existing sources until you connect a new repository.')
      await queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey })
    },
  })

  const connected = Boolean(project.repository_full_name)
  return (
    <Panel title="Source repository">
      <form
        className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[1fr_260px_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
      >
        <SelectInput label="GitHub repository" value={repositoryKey} onChange={setRepositoryKey}>
          <option value="" disabled>Select repository</option>
          {repoOptions.map((repository) => (
            <option key={repositoryNameKey(repository)} value={repositoryNameKey(repository)}>
              {repository.repository}
            </option>
          ))}
        </SelectInput>
        <div className="flex items-end gap-2">
          <div className="min-w-0 flex-1">
            <TextInput
              label="Branch to deploy"
              value={branch}
              onChange={setBranch}
              placeholder={selectedRepo?.branch || 'main'}
              list="project-repository-branches"
            />
            <datalist id="project-repository-branches">
              {branches.map((name) => <option key={name} value={name} />)}
            </datalist>
          </div>
          <Button
            type="button"
            variant="ghost"
            className="h-9 px-2"
            aria-label="Load branches"
            title="Load branches from GitHub"
            disabled={loadBranches.isPending || !selectedRepo}
            onClick={() => loadBranches.mutate()}
          >
            <RefreshCw className={`size-4 ${loadBranches.isPending ? 'animate-spin' : ''}`} aria-hidden="true" />
          </Button>
        </div>
        <div className="flex items-end gap-2">
          <Button variant="primary" disabled={save.isPending || !selectedRepo}>
            {save.isPending ? 'Saving...' : connected ? 'Update source' : 'Connect repository'}
          </Button>
          {connected && (
            <Button type="button" variant="ghost" disabled={disconnect.isPending} onClick={() => disconnect.mutate()}>
              Disconnect
            </Button>
          )}
        </div>
      </form>
      <div className="border-t px-4 py-3 text-sm text-muted">
        {connected
          ? <>Deploys build from <span className="font-mono text-xs text-ink">{project.repository_full_name}#{project.repository_branch}</span>. Change the branch here to deploy a different one.</>
          : repoOptions.length > 0
            ? 'Connect the repository this project deploys from, then pick the services inside it on the Services tab.'
            : 'No GitHub repositories available. Install the GitHub app on the Connectors page first.'}
      </div>
      {(loadBranches.error || save.error || disconnect.error) && (
        <div className="border-t px-4 py-3">
          <InlineError message={loadBranches.error?.message ?? save.error?.message ?? disconnect.error?.message ?? 'Repository update failed.'} />
        </div>
      )}
    </Panel>
  )
}

function ProjectSetupPath({
  project,
  environments,
  applications,
  proxyRoutes,
}: {
  project: Project
  environments: Environment[]
  applications: Application[]
  proxyRoutes: ProxyRouteRecord[]
}) {
  const production = environments.find((environment) => environment.kind === 'production')
  const activeServices = applications.filter((application) => application.status === 'healthy' || application.status === 'deploying')
  return (
    <Panel title="Setup path">
      <div className="divide-y">
        <SetupAction
          icon={GitBranch}
          label="Source repository"
          value={project.repository_full_name ? `${project.repository_full_name}#${project.repository_branch ?? 'main'}` : 'not connected'}
          action="Connect"
          href="#overview"
          complete={Boolean(project.repository_full_name)}
        />
        <SetupAction
          icon={Server}
          label="Services"
          value={`${activeServices.length} active / ${applications.length} service${applications.length === 1 ? '' : 's'}`}
          action="Deploy"
          href="#services"
          complete={applications.length > 0}
        />
        <SetupAction
          icon={ShieldCheck}
          label="Production environment"
          value={production ? production.name : 'not created'}
          action="Manage"
          href="#environments"
          complete={Boolean(production)}
        />
        <SetupAction
          icon={Container}
          label="Artifact registry"
          value={project.default_registry_name ?? 'not configured'}
          action="Configure"
          href="#registry"
          complete={Boolean(project.default_registry_id)}
        />
        <SetupAction
          icon={Globe2}
          label="Routes"
          value={proxyRoutes.length ? proxyRoutes.map((route) => route.domain).join(', ') : 'not routed'}
          action="Route"
          href="#routes"
          complete={proxyRoutes.length > 0}
        />
      </div>
    </Panel>
  )
}

function SetupAction({ icon: Icon, label, value, action, href, complete }: { icon: typeof Server, label: string, value: string, action: string, href: string, complete: boolean }) {
  return (
    <div className="flex items-center gap-3 px-4 py-3 text-sm">
      <div className={`flex size-8 shrink-0 items-center justify-center rounded-md border ${complete ? 'bg-success/10 text-success' : 'bg-background text-muted'}`}>
        <Icon className="size-4" aria-hidden="true" />
      </div>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{label}</span>
          <Badge tone={complete ? 'success' : 'neutral'}>{complete ? 'done' : 'needed'}</Badge>
        </div>
        <div className="mt-0.5 truncate text-muted">{value}</div>
      </div>
      <a href={href} className="inline-flex h-8 items-center rounded-md border bg-background px-3 text-xs font-medium text-ink hover:bg-panel">
        {action}
      </a>
    </div>
  )
}

function ProjectServicesSection({
  project,
  environments,
  applications,
  servers,
  githubRepositories,
}: {
  project: Project
  environments: Environment[]
  applications: Application[]
  servers: ServerRecord[]
  githubRepositories: GitHubRepository[]
}) {
  return (
    <div className="space-y-5">
      {project.repository_full_name
        ? (
            <ProjectRepositoryDeploy
              project={project}
              environments={environments}
              applications={applications}
              servers={servers}
            />
          )
        : <ProjectSourcePanel project={project} githubRepositories={githubRepositories} />}
      <ManualServicePlacement project={project} environments={environments} servers={servers} githubRepositories={githubRepositories} />
      <ServiceList applications={applications} />
    </div>
  )
}

// ProjectRepositoryDeploy detects deployable services inside the connected
// repository (monorepo folders with a compose file) and creates the selected
// ones on a chosen environment and server.
function ProjectRepositoryDeploy({
  project,
  environments,
  applications,
  servers,
}: {
  project: Project
  environments: Environment[]
  applications: Application[]
  servers: ServerRecord[]
}) {
  const queryClient = useQueryClient()
  const [environmentID, setEnvironmentID] = useState(environments.find((environment) => environment.kind === 'production')?.id ?? environments[0]?.id ?? '')
  const [serverID, setServerID] = useState(servers[0]?.id ?? '')
  const [detectedServices, setDetectedServices] = useState<GitHubDetectedService[]>([])
  const [selectedServices, setSelectedServices] = useState<Set<string>>(new Set())
  const existingNames = new Set(applications.filter((application) => application.environment_id === environmentID).map((application) => application.name))

  const detect = useMutation({
    mutationFn: () => detectGitHubRepositoryServices({
      connector_id: project.repository_connector_id ?? '',
      repository: project.repository_full_name ?? '',
      branch: project.repository_branch ?? 'main',
    }),
    onSuccess: (result) => {
      setDetectedServices(result.services)
      setSelectedServices(new Set(result.services.map((service) => service.name)))
    },
  })
  const importServices = useMutation({
    mutationFn: () => {
      const services = detectedServices.filter((service) => selectedServices.has(service.name))
      if (!environmentID || !serverID || services.length === 0) {
        throw new Error('Select an environment, a server, and at least one service.')
      }
      return importGitHubRepositoryServices(project.id, {
        connector_id: project.repository_connector_id ?? '',
        repository: project.repository_full_name ?? '',
        branch: project.repository_branch ?? 'main',
        environment_id: environmentID,
        server_id: serverID,
        services: services.map((service) => service.name),
      })
    },
    onSuccess: async (result) => {
      setDetectedServices([])
      setSelectedServices(new Set())
      toast.success(`${result.applications.length} service${result.applications.length === 1 ? '' : 's'} created`, 'Build targets were registered on the GitHub connector. Trigger the first deploy from the service row.')
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: githubRepositoriesQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
      ])
    },
  })

  return (
    <Panel title={`Deploy from ${project.repository_full_name}#${project.repository_branch ?? 'main'}`}>
      <div className="grid gap-4 p-4 lg:grid-cols-[1fr_auto]">
        <div className="grid gap-3 md:grid-cols-2">
          <SelectInput label="Environment" value={environmentID} onChange={setEnvironmentID}>
            <option value="" disabled>Select environment</option>
            {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
          </SelectInput>
          <SelectInput label="Server" value={serverID} onChange={setServerID}>
            <option value="" disabled>Select server</option>
            {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
          </SelectInput>
        </div>
        <div className="flex items-end gap-2">
          <Button type="button" variant="ghost" disabled={detect.isPending} onClick={() => detect.mutate()}>
            {detect.isPending ? 'Scanning repository...' : 'Detect services'}
          </Button>
          <Button
            type="button"
            variant="primary"
            disabled={importServices.isPending || selectedServices.size === 0 || !environmentID || !serverID}
            onClick={() => importServices.mutate()}
          >
            {importServices.isPending
              ? 'Deploying...'
              : selectedServices.size > 0
                ? `Deploy ${selectedServices.size} service${selectedServices.size === 1 ? '' : 's'}`
                : 'Deploy services'}
          </Button>
        </div>
      </div>
      {detectedServices.length > 0 && (
        <div className="border-t p-4">
          <div className="mb-3 text-sm font-medium text-ink">Services found in this repository</div>
          <div className="grid gap-2 md:grid-cols-3">
            {detectedServices.map((service) => (
              <label key={service.name} className="flex items-start gap-3 rounded-md border bg-background p-3 text-sm">
                <input
                  className="mt-1"
                  type="checkbox"
                  checked={selectedServices.has(service.name)}
                  onChange={(event) => setSelectedServices((current) => {
                    const next = new Set(current)
                    if (event.target.checked) next.add(service.name)
                    else next.delete(service.name)
                    return next
                  })}
                />
                <span className="min-w-0">
                  <span className="flex items-center gap-2">
                    <span className="block truncate font-medium text-ink">{service.name}</span>
                    {existingNames.has(service.name) && <Badge tone="warning">exists</Badge>}
                  </span>
                  <span className="mt-1 block truncate font-mono text-xs text-muted">{service.compose_path}</span>
                </span>
              </label>
            ))}
          </div>
        </div>
      )}
      {detect.isSuccess && detectedServices.length === 0 && (
        <div className="border-t px-4 py-3 text-sm text-muted">
          No compose services detected. Each deployable service needs a folder with a docker-compose file.
        </div>
      )}
      <div className="border-t px-4 py-3 text-sm text-muted">
        Several services from one repository can share a single server. Each one becomes its own compose stack with an independent deploy lifecycle.
      </div>
      {(detect.error || importServices.error) && (
        <div className="border-t px-4 py-3">
          <InlineError message={detect.error?.message ?? importServices.error?.message ?? 'GitHub deploy failed.'} />
        </div>
      )}
    </Panel>
  )
}

function ManualServicePlacement({
  project,
  environments,
  servers,
  githubRepositories,
}: {
  project: Project
  environments: Environment[]
  servers: ServerRecord[]
  githubRepositories: GitHubRepository[]
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ServiceForm>(defaultServiceForm(environments[0]?.id, servers[0]?.id))
  const [error, setError] = useState<string>()
  const [advancedOpen, setAdvancedOpen] = useState(false)
  const create = useMutation({
    mutationFn: () => createApplication(serviceInput(form)),
    onSuccess: async () => {
      setForm((state) => defaultServiceForm(state.environment_id, state.server_id))
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })
  const projectEnvironmentIDs = new Set(environments.map((environment) => environment.id))
  const validEnvironmentID = projectEnvironmentIDs.has(form.environment_id) ? form.environment_id : environments[0]?.id ?? ''
  const selectedEnvironment = environments.find((environment) => environment.id === validEnvironmentID)
  const selectedRepository = githubRepositories.find((repository) => repository.clone_url === form.repository_url)
  return (
    <Panel title="Add service manually">
      <form
        className="grid gap-3 p-4 md:grid-cols-2 xl:grid-cols-[180px_220px_1fr_220px_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          setError(undefined)
          try {
            validateServiceForm({ ...form, environment_id: validEnvironmentID })
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Service placement is invalid.')
            return
          }
          create.mutate()
        }}
      >
        <SelectInput
          label="Environment"
          value={validEnvironmentID}
          onChange={(environment_id) => {
            const nextEnvironment = environments.find((environment) => environment.id === environment_id)
            setForm((state) => ({
              ...state,
              environment_id,
              remote_directory: state.name ? serviceRemoteDirectory(project, nextEnvironment, state.name) : state.remote_directory,
            }))
          }}
          required
        >
          <option value="" disabled>Select environment</option>
          {environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}
        </SelectInput>
        <SelectInput label="Server" value={form.server_id} onChange={(server_id) => setForm((state) => ({ ...state, server_id }))} required>
          <option value="" disabled>Select server</option>
          {servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}
        </SelectInput>
        <SelectInput
          label="GitHub repo"
          value={selectedRepository?.clone_url ?? ''}
          onChange={(cloneURL) => {
            const repository = githubRepositories.find((item) => item.clone_url === cloneURL)
            setForm((state) => ({
              ...state,
              repository_url: repository?.clone_url ?? state.repository_url,
              branch: repository?.branch ?? state.branch,
            }))
          }}
        >
          <option value="">Manual repo URL</option>
          {githubRepositories.map((repository) => (
            <option key={`${repository.connector_id}:${repository.repository}:${repository.branch}`} value={repository.clone_url}>
              {repository.repository}#{repository.branch}
            </option>
          ))}
        </SelectInput>
        <TextInput
          label="Service"
          value={form.name}
          onChange={(name) => setForm((state) => ({
            ...state,
            name,
            remote_directory: serviceRemoteDirectory(project, selectedEnvironment, name),
          }))}
          placeholder={project.slug}
          required
        />
        <div className="flex items-end gap-2">
          <Button variant="primary" disabled={create.isPending || !validEnvironmentID || !form.server_id || !form.name || !form.remote_directory}>{create.isPending ? 'Saving...' : 'Add'}</Button>
          <Button type="button" variant="ghost" onClick={() => setAdvancedOpen((open) => !open)}>Advanced</Button>
        </div>
        {advancedOpen && (
          <>
            <TextInput label="Repository URL" value={form.repository_url} onChange={(repository_url) => setForm((state) => ({ ...state, repository_url }))} placeholder="https://github.com/org/recreate.git" />
            <TextInput label="Remote directory" value={form.remote_directory} onChange={(remote_directory) => setForm((state) => ({ ...state, remote_directory }))} required placeholder="/srv/deploy-manager/apps/production/recreate" />
            <TextInput label="Branch" value={form.branch} onChange={(branch) => setForm((state) => ({ ...state, branch }))} />
            <TextInput label="Compose path" value={form.compose_path} onChange={(compose_path) => setForm((state) => ({ ...state, compose_path }))} />
            <TextInput label="Domain" value={form.domain} onChange={(domain) => setForm((state) => ({ ...state, domain }))} />
            <TextInput label="Health check URL" value={form.health_check_url} onChange={(health_check_url) => setForm((state) => ({ ...state, health_check_url }))} placeholder="http://127.0.0.1:{port}/healthz" />
            <TextInput label="Doppler project" value={form.doppler_project} onChange={(doppler_project) => setForm((state) => ({ ...state, doppler_project }))} />
            <TextInput label="Doppler config" value={form.doppler_config} onChange={(doppler_config) => setForm((state) => ({ ...state, doppler_config }))} />
          </>
        )}
      </form>
      <div className="border-t px-4 py-3 text-sm text-muted">One service is one compose stack in one environment on one server.</div>
      {(error || create.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? create.error?.message ?? 'Service placement could not be saved.'} /></div>}
    </Panel>
  )
}

function ServiceList({ applications }: { applications: Application[] }) {
  const queryClient = useQueryClient()
  const remove = useMutation({
    mutationFn: deleteApplication,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })
  const deploy = useMutation({
    mutationFn: (application: Application) => createDeployment({ application_id: application.id, trigger: 'manual' }),
    onSuccess: async (_deployment, application) => {
      toast.success(`Deployment queued for ${application.name}`, 'Follow progress on the Deployments page.')
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
    onError: (error, application) => {
      toast.error(`Could not deploy ${application.name}`, error.message)
    },
  })
  return (
    <Panel title="Services">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Service</th>
              <th className="px-4 py-3 font-medium">Environment</th>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Branch</th>
              <th className="px-4 py-3 font-medium">Route</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actions</th>
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
                <td className="px-4 py-3 font-mono text-xs text-muted">{application.branch}</td>
                <td className="px-4 py-3 text-muted">{application.domain ?? 'not routed'}</td>
                <td className="px-4 py-3"><Badge tone={statusTone(application.status)}>{application.status}</Badge></td>
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2"
                      aria-label={`Deploy service ${application.name}`}
                      title="Queue a deployment for this service"
                      disabled={deploy.isPending || application.status === 'deploying'}
                      onClick={() => deploy.mutate(application)}
                    >
                      <Rocket className="size-4" />
                      Deploy
                    </Button>
                    <Button
                      type="button"
                      variant="ghost"
                      className="h-8 px-2 text-danger"
                      aria-label={`Delete service ${application.name}`}
                      onClick={() => {
                        if (window.confirm(`Delete service ${application.name}?`)) {
                          remove.mutate(application.id)
                        }
                      }}
                    >
                      <Trash2 className="size-4" />
                    </Button>
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {applications.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No services in this project yet. Deploy some from the repository above.</div>}
      {remove.error && <div className="border-t px-4 py-3"><InlineError message={remove.error.message} /></div>}
    </Panel>
  )
}

function ProjectEnvironments({ project, environments, applications }: { project: Project, environments: Environment[], applications: Application[] }) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<EnvironmentForm>(defaultEnvironmentForm())
  const [error, setError] = useState<string>()
  const [advancedOpen, setAdvancedOpen] = useState(false)
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
      <Panel title="Create environment">
        <form
          className="grid gap-3 p-4 md:grid-cols-[1fr_170px_auto]"
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
          <TextInput label="Environment" value={form.name} onChange={(name) => setForm((state) => ({ ...state, name, slug: slugify(name) }))} required placeholder="production" />
          <SelectInput label="Type" value={form.kind} onChange={(kind) => setForm((state) => ({ ...state, kind: kind as EnvironmentForm['kind'] }))}>
            <option value="production">Production</option>
            <option value="development">Development</option>
            <option value="preview">PR preview</option>
          </SelectInput>
          <div className="flex items-end gap-2">
            <Button variant="primary" disabled={create.isPending || !form.name || !form.slug}>{create.isPending ? 'Saving...' : 'Add'}</Button>
            <Button type="button" variant="ghost" onClick={() => setAdvancedOpen((open) => !open)}>Advanced</Button>
          </div>
          {advancedOpen && (
            <>
              <TextInput label="Slug" value={form.slug} onChange={(slug) => setForm((state) => ({ ...state, slug }))} required />
              <TextInput label="Branch" value={form.branch} onChange={(branch) => setForm((state) => ({ ...state, branch }))} placeholder="main" />
              <TextInput label="PR" value={form.pull_request_number} onChange={(pull_request_number) => setForm((state) => ({ ...state, pull_request_number }))} placeholder="42" />
            </>
          )}
        </form>
        {(error || create.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? create.error?.message ?? 'Environment could not be saved.'} /></div>}
      </Panel>
      <EnvironmentBoard title="Environments" environments={environments} applications={applications} />
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
    onSuccess: async (route) => {
      toast.success(`Route ${route.domain ?? ''} applied`.trim())
      await queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey })
    },
  })
  const remove = useMutation({
    mutationFn: deleteProxyRoute,
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
            label="Service"
            value={form.application_id}
            onChange={(application_id) => {
              const app = applications.find((item) => item.id === application_id)
              setForm((state) => ({ ...state, application_id, domain: app?.domain ?? state.domain }))
            }}
          >
            <option value="" disabled>Select service</option>
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
                <th className="px-4 py-3 font-medium">Service</th>
                <th className="px-4 py-3 font-medium">Upstream</th>
                <th className="px-4 py-3 font-medium">Status</th>
                <th className="px-4 py-3 font-medium">Actions</th>
              </tr>
            </thead>
            <tbody>
              {routes.map((route) => (
                <tr key={route.id} className="border-t">
                  <td className="px-4 py-3 font-medium">{route.domain}</td>
                  <td className="px-4 py-3 text-muted">{route.application_name ?? 'unlinked service'}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{route.upstream_url}</td>
                  <td className="px-4 py-3"><Badge tone={statusTone(route.status)}>{route.status}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="flex items-center gap-2">
                      <Button variant="ghost" disabled={apply.isPending || route.proxy_type === 'none'} onClick={() => apply.mutate(route.id)}>Apply</Button>
                      <Button
                        type="button"
                        variant="ghost"
                        className="h-8 px-2 text-danger"
                        aria-label={`Delete route ${route.domain}`}
                        onClick={() => {
                          if (window.confirm(`Delete route ${route.domain}?`)) {
                            remove.mutate(route.id)
                          }
                        }}
                      >
                        <Trash2 className="size-4" />
                      </Button>
                    </div>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {routes.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No routes for this project.</div>}
        {(apply.error || remove.error) && <div className="border-t px-4 py-3"><InlineError message={apply.error?.message ?? remove.error?.message ?? 'Route action failed.'} /></div>}
      </Panel>
    </div>
  )
}

function ProjectSettings({ project }: { project: Project }) {
  const queryClient = useQueryClient()
  const navigate = useNavigate()
  const [form, setForm] = useState(() => projectToForm(project))
  const [error, setError] = useState<string>()
  const save = useMutation({
    mutationFn: () => updateProject(project.id, projectUpdateInput(form)),
    onSuccess: async () => {
      setError(undefined)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
      ])
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteProject(project.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey }),
      ])
      toast.info(`Project ${project.name} deleted`)
      void navigate({ to: '/projects' })
    },
  })

  useEffect(() => {
    setForm(projectToForm(project))
    setError(undefined)
  }, [project.id, project.name, project.slug, project.description])

  return (
    <div className="space-y-5">
      <Panel title="Project identity">
        <form
          className="grid gap-3 p-4 md:grid-cols-2"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            try {
              validateProjectForm(form)
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Project is invalid.')
              return
            }
            save.mutate()
          }}
        >
          <TextInput label="Project name" value={form.name} onChange={(name) => setForm((state) => ({ ...state, name }))} required />
          <TextInput label="Slug" value={form.slug} onChange={(slug) => setForm((state) => ({ ...state, slug }))} required />
          <label className="space-y-1 text-xs text-muted md:col-span-2">
            <span>Description</span>
            <textarea
              className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
              value={form.description}
              onChange={(event) => setForm((state) => ({ ...state, description: event.target.value }))}
              placeholder="What this project owns and where it deploys"
            />
          </label>
          <div className="md:col-span-2">
            <Button variant="primary" disabled={save.isPending || !form.name || !form.slug}>
              {save.isPending ? 'Saving...' : 'Save changes'}
            </Button>
          </div>
        </form>
        {(error || save.error) && <div className="border-t px-4 py-3"><InlineError message={error ?? save.error?.message ?? 'Project could not be updated.'} /></div>}
      </Panel>
      <Panel title="Project details">
        <div className="grid gap-4 p-4 lg:grid-cols-2">
          <ProjectSignal icon={Settings} label="Project ID" value={project.id} />
          <ProjectSignal icon={Container} label="Default registry" value={project.default_registry_name ?? 'not configured'} />
        </div>
      </Panel>
      <Panel title="Danger zone">
        <div className="flex flex-wrap items-center justify-between gap-3 p-4">
          <p className="max-w-2xl text-sm leading-6 text-muted">
            Deleting a project only works once its services are removed. Environments are deleted with it.
          </p>
          <Button
            type="button"
            variant="ghost"
            className="text-danger"
            disabled={remove.isPending}
            aria-label={`Delete project ${project.name}`}
            onClick={() => {
              if (window.confirm(`Delete ${project.name}? This only works when no services depend on it.`)) {
                remove.mutate()
              }
            }}
          >
            <Trash2 className="size-4" />
            Delete project
          </Button>
        </div>
        {remove.error && <div className="border-t px-4 py-3"><InlineError message={remove.error.message} /></div>}
      </Panel>
    </div>
  )
}

function EnvironmentBoard({ title = 'Environments', environments, applications }: { title?: string, environments: Environment[], applications: Application[] }) {
  const queryClient = useQueryClient()
  const removeEnvironment = useMutation({
    mutationFn: deleteEnvironment,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey })
    },
  })
  const removeApplication = useMutation({
    mutationFn: deleteApplication,
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })
  if (environments.length === 0) {
    return <Panel><div className="p-5 text-sm text-muted">No environments yet. Add production first, then development or PR previews.</div></Panel>
  }
  return (
    <Panel title={title}>
      <div className="grid gap-3 p-4 xl:grid-cols-3">
        {environmentOrder(environments).map((environment) => (
          <EnvironmentColumn
            key={environment.id}
            environment={environment}
            applications={applications.filter((application) => application.environment_id === environment.id)}
            onDeleteEnvironment={() => {
              if (window.confirm(`Delete ${environment.name}? Remove services first.`)) {
                removeEnvironment.mutate(environment.id)
              }
            }}
            onDeleteApplication={(application) => {
              if (window.confirm(`Delete service ${application.name}?`)) {
                removeApplication.mutate(application.id)
              }
            }}
          />
        ))}
      </div>
      {(removeEnvironment.error || removeApplication.error) && (
        <div className="border-t px-4 py-3">
          <InlineError message={removeEnvironment.error?.message ?? removeApplication.error?.message ?? 'Delete failed.'} />
        </div>
      )}
    </Panel>
  )
}

function EnvironmentColumn({ environment, applications, onDeleteEnvironment, onDeleteApplication }: { environment: Environment, applications: Application[], onDeleteEnvironment: () => void, onDeleteApplication: (application: Application) => void }) {
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
        <div className="flex items-center gap-2">
          <div className="text-xs text-muted">{applications.length} service{applications.length === 1 ? '' : 's'}</div>
          <Button type="button" variant="ghost" className="h-8 px-2 text-danger" aria-label={`Delete environment ${environment.name}`} onClick={onDeleteEnvironment}>
            <Trash2 className="size-4" />
          </Button>
        </div>
      </header>
      <div className="divide-y">
        {applications.map((application) => <ApplicationRow key={application.id} application={application} onDelete={() => onDeleteApplication(application)} />)}
        {applications.length === 0 && <div className="px-3 py-4 text-sm text-muted">No services in this environment.</div>}
      </div>
    </section>
  )
}

function ApplicationRow({ application, onDelete }: { application: Application, onDelete: () => void }) {
  return (
    <div className="space-y-3 px-3 py-3">
      <div className="flex items-start justify-between gap-3">
        <div className="min-w-0">
          <div className="truncate text-sm font-medium">{application.name}</div>
          <div className="truncate text-xs text-muted">{application.repository_url ?? 'manual compose source'}</div>
        </div>
        <div className="flex items-center gap-2">
          <Badge tone={statusTone(application.status)}>{application.status}</Badge>
          <Button type="button" variant="ghost" className="h-8 px-2 text-danger" aria-label={`Delete service ${application.name}`} onClick={onDelete}>
            <Trash2 className="size-4" />
          </Button>
        </div>
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
  return { name: 'production', slug: 'production', kind: 'production', pull_request_number: '', branch: 'main' }
}

function defaultServiceForm(environmentID = '', serverID = ''): ServiceForm {
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

// Repositories are connected by name; branch choice lives on the project, so
// options are deduped ignoring the connector's per-branch entries.
function uniqueRepositoryNames(repositories: GitHubRepository[]): GitHubRepository[] {
  const seen = new Set<string>()
  const unique: GitHubRepository[] = []
  for (const repository of repositories) {
    const key = repositoryNameKey(repository)
    if (seen.has(key)) continue
    seen.add(key)
    unique.push(repository)
  }
  return unique
}

function repositoryNameKey(repository: GitHubRepository): string {
  return `${repository.connector_id}:${repository.repository}`
}

function projectRepositoryKey(project: Project, repositories: GitHubRepository[]): string {
  if (!project.repository_full_name) return ''
  const match = repositories.find((repository) =>
    repository.repository.toLowerCase() === project.repository_full_name?.toLowerCase()
    && (!project.repository_connector_id || repository.connector_id === project.repository_connector_id))
  return match ? repositoryNameKey(match) : ''
}

function projectToForm(project: Project): { name: string, slug: string, description: string } {
  return {
    name: project.name,
    slug: project.slug,
    description: project.description,
  }
}

function projectUpdateInput(form: { name: string, slug: string, description: string }): UpdateProjectInput {
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

function serviceInput(form: ServiceForm): CreateApplicationInput {
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
    github_auto_deploy: Boolean(optionalTrimmed(form.repository_url)),
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

function validateProjectForm(form: { name: string, slug: string }): void {
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

function validateServiceForm(form: ServiceForm): void {
  if (!form.environment_id || !form.server_id || !form.name.trim() || !form.remote_directory.trim()) {
    throw new Error('Environment, server, service name, and remote directory are required.')
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
    throw new Error('Service is required.')
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

function serviceRemoteDirectory(project: Project, environment: Environment | undefined, serviceName: string): string {
  const envSlug = environment?.slug || 'environment'
  const serviceSlug = slugify(serviceName) || project.slug
  return `/srv/deploy-manager/apps/${envSlug}/${serviceSlug}`
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
  if (value === 'targets') return 'services'
  return projectSections.includes(value as ProjectSection) ? value as ProjectSection : 'overview'
}
