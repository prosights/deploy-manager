import { useMutation, useQuery, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Link, useParams } from '@tanstack/react-router'
import * as DialogPrimitive from '@radix-ui/react-dialog'
import {
  Activity,
  ArrowLeft,
  ArrowRight,
  Check,
  ChevronDown,
  CircleAlert,
  Container,
  Ellipsis,
  ExternalLink,
  FileCode2,
  Github,
  Globe2,
  Hammer,
  History,
  MoveDiagonal2,
  Play,
  Plus,
  RefreshCw,
  RotateCcw,
  Search,
  Server,
  Settings,
  Trash2,
  X,
} from 'lucide-react'
import { useEffect, useMemo, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from '../components/ui/dropdown-menu'
import { InlineError } from '../components/ui/error-message'
import { SelectInput } from '../components/ui/select-input'
import { TextInput } from '../components/ui/text-input'
import { DeploymentLogStream, useDeploymentLogs } from '../features/deployments/logs'
import { ApplicationTerminal, applicationTerminalDirectory } from '../features/servers/components'
import { statusTone } from '../features/status'
import {
  applyProxyRoute,
  cancelDeployment,
  checkServer,
  createDeployment,
  createEnvironment,
  createProxyRoute,
  deleteApplication,
  deleteEnvironment,
  deleteProject,
  deleteProxyRoute,
  detectGitHubRepositoryServices,
  dispatchGitHubBuild,
  getGitHubRepositoryCompose,
  importGitHubRepositoryServices,
  listGitHubRepositoryBranches,
  listProjectRuntimeVariables,
  redeployApplicationConfiguration,
  redeployProjectConfiguration,
  replaceApplicationServiceRuntimeConfig,
  replaceProjectRuntimeVariables,
  retryDeployment,
  rollbackApplication,
  updateApplication,
  updateProject,
  updateProjectRegistry,
  type Application,
  type ApplicationServiceRuntimeConfig,
  type BuildRun,
  type ComposeService,
  type ContainerRegistry,
  type Deployment,
  type DeploymentLog,
  type Environment,
  type GitHubIntegrationStatus,
  type GitHubCommitMetadata,
  type GitHubDetectedService,
  type GitHubRepository,
  type Project,
  type ProjectRuntimeVariable,
  type ProxyRoute,
  type Server as ServerRecord,
  type UpdateApplicationInput,
} from '../lib/api'
import { cn } from '../lib/cn'
import {
  applicationServiceRuntimeConfigsQuery,
  applicationsQuery,
  buildRunsQuery,
  containerRegistriesQuery,
  deploymentsQuery,
  deploymentSlotsQuery,
  dopplerConfigsQuery,
  dopplerProjectsQuery,
  environmentsQuery,
  githubRepositoriesQuery,
  githubCommitQuery,
  githubStatusQuery,
  projectsQuery,
  proxyRoutesQuery,
  serversQuery,
} from '../lib/queries'
import { validateHealthCheckURL } from '../lib/urls'

const stackRuntimeConfigName = '__stack__'

type ServiceTab = 'deployments' | 'variables' | 'metrics' | 'console' | 'settings'
type DeploymentTab = 'details' | 'build-logs' | 'deploy-logs'
type NodePosition = { x: number, y: number }
type NodeLayout = NodePosition & { width?: number, height?: number }
type NodeSize = { width: number, height: number }

const deploymentHistoryPageSize = 10

type ServiceForm = {
  environment_id: string
  server_id: string
  name: string
  repository_url: string
  branch: string
  compose_path: string
  remote_directory: string
  health_check_url: string
  github_auto_deploy: boolean
  service_execution_modes: Record<string, 'follow_stack' | 'singleton'>
}

type ConfigurationSnapshot = {
  application_revision?: number
  project_revision?: number
  repository_url?: string | null
  branch?: string
  compose_path?: string
  health_check_url?: string | null
  doppler_project?: string | null
  doppler_config?: string | null
  configuration_state?: DeploymentConfigurationState
}

type DeploymentConfigurationState = {
  application?: {
    compose_services?: ComposeService[]
  }
  project_variables?: ProjectRuntimeVariable[]
  service_runtime_configs?: Array<{
    compose_service: string
    doppler_project?: string | null
    doppler_config?: string | null
    variables?: ProjectRuntimeVariable[]
  }>
}

const architectureGridSize = 22
const architectureNodeWidth = 252
const architectureNodeMinWidth = 220
const architectureNodeMinHeight = 148
const serviceTabs: Array<{ id: ServiceTab, label: string }> = [
  { id: 'deployments', label: 'Deployments' },
  { id: 'variables', label: 'Variables' },
  { id: 'metrics', label: 'Metrics' },
  { id: 'console', label: 'Console' },
  { id: 'settings', label: 'Settings' },
]
const deploymentTabs: Array<{ id: DeploymentTab, label: string }> = [
  { id: 'details', label: 'Details' },
  { id: 'build-logs', label: 'Build Logs' },
  { id: 'deploy-logs', label: 'Deploy Logs' },
]

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
    { data: githubStatus },
    { data: deployments },
    { data: buildRuns },
  ] = useSuspenseQueries({
    queries: [
      projectsQuery,
      environmentsQuery,
      applicationsQuery,
      serversQuery,
      containerRegistriesQuery,
      proxyRoutesQuery,
      githubRepositoriesQuery,
      githubStatusQuery,
      deploymentsQuery,
      buildRunsQuery,
    ],
  })
  const project = projects.find((item) => item.id === projectId)

  useEffect(() => {
    if (!window.location.hash) return
    const url = new URL(window.location.href)
    window.history.replaceState(null, '', `${url.pathname}${url.search}`)
  }, [])

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

  const projectEnvironments = environments.filter((environment) => environment.project_id === project.id)
  const projectApplications = applications.filter((application) => application.project_id === project.id)
  const applicationIDs = new Set(projectApplications.map((application) => application.id))

  return (
    <ProjectArchitecture
      key={project.id}
      project={project}
      environments={projectEnvironments}
      applications={projectApplications}
      deployments={deployments.filter((deployment) => applicationIDs.has(deployment.application_id))}
      buildRuns={buildRuns.filter((build) => !build.application_id || applicationIDs.has(build.application_id))}
      routes={proxyRoutes.filter((route) => Boolean(route.application_id && applicationIDs.has(route.application_id)))}
      servers={servers}
      registries={registries}
      githubRepositories={githubRepositories}
      githubStatus={githubStatus}
    />
  )
}

function ProjectArchitecture({
  project,
  environments,
  applications,
  deployments,
  buildRuns,
  routes,
  servers,
  registries,
  githubRepositories,
  githubStatus,
}: {
  project: Project
  environments: Environment[]
  applications: Application[]
  deployments: Deployment[]
  buildRuns: BuildRun[]
  routes: ProxyRoute[]
  servers: ServerRecord[]
  registries: ContainerRegistry[]
  githubRepositories: GitHubRepository[]
  githubStatus: GitHubIntegrationStatus
}) {
  const initialScope = workspaceScopeFromURL(applications, deployments)
  const initialApplication = applications.find((application) => application.id === initialScope.serviceID)
  const storedEnvironmentID = readSelectedEnvironmentID(project.id)
  const defaultEnvironmentID = initialApplication?.environment_id
    ?? environments.find((environment) => environment.id === storedEnvironmentID)?.id
    ?? environments.find((environment) => environment.kind === 'production')?.id
    ?? environments[0]?.id
    ?? ''
  const [environmentID, setEnvironmentID] = useState(defaultEnvironmentID)
  const [activeApplicationID, setActiveApplicationID] = useState(initialApplication?.id ?? '')
  const [activeDeploymentID, setActiveDeploymentID] = useState(initialScope.deploymentID)
  const [drawerOpen, setDrawerOpen] = useState(Boolean(initialApplication))
  const [createOpen, setCreateOpen] = useState(false)
  const [portsOpen, setPortsOpen] = useState(false)
  const [projectSettingsOpen, setProjectSettingsOpen] = useState(false)
  const [layouts, setLayouts] = useState<Record<string, NodeLayout>>(() => readNodeLayouts(project.id))
  const [canvasOffset, setCanvasOffset] = useState<NodePosition>(() => readCanvasOffset(project.id))
  const [canvasPanning, setCanvasPanning] = useState(false)
  const canvasRef = useRef<HTMLElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ pointerID: number, x: number, y: number, origin: NodePosition, offset: NodePosition } | undefined>(undefined)
  const selectedEnvironmentID = environments.some((environment) => environment.id === environmentID) ? environmentID : defaultEnvironmentID
  const selectedEnvironment = environments.find((environment) => environment.id === selectedEnvironmentID)
  const visibleApplications = applications.filter((application) => application.environment_id === selectedEnvironmentID)
  const activeApplication = applications.find((application) => application.id === activeApplicationID)
  const activeDeployments = activeApplication
    ? deployments.filter((deployment) => deployment.application_id === activeApplication.id)
    : []
  const activeDeployment = activeDeployments.find((deployment) => deployment.id === activeDeploymentID)
  const activeBuildRuns = activeApplication
    ? buildRuns.filter((build) => build.application_id === activeApplication.id)
    : []
  const activeRoutes = activeApplication
    ? routes.filter((route) => route.application_id === activeApplication.id)
    : []
  const activeServer = servers.find((server) => server.id === activeApplication?.server_id)
  const activeRepository = activeApplication
    ? githubRepositoryForApplication(activeApplication, githubRepositories)
    : undefined
  useEffect(() => {
    window.localStorage.setItem(nodePositionStorageKey(project.id), JSON.stringify(layouts))
  }, [layouts, project.id])

  useEffect(() => {
    window.localStorage.setItem(canvasOffsetStorageKey(project.id), JSON.stringify(canvasOffset))
  }, [canvasOffset, project.id])

  useEffect(() => {
    if (selectedEnvironmentID) window.localStorage.setItem(selectedEnvironmentStorageKey(project.id), selectedEnvironmentID)
  }, [project.id, selectedEnvironmentID])

  function selectEnvironment(environmentID: string) {
    setEnvironmentID(environmentID)
    if (drawerOpen) {
      setDrawerOpen(false)
      replaceWorkspaceQuery('')
    }
  }

  function selectApplication(application: Application) {
    setEnvironmentID(application.environment_id)
    setActiveApplicationID(application.id)
    setActiveDeploymentID('')
    setDrawerOpen(true)
    replaceWorkspaceQuery(application.id)
  }

  function selectDeployment(deploymentID: string, view: DeploymentTab = 'details') {
    setActiveDeploymentID(deploymentID)
    replaceWorkspaceQuery(activeApplicationID, deploymentID, view === 'details' ? undefined : view)
  }

  function closeDeployment() {
    setActiveDeploymentID('')
    replaceWorkspaceQuery(activeApplicationID)
  }

  function closeApplication() {
    setDrawerOpen(false)
    replaceWorkspaceQuery('')
  }

  function applyCanvasOffset(offset: NodePosition) {
    if (canvasRef.current) canvasRef.current.style.backgroundPosition = `${offset.x}px ${offset.y}px`
    if (worldRef.current) worldRef.current.style.transform = nodeTransform(offset)
  }

  function startCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || pan.current || (event.target instanceof Element && event.target.closest('button, a, input, select, textarea'))) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pan.current = { pointerID: event.pointerId, x: event.clientX, y: event.clientY, origin: canvasOffset, offset: canvasOffset }
    setCanvasPanning(true)
  }

  function moveCanvas(event: ReactPointerEvent<HTMLElement>) {
    const current = pan.current
    if (!current || current.pointerID !== event.pointerId) return
    current.offset = { x: current.origin.x + event.clientX - current.x, y: current.origin.y + event.clientY - current.y }
    applyCanvasOffset(current.offset)
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    const current = pan.current
    if (!current || current.pointerID !== event.pointerId) return
    pan.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setCanvasOffset(current.offset)
    setCanvasPanning(false)
  }

  function finishCanvasPanAfterCaptureLoss() {
    const current = pan.current
    if (!current) return
    pan.current = undefined
    setCanvasOffset(current.offset)
    setCanvasPanning(false)
  }

  function cancelCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    const current = pan.current
    if (!current || current.pointerID !== event.pointerId) return
    applyCanvasOffset(current.origin)
    pan.current = undefined
    setCanvasPanning(false)
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
          <SelectInput label="Environment" labelHidden className="w-44" value={selectedEnvironmentID} onChange={selectEnvironment}>
            {environmentOrder(environments).map((environment) => (
              <option key={environment.id} value={environment.id}>{environment.name}</option>
            ))}
          </SelectInput>
        </div>
        <div className="flex items-center gap-2">
          <Button type="button" className="h-8" onClick={() => setPortsOpen(true)}>
            <Server className="size-4" aria-hidden="true" />
            Service ports
          </Button>
          <Button type="button" size="icon" className="size-8" aria-label="Project settings" onClick={() => setProjectSettingsOpen(true)}>
            <Settings className="size-4" aria-hidden="true" />
          </Button>
          <Button type="button" variant="primary" className="h-8" onClick={() => setCreateOpen(true)}>
            <Plus className="size-4" aria-hidden="true" />
            Add service
          </Button>
        </div>
      </header>

      <section
        ref={canvasRef}
        className={cn('architecture-grid relative min-h-0 flex-1 touch-none select-none overflow-hidden', canvasPanning ? 'cursor-grabbing' : 'cursor-grab')}
        style={{ backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px` }}
        aria-labelledby="architecture-heading"
        onPointerDown={startCanvasPan}
        onPointerMove={moveCanvas}
        onPointerUp={finishCanvasPan}
        onPointerCancel={cancelCanvasPan}
        onLostPointerCapture={finishCanvasPanAfterCaptureLoss}
      >
        <h1 id="architecture-heading" className="sr-only">Architecture</h1>
        {visibleApplications.length > 0
          ? (
              <div ref={worldRef} className="architecture-world absolute inset-0 will-change-transform" style={{ transform: nodeTransform(canvasOffset) }}>
                {visibleApplications.map((application, index) => {
                  const layout = layouts[application.id] ?? defaultNodeLayout(index)
                  return (
                    <ArchitectureNode
                      key={application.id}
                      application={application}
                      routes={routes.filter((route) => route.application_id === application.id)}
                      layout={layout}
                      onChange={(next) => setLayouts((current) => ({ ...current, [application.id]: next }))}
                      onOpen={() => selectApplication(application)}
                    />
                  )
                })}
              </div>
            )
          : (
              <div className="absolute inset-0 flex items-center justify-center p-6">
                <div className="flex max-w-md flex-col items-center rounded-prosights-lg border border-prosights-border bg-prosights-surface px-8 py-7 text-center shadow-sm">
                  <div className="flex size-10 items-center justify-center rounded-prosights-md border border-prosights-border bg-prosights-surface-muted text-prosights-muted">
                    <Container className="size-5" aria-hidden="true" />
                  </div>
                  <h2 className="mt-4 text-[15px] font-semibold text-prosights-text">No services in {selectedEnvironment?.name ?? 'this environment'}</h2>
                  <p className="mt-1 text-[13px] leading-5 text-prosights-muted">Import from GitHub and Deploy Manager will find the compose file for you.</p>
                  <Button type="button" variant="primary" className="mt-4" onClick={() => setCreateOpen(true)}>
                    <Plus className="size-4" aria-hidden="true" /> Add service
                  </Button>
                </div>
              </div>
            )}
        {visibleApplications.length > 0 && <div className="pointer-events-none absolute bottom-3 left-3 rounded-prosights-md border border-prosights-border bg-prosights-surface/90 px-2.5 py-1.5 text-[10px] text-prosights-muted shadow-sm backdrop-blur-sm">Drag canvas to pan · drag cards to move · drag the corner to resize</div>}
      </section>

      <CreateApplicationDialog open={createOpen} onOpenChange={setCreateOpen}>
        <ApplicationCreateForm
          project={project}
          environments={environments}
          servers={servers}
          githubRepositories={githubRepositories}
          githubStatus={githubStatus}
          defaultEnvironmentID={selectedEnvironmentID}
          onCreated={() => setCreateOpen(false)}
        />
      </CreateApplicationDialog>

      <ProjectServicePortsDialog open={portsOpen} onOpenChange={setPortsOpen} applications={visibleApplications} routes={routes} />

      <ProjectSettingsDialog
        open={projectSettingsOpen}
        onOpenChange={setProjectSettingsOpen}
        project={project}
        environments={environments}
        applications={applications}
        registries={registries}
      />

      {activeApplication && (
        <ApplicationDrawer
          key={activeApplication.id}
          application={activeApplication}
          deployment={activeDeployment}
          deployments={activeDeployments}
          buildRuns={activeBuildRuns}
          repository={activeRepository}
          routes={activeRoutes}
          projectConfigurationRevision={project.configuration_revision}
          environments={environments}
          servers={servers}
          server={activeServer}
          open={drawerOpen}
          onSelectDeployment={selectDeployment}
          onBackToApplication={closeDeployment}
          onOpenChange={(open) => {
            if (open) setDrawerOpen(true)
            else closeApplication()
          }}
        />
      )}
    </div>
  )
}

function ArchitectureNode({
  application,
  routes,
  layout,
  onChange,
  onOpen,
}: {
  application: Application
  routes: ProxyRoute[]
  layout: NodeLayout
  onChange: (layout: NodeLayout) => void
  onOpen: () => void
}) {
  const drag = useRef<{ pointerID: number, x: number, y: number, origin: NodePosition, position: NodePosition, moved: boolean } | undefined>(undefined)
  const resize = useRef<{ pointerID: number, x: number, y: number, origin: NodeSize, size: NodeSize } | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    event.stopPropagation()
    const width = layout.width ?? architectureNodeWidth
    const height = layout.height ?? cardRef.current?.offsetHeight ?? architectureNodeMinHeight
    let next: NodeSize
    if (event.key === 'ArrowRight') next = { width: width + architectureGridSize, height }
    else if (event.key === 'ArrowLeft') next = { width: Math.max(architectureNodeMinWidth, width - architectureGridSize), height }
    else if (event.key === 'ArrowDown') next = { width, height: height + architectureGridSize }
    else if (event.key === 'ArrowUp') next = { width, height: Math.max(architectureNodeMinHeight, height - architectureGridSize) }
    else return
    event.preventDefault()
    onChange({ ...layout, ...next })
  }

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={`Open ${application.name}`}
      className="group absolute flex min-h-[148px] min-w-[220px] touch-none cursor-grab flex-col overflow-hidden rounded-[10px] border border-prosights-border bg-prosights-surface p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-150 hover:border-prosights-subtle hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] active:cursor-grabbing active:shadow-[0_12px_32px_rgba(0,0,0,0.10)]"
      style={{ transform: nodeTransform(layout), width: layout.width ?? architectureNodeWidth, height: layout.height }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0 || drag.current) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        const position = { x: layout.x, y: layout.y }
        drag.current = { pointerID: event.pointerId, x: event.clientX, y: event.clientY, origin: position, position, moved: false }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerID !== event.pointerId) return
        const deltaX = event.clientX - current.x
        const deltaY = event.clientY - current.y
        if (Math.abs(deltaX) + Math.abs(deltaY) > 4) current.moved = true
        current.position = {
          x: snapToGrid(current.origin.x + deltaX),
          y: snapToGrid(current.origin.y + deltaY),
        }
        event.currentTarget.style.transform = nodeTransform(current.position)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (!current || current.pointerID !== event.pointerId) return
        suppressClick.current = current.moved
        drag.current = undefined
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (current.moved) onChange({ ...layout, ...current.position })
      }}
      onLostPointerCapture={() => {
        const current = drag.current
        if (!current) return
        suppressClick.current = current.moved
        drag.current = undefined
        if (current.moved) onChange({ ...layout, ...current.position })
      }}
      onPointerCancel={(event) => {
        const current = drag.current
        if (!current || current.pointerID !== event.pointerId) return
        event.currentTarget.style.transform = nodeTransform(current.origin)
        drag.current = undefined
      }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        onOpen()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-prosights-md border border-prosights-border bg-prosights-surface-muted text-prosights-muted">
            <Github className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-prosights-text">{application.name}</h2>
            <ArchitectureRouteRows application={application} routes={routes} />
          </div>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-prosights-subtle opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-prosights-border pt-3 pr-3">
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-prosights-muted">
          <span className={cn('size-2 rounded-full', application.status === 'healthy' ? 'bg-success' : application.status === 'failed' ? 'bg-danger' : 'bg-prosights-subtle')} />
          {application.status}
        </span>
        <span className="max-w-28 truncate text-[11px] text-prosights-subtle">{application.server_name}</span>
      </div>
      <button
        type="button"
        aria-label={`Resize ${application.name}`}
        className="absolute bottom-0.5 right-0.5 flex size-6 cursor-nwse-resize items-center justify-center rounded-prosights-sm text-prosights-subtle opacity-60 transition-[color,opacity] duration-150 hover:text-prosights-text hover:opacity-100 focus-visible:text-prosights-text focus-visible:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.button !== 0 || resize.current) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          const origin = {
            width: cardRef.current?.offsetWidth || layout.width || architectureNodeWidth,
            height: cardRef.current?.offsetHeight || layout.height || architectureNodeMinHeight,
          }
          resize.current = { pointerID: event.pointerId, x: event.clientX, y: event.clientY, origin, size: origin }
        }}
        onPointerMove={(event) => {
          event.stopPropagation()
          const current = resize.current
          if (!current || current.pointerID !== event.pointerId) return
          current.size = {
            width: Math.max(architectureNodeMinWidth, current.origin.width + event.clientX - current.x),
            height: Math.max(architectureNodeMinHeight, current.origin.height + event.clientY - current.y),
          }
          if (cardRef.current) {
            cardRef.current.style.width = `${current.size.width}px`
            cardRef.current.style.height = `${current.size.height}px`
          }
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          const current = resize.current
          if (!current || current.pointerID !== event.pointerId) return
          resize.current = undefined
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          onChange({ ...layout, ...current.size })
        }}
        onLostPointerCapture={() => {
          const current = resize.current
          if (!current) return
          resize.current = undefined
          onChange({ ...layout, ...current.size })
        }}
        onPointerCancel={(event) => {
          event.stopPropagation()
          const current = resize.current
          if (!current || current.pointerID !== event.pointerId) return
          if (cardRef.current) {
            cardRef.current.style.width = `${current.origin.width}px`
            cardRef.current.style.height = `${current.origin.height}px`
          }
          resize.current = undefined
        }}
      >
        <MoveDiagonal2 className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

function ArchitectureRouteRows({ application, routes }: { application: Application, routes: ProxyRoute[] }) {
  const rows = architectureRouteRows(application, routes)
  return (
    <div className="mt-1 grid gap-0.5 text-[10px] leading-4 text-prosights-muted">
      {rows.map((row) => (
        <div key={`${row.label}:${row.url}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-1.5">
          <span className="font-mono text-prosights-subtle">{row.label}</span>
          {row.url.startsWith('http') ? (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className="truncate hover:text-prosights-text hover:underline"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {row.url}
            </a>
          ) : (
            <span className="truncate">{row.url}</span>
          )}
          {row.upstream
            ? <span title={`Active upstream ${row.upstream}`} className="font-mono text-prosights-subtle">{upstreamPortLabel(row.upstream)}</span>
            : row.port && <span title="Published host port" className="font-mono text-prosights-subtle">{row.port}</span>}
        </div>
      ))}
    </div>
  )
}

function ProjectServicePortsDialog({
  open,
  onOpenChange,
  applications,
  routes,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  applications: Application[]
  routes: ProxyRoute[]
}) {
  const rows = applications.flatMap((application) => {
    const composeServices = applicationComposeServices(application)
    const services: ComposeService[] = composeServices.length > 0 ? composeServices : [{ name: 'service' }]
    const applicationRoutes = routes.filter((route) => route.application_id === application.id)
    return services.map((service) => ({
      application,
      service,
      routes: composeServices.length === 0
        ? applicationRoutes
        : applicationRoutes.filter((route) => route.compose_service === service.name || (!route.compose_service && composeServices.length === 1)),
      scanned: composeServices.length > 0,
    }))
  })

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-6xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[12px] border border-prosights-border bg-prosights-surface shadow-[0_24px_80px_rgba(0,0,0,0.18)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out">
          <header className="flex shrink-0 items-start justify-between gap-4 border-b border-prosights-border px-5 py-4">
            <div>
              <DialogPrimitive.Title className="text-[15px] font-semibold text-prosights-text">Service ports</DialogPrimitive.Title>
              <DialogPrimitive.Description className="mt-1 text-[11px] text-prosights-muted">Every Compose service in the selected environment and where it is reachable.</DialogPrimitive.Description>
            </div>
            <DialogPrimitive.Close aria-label="Close service ports" className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted hover:bg-prosights-surface-muted hover:text-prosights-text"><X className="size-4" /></DialogPrimitive.Close>
          </header>
          <div className="min-h-0 overflow-auto">
            {rows.length > 0
              ? (
                  <table className="w-full min-w-[1040px] text-left text-[12px]">
                    <thead className="sticky top-0 z-10 border-b border-prosights-border bg-prosights-surface-muted text-[10px] uppercase tracking-wide text-prosights-subtle">
                      <tr>
                        <th className="px-4 py-2.5 font-medium">Application</th>
                        <th className="px-4 py-2.5 font-medium">Compose service</th>
                        <th className="px-4 py-2.5 font-medium">Container</th>
                        <th className="px-4 py-2.5 font-medium">Blue host</th>
                        <th className="px-4 py-2.5 font-medium">Green host</th>
                        <th className="px-4 py-2.5 font-medium">Active host</th>
                        <th className="px-4 py-2.5 font-medium">Access</th>
                      </tr>
                    </thead>
                    <tbody className="divide-y divide-prosights-border">
                      {rows.map((row) => (
                        <tr key={`${row.application.id}:${row.service.name}`} className="align-top">
                          <td className="px-4 py-3"><span className="font-medium text-prosights-text">{row.application.name}</span><span className="mt-0.5 block text-[10px] text-prosights-muted">{row.application.server_name}</span></td>
                          <td className="px-4 py-3 font-mono text-prosights-text">{row.service.name}</td>
                          <td className="px-4 py-3 font-mono text-prosights-muted">{row.scanned || row.routes.some((route) => route.container_port) ? composeContainerPorts(row.service, row.routes) : 'not scanned'}</td>
                          <td className="px-4 py-3 font-mono text-prosights-muted">{routeTargets(row.routes, 'blue_upstream_url')}</td>
                          <td className="px-4 py-3 font-mono text-prosights-muted">{routeTargets(row.routes, 'green_upstream_url')}</td>
                          <td className="px-4 py-3 font-mono text-prosights-muted">{activeServiceTargets(row.service, row.routes)}</td>
                          <td className="px-4 py-3 text-prosights-muted"><ServiceRouteLinks routes={row.routes} emptyLabel="Private" showServiceLabel={false} stacked /></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                )
              : <div className="px-5 py-10 text-center text-[12px] text-prosights-muted">No services in this environment.</div>}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

export function ApplicationDrawer({
  application,
  deployment,
  deployments,
  buildRuns,
  repository,
  routes,
  projectConfigurationRevision,
  environments,
  servers,
  server,
  open,
  onSelectDeployment,
  onBackToApplication,
  onOpenChange,
  projectHref,
}: {
  application: Application
  deployment?: Deployment
  deployments: Deployment[]
  buildRuns: BuildRun[]
  repository?: GitHubRepository
  routes: ProxyRoute[]
  projectConfigurationRevision: number
  environments: Environment[]
  servers: ServerRecord[]
  server?: ServerRecord
  open: boolean
  onSelectDeployment: (deploymentID: string, view?: DeploymentTab) => void
  onBackToApplication: () => void
  onOpenChange: (open: boolean) => void
  projectHref?: string
}) {
  const queryClient = useQueryClient()
  const initialView = new URLSearchParams(window.location.search).get('view')
  const [serviceTab, setServiceTab] = useState<ServiceTab>(isServiceTab(initialView) ? initialView : 'deployments')
  const [deploymentTab, setDeploymentTab] = useState<DeploymentTab>(isDeploymentTab(initialView) ? initialView : 'details')
  const metricsRefreshed = useRef(false)
  const { data: slots = [] } = useQuery(deploymentSlotsQuery(application.id))
  const activeDeploymentID = slots.find((slot) => slot.status === 'active')?.deployment_id
    ?? newestFirst(deployments).find((item) => item.status === 'succeeded')?.id
  const selectedDeploymentIsActive = Boolean(deployment && deployment.id === activeDeploymentID)
  const selectedDeploymentSlot = slots.find((slot) => slot.deployment_id === deployment?.id)

  function selectServiceTab(tab: ServiceTab) {
    setServiceTab(tab)
    replaceWorkspaceQuery(application.id, undefined, tab === 'deployments' ? undefined : tab)
    if (tab === 'metrics' && server && !metricsRefreshed.current) {
      metricsRefreshed.current = true
      void checkServer(server.id).finally(() => queryClient.invalidateQueries({ queryKey: serversQuery.queryKey }))
    }
  }

  function selectDeploymentTab(tab: DeploymentTab) {
    setDeploymentTab(tab)
    replaceWorkspaceQuery(application.id, deployment?.id, tab === 'details' ? undefined : tab)
  }

  function openDeployment(deploymentID: string, view: DeploymentTab = 'details') {
    setDeploymentTab(view)
    onSelectDeployment(deploymentID, view)
  }

  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/[0.04] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out" />
        <DialogPrimitive.Content className="fixed inset-y-3 right-3 z-50 flex w-[calc(100%-1.5rem)] max-w-[1240px] flex-col overflow-hidden rounded-[12px] border border-prosights-border bg-prosights-surface shadow-[0_24px_80px_rgba(0,0,0,0.20)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=closed]:slide-out-to-right-2 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out data-[state=open]:slide-in-from-right-2 sm:w-[min(68vw,1240px)]">
          <header className="shrink-0 border-b border-prosights-border px-7 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div key={`drawer-header-${deployment?.id ?? 'service'}`} className={cn('flex min-w-0 items-center gap-3 duration-150 motion-reduce:animate-none', deployment ? 'animate-in fade-in-0 slide-in-from-right-1' : 'animate-in fade-in-0 slide-in-from-left-1')}>
                <Github className="size-6 shrink-0 text-prosights-text" aria-hidden="true" />
                <div className="min-w-0">
                  {deployment
                    ? (
                        <div className="flex min-w-0 items-center gap-2">
                          {projectHref
                            ? <a href={projectHref} className="truncate text-[17px] font-semibold text-prosights-text hover:underline">{application.name}</a>
                            : <button type="button" className="truncate bg-transparent text-[17px] font-semibold text-prosights-text hover:underline" onClick={onBackToApplication}>{application.name}</button>}
                          <span className="text-prosights-subtle">/</span>
                          <DialogPrimitive.Title className="font-mono text-[15px] font-semibold text-prosights-text">{deployment.id.slice(0, 8)}</DialogPrimitive.Title>
                          <Badge tone={selectedDeploymentIsActive ? 'success' : statusTone(deployment.status)}>{selectedDeploymentIsActive ? 'Active' : deployment.status}</Badge>
                        </div>
                      )
                    : <DialogPrimitive.Title className="truncate text-[18px] font-semibold text-prosights-text">{application.name}</DialogPrimitive.Title>}
                  <DialogPrimitive.Description className="mt-1 text-[11px] text-prosights-muted">
                    <ServiceRouteLinks routes={routes} fallbackDomain={application.domain} emptyLabel={`${application.environment_name} / ${application.server_name}`} />
                  </DialogPrimitive.Description>
                </div>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                {deployment && (
                  <>
                    {projectHref && <Button asChild><a href={projectHref}>Go to project</a></Button>}
                    <DeploymentActionsMenu
                      application={application}
                      deployment={deployment}
                      hasStandby={slots.some((slot) => slot.status === 'standby')}
                      restartImageRef={selectedDeploymentSlot?.image_ref}
                      restartImageDigest={selectedDeploymentSlot?.image_digest}
                    />
                    <span className="hidden text-[11px] text-prosights-muted sm:inline">{formatDeploymentTime(deployment.created_at)}</span>
                  </>
                )}
                {deployment
                  ? projectHref
                    ? (
                        <DialogPrimitive.Close className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text" aria-label="Close deployment">
                          <X className="size-4" aria-hidden="true" />
                        </DialogPrimitive.Close>
                      )
                    : (
                      <button
                        type="button"
                        className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-prosights-md bg-transparent text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text"
                        aria-label="Back to service"
                        onClick={onBackToApplication}
                      >
                        <ArrowLeft className="size-4" aria-hidden="true" />
                      </button>
                      )
                  : (
                      <DialogPrimitive.Close className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text" aria-label="Close service">
                        <X className="size-4" aria-hidden="true" />
                      </DialogPrimitive.Close>
                    )}
              </div>
            </div>
            <DrawerTabs
              tabs={deployment ? deploymentTabs : serviceTabs}
              active={deployment ? deploymentTab : serviceTab}
              ariaLabel={deployment ? 'Deployment sections' : 'Service sections'}
              onSelect={(tab) => {
                if (deployment) selectDeploymentTab(tab as DeploymentTab)
                else selectServiceTab(tab as ServiceTab)
              }}
            />
          </header>
          <div key={`drawer-content-${deployment?.id ?? 'service'}`} className={cn('min-h-0 flex-1 overflow-auto bg-prosights-canvas duration-150 motion-reduce:animate-none', deployment ? 'animate-in fade-in-0 slide-in-from-right-1' : 'animate-in fade-in-0 slide-in-from-left-1')}>
            {deployment
              ? (
                  <DeploymentDetail
                    application={application}
                    deployment={deployment}
                    buildRuns={buildRuns}
                    routes={routes}
                    tab={deploymentTab}
                    onSelectTab={selectDeploymentTab}
                  />
                )
              : serviceTab === 'deployments'
                ? (
                    <ApplicationDeployments
                      application={application}
                      deployments={deployments}
                      buildRuns={buildRuns}
                      repository={repository}
                      routes={routes}
                      projectConfigurationRevision={projectConfigurationRevision}
                      onSelectDeployment={openDeployment}
                      onOpenSettings={() => selectServiceTab('settings')}
                    />
                  )
                : serviceTab === 'variables'
                  ? <ApplicationVariables application={application} />
                  : serviceTab === 'metrics'
                    ? <ApplicationMetrics deployments={deployments} server={server} />
                    : serviceTab === 'console'
                      ? (
                          <div className="space-y-4 p-6">
                            <div>
                              <h2 className="text-[14px] font-semibold text-prosights-text">Service console</h2>
                              <p className="mt-1 text-[12px] text-prosights-muted">Interactive shell in <span className="font-mono">{applicationTerminalDirectory(application)}</span> on {application.server_name}.</p>
                            </div>
                            <ApplicationTerminal server={server} application={application} active={serviceTab === 'console'} />
                          </div>
                        )
                      : (
                          <ApplicationSettings
                            application={application}
                            repository={repository}
                            routes={routes}
                            environments={environments}
                            servers={servers}
                            server={server}
                            onDeleted={() => onOpenChange(false)}
                          />
                        )}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function DrawerTabs({
  tabs,
  active,
  ariaLabel = 'Sections',
  onSelect,
}: {
  tabs: Array<{ id: string, label: string }>
  active: string
  ariaLabel?: string
  onSelect: (tab: string) => void
}) {
  return (
    <nav className="mt-4 flex gap-6 overflow-x-auto" aria-label={ariaLabel}>
      {tabs.map((tab) => (
        <button
          key={tab.id}
          type="button"
          className={cn('relative h-10 shrink-0 bg-transparent px-0 text-[13px] font-medium transition-colors', active === tab.id ? 'text-prosights-text' : 'text-prosights-muted hover:text-prosights-text')}
          aria-current={active === tab.id ? 'page' : undefined}
          onClick={() => onSelect(tab.id)}
        >
          {tab.label}
          {active === tab.id && <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-prosights-text" />}
        </button>
      ))}
    </nav>
  )
}

function SearchablePicker({
  label,
  value,
  options,
  onChange,
  searchPlaceholder,
  emptyText,
  loading = false,
  disabled = false,
}: {
  label: string
  value: string
  options: Array<{ value: string, label: string }>
  onChange: (value: string) => void
  searchPlaceholder: string
  emptyText: string
  loading?: boolean
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const selected = options.find((option) => option.value === value)
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = normalizedSearch ? options.filter((option) => option.label.toLowerCase().includes(normalizedSearch)) : options

  return (
    <div className="text-xs text-prosights-muted">
      <span className="mb-1 block">{label}</span>
      <DropdownMenu onOpenChange={(open) => { if (!open) setSearch('') }}>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} aria-label={`${label}: ${selected?.label || value || 'Select'}`} className="flex h-9 w-full items-center justify-between gap-2 rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-left text-[13px] text-prosights-text shadow-xs outline-none transition-colors hover:bg-prosights-surface-muted disabled:cursor-not-allowed disabled:opacity-50">
            <span className="truncate">{selected?.label || value || 'Select'}</span><ChevronDown className="size-4 shrink-0 text-prosights-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <div className="p-1" onKeyDown={(event) => event.stopPropagation()}><TextInput label={`Search ${label.toLowerCase()}`} value={search} onChange={setSearch} placeholder={searchPlaceholder} /></div>
          <DropdownMenuSeparator />
          <div className="max-h-56 overflow-y-auto">
            {loading
              ? <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-prosights-muted"><RefreshCw className="size-3.5 animate-spin" /> Loading…</div>
              : filtered.length > 0
                ? filtered.map((option) => <DropdownMenuItem key={option.value} className="cursor-pointer" onSelect={() => onChange(option.value)}>{option.value === value && <Check className="size-4" />}<span className={cn('truncate', option.value !== value && 'pl-6')}>{option.label}</span></DropdownMenuItem>)
                : <div className="px-2 py-3 text-[12px] text-prosights-muted">{emptyText}</div>}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DeploymentActionsMenu({
  application,
  deployment,
  hasStandby,
  restartImageRef,
  restartImageDigest,
  onDeployLatest,
  deployLatestDisabled = false,
  deployLatestPending = false,
}: {
  application: Application
  deployment: Deployment
  hasStandby: boolean
  restartImageRef?: string
  restartImageDigest?: string | null
  onDeployLatest?: () => void
  deployLatestDisabled?: boolean
  deployLatestPending?: boolean
}) {
  const queryClient = useQueryClient()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey })
  const inFlight = deployment.status === 'queued' || deployment.status === 'running'
  const pinnedImageRef = deployment.image_ref ?? restartImageRef
  const pinnedImageDigest = deployment.image_digest ?? restartImageDigest
  const restart = useMutation({
    mutationFn: () => createDeployment({
      application_id: application.id,
      trigger: 'manual',
      strategy: 'blue_green',
      commit_sha: deployment.commit_sha ?? undefined,
      image_ref: pinnedImageRef ?? undefined,
      image_digest: pinnedImageDigest ?? undefined,
      actor: 'restart',
    }),
    onSuccess: invalidate,
  })
  const redeploy = useMutation({
    mutationFn: () => deployment.status === 'failed' || deployment.status === 'cancelled'
      ? retryDeployment(deployment.id)
      : createDeployment({
          application_id: application.id,
          trigger: 'manual',
          strategy: 'blue_green',
          commit_sha: deployment.commit_sha ?? undefined,
          image_ref: deployment.image_ref ?? undefined,
          image_digest: deployment.image_digest ?? undefined,
          actor: 'redeploy',
        }),
    onSuccess: invalidate,
  })
  const cancel = useMutation({ mutationFn: () => cancelDeployment(deployment.id), onSuccess: invalidate })
  const rollback = useMutation({ mutationFn: () => rollbackApplication(application.id), onSuccess: invalidate })
  const error = restart.error ?? redeploy.error ?? cancel.error ?? rollback.error
  const busy = deployLatestPending || restart.isPending || redeploy.isPending || cancel.isPending || rollback.isPending

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button size="icon" className="size-8" aria-label="Deployment actions" disabled={busy}>
          {busy ? <RefreshCw className="size-4 animate-spin" /> : <Ellipsis className="size-4" />}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="w-48">
        {onDeployLatest && (
          <>
            <DropdownMenuItem className="cursor-pointer" disabled={deployLatestDisabled} onSelect={onDeployLatest}>
              <Play className="size-4" /> Deploy latest
            </DropdownMenuItem>
            <DropdownMenuSeparator />
          </>
        )}
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

function ApplicationDeployments({
  application,
  deployments,
  buildRuns,
  repository,
  routes,
  projectConfigurationRevision,
  onSelectDeployment,
  onOpenSettings,
}: {
  application: Application
  deployments: Deployment[]
  buildRuns: BuildRun[]
  repository?: GitHubRepository
  routes: ProxyRoute[]
  projectConfigurationRevision: number
  onSelectDeployment: (deploymentID: string, view?: DeploymentTab) => void
  onOpenSettings: () => void
}) {
  const queryClient = useQueryClient()
  const [historyPage, setHistoryPage] = useState(1)
  const orderedDeployments = useMemo(() => newestFirst(deployments), [deployments])
  const { data: slots = [] } = useQuery(deploymentSlotsQuery(application.id))
  const latestArtifact = orderedDeployments.find((deployment) => Boolean(deployment.image_ref))
  const activeBuilds = newestBuilds(buildRuns).filter((build) => build.status === 'dispatched' || build.status === 'running')
  const inFlightDeployments = orderedDeployments.filter((deployment) => deployment.status === 'queued' || deployment.status === 'running')
  const activeDeploymentID = slots.find((slot) => slot.status === 'active')?.deployment_id
    ?? orderedDeployments.find((deployment) => deployment.status === 'succeeded')?.id
  const activeDeployment = orderedDeployments.find((deployment) => deployment.id === activeDeploymentID)
  const visibleDeploymentIDs = new Set([...inFlightDeployments.map((deployment) => deployment.id), activeDeployment?.id].filter(Boolean))
  const history = orderedDeployments.filter((deployment) => !visibleDeploymentIDs.has(deployment.id))
  const historyPageCount = Math.max(1, Math.ceil(history.length / deploymentHistoryPageSize))
  const currentHistoryPage = Math.min(historyPage, historyPageCount)
  const historyPageItems = history.slice((currentHistoryPage - 1) * deploymentHistoryPageSize, currentHistoryPage * deploymentHistoryPageSize)
  const hasStandby = slots.some((slot) => slot.status === 'standby')
  const useGitHubBuild = Boolean(repository?.workflow_id && repository.image_ref && application.github_auto_deploy)
  const hasSource = Boolean(useGitHubBuild || (application.repository_url && application.compose_path) || latestArtifact?.image_ref)
  const hasHealthCheck = Boolean(application.health_check_url?.includes('{color}'))
  const ready = hasSource && hasHealthCheck
  const pendingChanges = applicationPendingChanges(application, projectConfigurationRevision, activeDeployment)
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
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: buildRunsQuery.queryKey }),
      ])
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
          <Button type="button" variant="primary" disabled={!ready || activeBuilds.length > 0 || inFlightDeployments.length > 0 || deploy.isPending} onClick={() => deploy.mutate()}>
            {deploy.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Play className="size-4" />}
            {deploy.isPending ? 'Starting…' : 'Deploy latest'}
          </Button>
        </div>
      </section>

      {pendingChanges.length > 0 && (
        <PendingChangesBanner
          changes={pendingChanges}
          disabled={!ready || activeBuilds.length > 0 || inFlightDeployments.length > 0}
          pending={deploy.isPending}
          onDeploy={() => deploy.mutate()}
        />
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
            {build.external_url && <Button asChild><a href={build.external_url} target="_blank" rel="noreferrer">View build <ExternalLink className="size-4" /></a></Button>}
          </div>
          <div className="flex items-center gap-2 border-t border-warning/20 bg-warning/5 px-4 py-2.5 text-[11px] font-medium text-warning"><RefreshCw className="size-3.5 animate-spin" />Build {build.status}</div>
        </article>
      ))}

      {inFlightDeployments.map((item) => (
        <DeploymentReleaseCard
          key={item.id}
          application={application}
          deployment={item}
          repository={repository}
          hasStandby={hasStandby}
          restartImageRef={slots.find((slot) => slot.deployment_id === item.id)?.image_ref}
          restartImageDigest={slots.find((slot) => slot.deployment_id === item.id)?.image_digest}
          onOpen={() => onSelectDeployment(item.id)}
          onViewLogs={() => onSelectDeployment(item.id, 'deploy-logs')}
        />
      ))}

      {activeDeployment && (
        <DeploymentReleaseCard
          application={application}
          deployment={activeDeployment}
          repository={repository}
          active
          hasStandby={hasStandby}
          restartImageRef={slots.find((slot) => slot.deployment_id === activeDeployment.id)?.image_ref}
          restartImageDigest={slots.find((slot) => slot.deployment_id === activeDeployment.id)?.image_digest}
          onOpen={() => onSelectDeployment(activeDeployment.id)}
          onViewLogs={() => onSelectDeployment(activeDeployment.id, 'deploy-logs')}
        />
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
                  <DeploymentReleaseCard
                    key={item.id}
                    application={application}
                    deployment={item}
                    repository={repository}
                    compact
                    hasStandby={hasStandby}
                    restartImageRef={slots.find((slot) => slot.deployment_id === item.id)?.image_ref}
                    restartImageDigest={slots.find((slot) => slot.deployment_id === item.id)?.image_digest}
                    onOpen={() => onSelectDeployment(item.id)}
                    onViewLogs={() => onSelectDeployment(item.id, 'deploy-logs')}
                  />
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
  application,
  deployment,
  repository,
  active = false,
  compact = false,
  hasStandby,
  restartImageRef,
  restartImageDigest,
  onOpen,
  onViewLogs,
  onDeployLatest,
  deployLatestDisabled,
  deployLatestPending,
}: {
  application: Application
  deployment: Deployment
  repository?: GitHubRepository
  active?: boolean
  compact?: boolean
  hasStandby: boolean
  restartImageRef?: string
  restartImageDigest?: string | null
  onOpen: () => void
  onViewLogs: () => void
  onDeployLatest?: () => void
  deployLatestDisabled?: boolean
  deployLatestPending?: boolean
}) {
  const inFlight = deployment.status === 'queued' || deployment.status === 'running'
  const status = active ? 'ACTIVE' : deployment.status === 'running' ? 'DEPLOYING' : deployment.status.toUpperCase()
  const tone = active ? 'success' : statusTone(deployment.status)
  const { data: commitMetadata } = useQuery(githubCommitQuery(repository?.connector_id ?? '', repository?.repository ?? '', deployment.commit_sha ?? ''))

  return (
    <article className={cn('overflow-hidden rounded-prosights-lg border bg-prosights-surface transition-[border-color,box-shadow] hover:border-prosights-subtle hover:shadow-sm', inFlight ? 'border-warning/40' : 'border-prosights-border')}>
      <div className={cn('flex items-center gap-3', compact ? 'px-3 py-3' : 'px-4 py-4')}>
        <button type="button" className="flex min-w-0 flex-1 cursor-pointer items-center gap-3 bg-transparent text-left" aria-label={`Open deployment ${deployment.id.slice(0, 8)}`} onClick={onOpen}>
          <DeploymentSourceIcon deployment={deployment} metadata={commitMetadata} inFlight={inFlight} compact={compact} />
          <div className="min-w-0 flex-1">
            <div className="flex min-w-0 items-center gap-2">
              <Badge tone={tone}>{status}</Badge>
              <span className="truncate text-[13px] font-semibold text-prosights-text">{deploymentTitle(deployment, commitMetadata?.message)}</span>
            </div>
            <p className="mt-1 truncate text-[11px] text-prosights-muted">{formatRelativeDeploymentTime(deployment.created_at)} via {deployment.trigger.replaceAll('_', ' ')} · <span className="font-mono">{deployment.id.slice(0, 8)}</span></p>
          </div>
        </button>
        <div className="flex shrink-0 items-center gap-2">
          <Button onClick={onViewLogs}>View logs</Button>
          <DeploymentActionsMenu
            application={application}
            deployment={deployment}
            hasStandby={hasStandby}
            restartImageRef={restartImageRef}
            restartImageDigest={restartImageDigest}
            onDeployLatest={onDeployLatest}
            deployLatestDisabled={deployLatestDisabled}
            deployLatestPending={deployLatestPending}
          />
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

function DeploymentDetail({
  application,
  deployment,
  buildRuns,
  routes,
  tab,
  onSelectTab,
}: {
  application: Application
  deployment: Deployment
  buildRuns: BuildRun[]
  routes: ProxyRoute[]
  tab: DeploymentTab
  onSelectTab: (tab: DeploymentTab) => void
}) {
  const { logs, live } = useDeploymentLogs(deployment.id)
  const { buildLogs, deployLogs } = splitDeploymentLogs(logs)
  const buildRun = buildRunForDeployment(deployment, buildRuns)
  const snapshot = deploymentConfigurationSnapshot(deployment)
  const composeServices = deploymentComposeServices(application, snapshot)
  const serviceConfigs = snapshot.configuration_state?.service_runtime_configs ?? []
  const [logService, setLogService] = useState('all')
  const selectedLogService = logService === 'all' || composeServices.some((service) => service.name === logService) ? logService : 'all'
  const visibleBuildLogs = filterDeploymentLogsByService(buildLogs, selectedLogService)
  const visibleDeployLogs = filterDeploymentLogsByService(deployLogs, selectedLogService)

  if (tab === 'build-logs') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-6">
        <DeploymentLogScope services={composeServices} value={selectedLogService} onChange={setLogService} />
        {visibleBuildLogs.length > 0
          ? <DeploymentLogStream deployment={deployment} logs={visibleBuildLogs} live={live} showDetails={false} className="flex-1 rounded-prosights-lg border border-prosights-border" />
          : (
              <EmptyLogState
                icon={Hammer}
                title={selectedLogService === 'all' ? (buildRun ? 'Build logs live in GitHub Actions' : 'No separate build logs') : `No build output for ${selectedLogService}`}
                description={selectedLogService === 'all' && buildRun ? 'Deploy Manager records the build result and artifact. Open the workflow for the full build output.' : 'This service used a prebuilt image, or the runner did not emit service-tagged build output.'}
                action={buildRun?.external_url ? <Button asChild><a href={buildRun.external_url} target="_blank" rel="noreferrer">Open GitHub Actions <ExternalLink className="size-4" /></a></Button> : undefined}
              />
            )}
      </div>
    )
  }

  if (tab === 'deploy-logs') {
    return (
      <div className="flex h-full min-h-0 flex-col gap-3 p-6">
        <DeploymentLogScope services={composeServices} value={selectedLogService} onChange={setLogService} />
        {visibleDeployLogs.length > 0
          ? <DeploymentLogStream deployment={deployment} logs={visibleDeployLogs} live={live} showDetails={false} className="flex-1 rounded-prosights-lg border border-prosights-border" />
          : <EmptyLogState icon={Container} title={`No deploy output for ${selectedLogService}`} description="The runner did not emit any Docker Compose lines tagged with this service." />}
      </div>
    )
  }

  return (
    <div className="space-y-5 p-7">
      <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="flex items-center gap-3 p-4">
          <div className={cn('flex size-9 shrink-0 items-center justify-center rounded-full border', deployment.status === 'succeeded' ? 'border-success/30 bg-success/10 text-success' : deployment.status === 'failed' ? 'border-danger/30 bg-danger/10 text-danger' : 'border-warning/30 bg-warning/10 text-warning')}>
            {deployment.status === 'succeeded' ? <Check className="size-4" /> : deployment.status === 'failed' ? <CircleAlert className="size-4" /> : <RefreshCw className="size-4 animate-spin" />}
          </div>
          <div className="min-w-0">
            <div className="flex items-center gap-2"><h2 className="text-[13px] font-semibold text-prosights-text">{deploymentStatusMessage(deployment.status)}</h2><Badge tone={statusTone(deployment.status)}>{deployment.status}</Badge></div>
            <p className="mt-1 text-[11px] text-prosights-muted">Started {formatDeploymentTime(deployment.created_at)} · {deploymentDuration(deployment)}</p>
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
  runtimeConfig?: NonNullable<DeploymentConfigurationState['service_runtime_configs']>[number]
  routes: ProxyRoute[]
  snapshotRecorded: boolean
}) {
  const build = serviceBuildSource(service)
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
        <DetailItem label="Build source" value={build} />
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

function serviceBuildSource(service: ComposeService): string {
  if (service.image) return service.image
  if (service.dockerfile) return service.dockerfile
  return service.build_context && service.build_context !== '.' ? service.build_context : 'Compose default'
}

function EmptyLogState({ icon: Icon, title, description, action }: { icon: typeof Hammer, title: string, description: string, action?: React.ReactNode }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col items-center justify-center rounded-prosights-lg border border-prosights-border bg-prosights-surface p-8 text-center">
      <div className="flex size-10 items-center justify-center rounded-prosights-md bg-prosights-surface-muted text-prosights-muted"><Icon className="size-5" /></div>
      <h2 className="mt-4 text-[14px] font-semibold text-prosights-text">{title}</h2>
      <p className="mt-1 max-w-md text-[12px] leading-5 text-prosights-muted">{description}</p>
      {action && <div className="mt-4">{action}</div>}
    </div>
  )
}

function DeploymentFact({ label, value }: { label: string, value: string }) {
  return <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface px-4 py-3"><div className="text-[11px] text-prosights-muted">{label}</div><div className="mt-1 truncate text-[13px] font-medium capitalize text-prosights-text">{value}</div></div>
}

function DetailItem({ label, value }: { label: string, value: string }) {
  return <div><dt className="text-prosights-muted">{label}</dt><dd className="mt-1 break-all font-mono text-prosights-text">{value}</dd></div>
}

function ServiceRouteLinks({ routes, fallbackDomain, emptyLabel = 'No domain', showServiceLabel = true, stacked = false }: { routes: ProxyRoute[], fallbackDomain?: string | null, emptyLabel?: string, showServiceLabel?: boolean, stacked?: boolean }) {
  if (routes.length === 0) {
    return fallbackDomain
      ? <a href={`https://${fallbackDomain}`} target="_blank" rel="noreferrer" className="break-all hover:text-prosights-text hover:underline">https://{fallbackDomain}</a>
      : <span>{emptyLabel}</span>
  }
  return (
    <span className={cn('min-w-0 gap-x-3 gap-y-1', stacked ? 'grid' : 'inline-flex flex-wrap')}>
      {routes.map((route) => (
        <span key={route.id} className="inline-flex min-w-0 items-center gap-1">
          {showServiceLabel && route.compose_service && <span className="font-mono text-[10px] text-prosights-subtle">{route.compose_service}</span>}
          <a href={proxyRouteURL(route)} target="_blank" rel="noreferrer" className="break-all hover:text-prosights-text hover:underline">{proxyRouteURL(route)}</a>
        </span>
      ))}
    </span>
  )
}

function ApplicationVariables({ application }: { application: Application }) {
  const queryClient = useQueryClient()
  const redeploy = useMutation({
    mutationFn: () => redeployApplicationConfiguration(application.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey }),
      ])
    },
  })

  return (
    <div className="space-y-5 p-6">
      {application.redeploy_required && (
        <section className="flex flex-col gap-3 rounded-prosights-lg border border-warning/40 bg-warning/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" />
            <div><div className="text-[12px] font-semibold text-prosights-text">Redeploy required</div><p className="mt-0.5 text-[11px] leading-4 text-prosights-muted">Service variables changed after the active release. Redeploy the stack to apply them.</p></div>
          </div>
          <Button type="button" disabled={redeploy.isPending} onClick={() => redeploy.mutate()}>{redeploy.isPending ? <RefreshCw className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{redeploy.isPending ? 'Queuing…' : 'Redeploy'}</Button>
        </section>
      )}
      <ApplicationComposeServiceVariables application={application} />
      {redeploy.error && <InlineError message={redeploy.error.message} />}
    </div>
  )
}

function ApplicationComposeServiceVariables({ application }: { application: Application }) {
  const composeServices = applicationComposeServices(application)
  const [composeService, setComposeService] = useState(defaultComposeServiceName(composeServices))
  const autoSelectedService = useRef(false)
  const configs = useQuery(applicationServiceRuntimeConfigsQuery(application.id))

  useEffect(() => {
    if (autoSelectedService.current || !configs.data) return
    const configured = configs.data.find((item) => item.doppler_project && item.doppler_config)
    if (!configured || configured.compose_service === composeService) return
    autoSelectedService.current = true
    setComposeService(configured.compose_service)
  }, [composeService, configs.data])

  if (composeServices.length === 0) {
    return (
      <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4">
        <div className="text-[13px] font-semibold text-prosights-text">Service variables</div>
        <p className="mt-1 text-[11px] text-prosights-muted">Scan the repository first so Deploy Manager can find the services in this Compose stack.</p>
      </section>
    )
  }
  if (configs.isPending) {
    return <section className="flex items-center gap-2 rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4 text-[12px] text-prosights-muted"><RefreshCw className="size-4 animate-spin" /> Loading service variables…</section>
  }
  if (configs.error) {
    return <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface p-4"><InlineError message={configs.error.message} /></section>
  }

  const config = configs.data.find((item) => item.compose_service === composeService)
    ?? legacyApplicationServiceRuntimeConfig(application, composeService, defaultComposeServiceName(composeServices))
  return (
    <>
      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3">
          <h2 className="text-[13px] font-semibold text-prosights-text">Stack shared variables</h2>
          <p className="mt-1 text-[11px] text-prosights-muted">Non-secret values injected into every Compose service in this stack.</p>
        </div>
        <div className="p-4"><ComposeServiceVariablesForm key={`stack:${configs.data.find((item) => item.compose_service === stackRuntimeConfigName)?.configuration_revision ?? 0}`} application={application} composeService={stackRuntimeConfigName} config={configs.data.find((item) => item.compose_service === stackRuntimeConfigName)} stackWide /></div>
      </section>
      <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3">
          <div className="flex items-center gap-2"><Container className="size-4 text-prosights-muted" /><h2 className="text-[13px] font-semibold text-prosights-text">Service variables</h2></div>
          <p className="mt-1 text-[11px] text-prosights-muted">Choose a service, connect its Doppler config, and add any non-secret overrides.</p>
        </div>
        <div className="space-y-4 p-4">
          <SelectInput label="Service" value={composeService} onChange={setComposeService}>
            {composeServices.map((service) => <option key={service.name} value={service.name}>{service.name}</option>)}
          </SelectInput>
          <ComposeServiceVariablesForm key={`${composeService}:${config?.configuration_revision ?? 0}`} application={application} composeService={composeService} config={config} />
        </div>
      </section>
    </>
  )
}

function ComposeServiceVariablesForm({ application, composeService, config, stackWide = false }: { application: Application, composeService: string, config?: ApplicationServiceRuntimeConfig, stackWide?: boolean }) {
  const queryClient = useQueryClient()
  const [dopplerProject, setDopplerProject] = useState(config?.doppler_project ?? '')
  const [dopplerConfig, setDopplerConfig] = useState(config?.doppler_config ?? '')
  const [variables, setVariables] = useState<ProjectRuntimeVariable[]>(() => config?.variables.map((variable) => ({ ...variable })) ?? [])
  const [error, setError] = useState<string>()
  const projects = useQuery(dopplerProjectsQuery)
  const configs = useQuery(dopplerConfigsQuery(dopplerProject))
  const projectOptions = [...new Set([...(projects.data ?? []), dopplerProject].filter(Boolean))]
  const configOptions = [...new Set([...(configs.data ?? []), dopplerConfig].filter(Boolean))]
  const save = useMutation({
    mutationFn: () => {
      validateDopplerScope(dopplerProject, dopplerConfig)
      return replaceApplicationServiceRuntimeConfig(application.id, composeService, {
        doppler_project: dopplerProject.trim(),
        doppler_config: dopplerConfig.trim(),
        variables: normalizeProjectRuntimeVariables(variables),
      })
    },
    onSuccess: async () => {
      setError(undefined)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationServiceRuntimeConfigsQuery(application.id).queryKey }),
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
      ])
    },
  })

  return (
    <form className="space-y-4" onSubmit={(event) => { event.preventDefault(); setError(undefined); try { validateDopplerScope(dopplerProject, dopplerConfig); normalizeProjectRuntimeVariables(variables); save.mutate() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Compose service variables are invalid.') } }}>
      <div className="space-y-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3">
        <div><div className="text-[12px] font-semibold text-prosights-text">Doppler</div><p className="mt-0.5 text-[11px] text-prosights-muted">Secrets are fetched when this stack deploys and are sent {stackWide ? 'to every service in this stack' : `only to ${composeService}`}.</p></div>
        <div className="grid gap-3 sm:grid-cols-2">
          <SelectInput label={stackWide ? 'Stack Doppler project' : 'Doppler project'} value={dopplerProject} disabled={projects.isPending} onChange={(project) => { setDopplerProject(project); setDopplerConfig('') }}>
            <option value="">Not connected</option>
            {projectOptions.map((project) => <option key={project} value={project}>{project}</option>)}
          </SelectInput>
          <SelectInput label={stackWide ? 'Stack Doppler config' : 'Doppler config'} value={dopplerConfig} disabled={!dopplerProject || configs.isPending} onChange={setDopplerConfig}>
            <option value="">Select config</option>
            {configOptions.map((item) => <option key={item} value={item}>{item}</option>)}
          </SelectInput>
        </div>
        {projects.error && <InlineError message="Doppler project list is unavailable. Existing saved Doppler scopes still apply." />}
        {configs.error && <InlineError message="Doppler config list is unavailable. Existing saved config still applies." />}
      </div>
      <div className="space-y-3">
        <div><div className="text-[12px] font-semibold text-prosights-text">{stackWide ? 'Shared variables' : 'Additional variables'}</div><p className="mt-0.5 text-[11px] text-prosights-muted">{stackWide ? 'Applied to every service in this stack, after project-shared values.' : `Applied only to ${composeService}, after project and stack-shared values.`}</p></div>
        {variables.map((variable, index) => (
          <div key={index} className="grid gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] sm:items-end">
            <TextInput label="Key" value={variable.key} onChange={(key) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key } : item))} placeholder="PUBLIC_API_URL" />
            <TextInput label="Value" value={variable.value} onChange={(value) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item))} placeholder="https://api.example.com" />
            <Button type="button" size="icon" aria-label={`Remove ${stackWide ? 'stack' : composeService} variable ${variable.key || index + 1}`} onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button>
          </div>
        ))}
        {variables.length === 0 && <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-5 text-center text-[12px] text-prosights-muted">No additional variables.</div>}
      </div>
      <div className="flex flex-col gap-3 border-t border-prosights-border pt-4 sm:flex-row sm:items-center sm:justify-between">
        <p className="text-[11px] leading-4 text-prosights-muted">Saving marks the Compose stack for redeployment.</p>
        <div className="flex gap-2"><Button type="button" onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}><Plus className="size-4" /> Add {stackWide ? 'stack' : 'service'} variable</Button><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : stackWide ? 'Save stack' : `Save ${composeService}`}</Button></div>
      </div>
      {(error || save.error) && <InlineError message={error ?? save.error?.message ?? 'Compose service variables could not be saved.'} />}
    </form>
  )
}

function ApplicationMetrics({ deployments, server }: { deployments: Deployment[], server?: ServerRecord }) {
  const completed = deployments.filter((deployment) => deployment.status === 'succeeded' || deployment.status === 'failed')
  const succeeded = completed.filter((deployment) => deployment.status === 'succeeded').length
  const durations = completed.map(deploymentDurationSeconds).filter((value) => value !== undefined) as number[]
  const median = medianValue(durations)

  return (
    <div className="space-y-5 p-6">
      <section className="grid gap-3 sm:grid-cols-3">
        <DeploymentFact label="Releases" value={String(deployments.length)} />
        <DeploymentFact label="Success rate" value={completed.length ? `${Math.round((succeeded / completed.length) * 100)}%` : 'n/a'} />
        <DeploymentFact label="Median deploy" value={median === undefined ? 'n/a' : formatSeconds(median)} />
      </section>
      <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface">
        <div className="border-b border-prosights-border px-4 py-3"><div className="flex items-center gap-2"><Activity className="size-4 text-prosights-muted" /><h2 className="text-[13px] font-semibold text-prosights-text">Host snapshot</h2></div><p className="mt-1 text-[11px] text-prosights-muted">Current usage for {server?.name ?? 'the service host'}. Per-container runtime metrics are not collected yet.</p></div>
        <div className="grid gap-4 p-4 sm:grid-cols-3">
          <MetricBar label="CPU" value={server?.cpu_usage ?? null} />
          <MetricBar label="Memory" value={server?.memory_usage ?? null} />
          <MetricBar label="Disk" value={server?.disk_usage ?? null} />
        </div>
      </section>
    </div>
  )
}

function MetricBar({ label, value }: { label: string, value: number | null }) {
  const percentage = value === null ? 0 : Math.max(0, Math.min(100, value))
  return (
    <div>
      <div className="flex items-center justify-between text-[12px]"><span className="text-prosights-muted">{label}</span><span className="font-medium text-prosights-text">{value === null ? 'n/a' : `${value.toFixed(0)}%`}</span></div>
      <div className="mt-2 h-1.5 overflow-hidden rounded-full bg-prosights-surface-muted"><div className="h-full rounded-full bg-prosights-text" style={{ width: `${percentage}%` }} /></div>
    </div>
  )
}

function ApplicationSettings({
  application,
  repository,
  routes,
  environments,
  servers,
  server,
  onDeleted,
}: {
  application: Application
  repository?: GitHubRepository
  routes: ProxyRoute[]
  environments: Environment[]
  servers: ServerRecord[]
  server?: ServerRecord
  onDeleted: () => void
}) {
  const queryClient = useQueryClient()
  const [form, setForm] = useState<ServiceForm>(() => applicationToServiceForm(application))
  const [error, setError] = useState<string>()
  const [composeOpen, setComposeOpen] = useState(false)
  const composeServices = applicationComposeServices(application)
  const composeFile = useQuery({
    queryKey: ['github-compose', repository?.connector_id, repository?.repository, application.branch, application.compose_path],
    queryFn: ({ signal }) => {
      if (!repository) throw new Error('This service is not connected to a GitHub repository.')
      return getGitHubRepositoryCompose({
        connector_id: repository.connector_id,
        repository: repository.repository,
        branch: application.branch,
        path: application.compose_path,
      }, { signal })
    },
    enabled: composeOpen && Boolean(repository),
    staleTime: 60_000,
  })
  const save = useMutation({
    mutationFn: () => {
      validateServiceForm(form)
      return updateApplication(application.id, serviceInput(form, application))
    },
    onSuccess: async () => {
      setError(undefined)
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })
  const remove = useMutation({
    mutationFn: () => deleteApplication(application.id),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
      onDeleted()
    },
  })

  return (
    <div className="space-y-5 p-6">
      <form
        className="space-y-5"
        onSubmit={(event) => {
          event.preventDefault()
          setError(undefined)
          try {
            validateServiceForm(form)
            save.mutate()
          } catch (cause) {
            setError(cause instanceof Error ? cause.message : 'Service settings are invalid.')
          }
        }}
      >
        <SettingsSection title="Source" description="The repository and compose target that produce this service.">
          <div className="grid gap-4 sm:grid-cols-2">
            <TextInput label="Service name" value={form.name} onChange={(name) => setForm((current) => ({ ...current, name }))} required />
            <TextInput label="Repository URL" value={form.repository_url} onChange={(repository_url) => setForm((current) => ({ ...current, repository_url }))} placeholder="https://github.com/org/repo.git" />
            <TextInput label="Branch" value={form.branch} onChange={(branch) => setForm((current) => ({ ...current, branch }))} required />
            <TextInput label="Compose path" value={form.compose_path} onChange={(compose_path) => setForm((current) => ({ ...current, compose_path }))} required />
            <label className="sm:col-span-2 flex items-center justify-between gap-4 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5 text-[12px]">
              <span><span className="block font-medium text-prosights-text">Automatic deployments</span><span className="mt-0.5 block text-prosights-muted">Deploy matching GitHub pushes. Turn this off only to pause releases.</span></span>
              <input type="checkbox" checked={form.github_auto_deploy} onChange={(event) => setForm((current) => ({ ...current, github_auto_deploy: event.target.checked }))} className="size-4 accent-black" />
            </label>
          </div>
          <div className="mt-4 overflow-hidden rounded-prosights-md border border-prosights-border bg-prosights-surface-muted">
            <button type="button" aria-expanded={composeOpen} className="flex w-full items-center gap-3 px-3 py-2.5 text-left" onClick={() => setComposeOpen((open) => !open)}>
              <FileCode2 className="size-4 shrink-0 text-prosights-muted" aria-hidden="true" />
              <span className="min-w-0 flex-1"><span className="block text-[12px] font-medium text-prosights-text">Compose file</span><span className="block truncate font-mono text-[10px] text-prosights-muted">{application.compose_path} · {repository ? `${repository.repository}#${application.branch}` : 'GitHub not connected'}</span></span>
              <ChevronDown className={cn('size-4 shrink-0 text-prosights-muted transition-transform', composeOpen && 'rotate-180')} aria-hidden="true" />
            </button>
            {composeOpen && (
              <div className="border-t border-prosights-border">
                {!repository
                  ? <p className="p-3 text-[11px] text-prosights-muted">Connect this service to GitHub to view its Compose file.</p>
                  : composeFile.isPending
                    ? <div className="flex items-center gap-2 p-3 text-[11px] text-prosights-muted"><RefreshCw className="size-3.5 animate-spin" /> Loading Compose file…</div>
                    : composeFile.error
                      ? <div className="p-3"><InlineError message={composeFile.error.message} /></div>
                      : <pre aria-label="Compose file contents" className="max-h-[480px] overflow-auto bg-zinc-950 p-4 font-mono text-[11px] leading-5 text-zinc-300">{composeFile.data?.content}</pre>}
              </div>
            )}
          </div>
        </SettingsSection>
        <SettingsSection title="Deploy" description="Where the compose stack runs and how blue-green releases are checked.">
          <div className="grid gap-4 sm:grid-cols-2">
            <SelectInput label="Environment" value={form.environment_id} onChange={(environment_id) => setForm((current) => ({ ...current, environment_id }))}>{environmentOrder(environments).map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</SelectInput>
            <SelectInput label="Server" value={form.server_id} onChange={(server_id) => setForm((current) => ({ ...current, server_id }))} disabled>{servers.map((item) => <option key={item.id} value={item.id}>{item.name}</option>)}</SelectInput>
            <div className="sm:col-span-2"><TextInput label="Remote directory" value={form.remote_directory} onChange={(remote_directory) => setForm((current) => ({ ...current, remote_directory }))} required /></div>
            <div className="sm:col-span-2"><TextInput label="Health check URL" value={form.health_check_url} onChange={(health_check_url) => setForm((current) => ({ ...current, health_check_url }))} placeholder="http://127.0.0.1:{port}/healthz?color={color}" /></div>
            <p className="text-[11px] text-prosights-muted">The server is fixed after creation. Recreate the service to move it.</p>
            <p className="sm:col-span-2 text-[11px] text-prosights-muted">Blue-green deploys require <span className="font-mono text-prosights-text">{'{color}'}</span>. Route targets supply the active color's host port during promotion.</p>
          </div>
        </SettingsSection>
        {composeServices.length > 0 && (
          <SettingsSection title="Compose stack" description="See each container's live host port and choose whether it follows both colors or only the active color.">
            <div className="divide-y divide-prosights-border overflow-hidden rounded-prosights-md border border-prosights-border">
              {composeServices.map((item) => {
                const serviceRoutes = routes.filter((route) => route.compose_service === item.name || (!route.compose_service && composeServices.length === 1))
                return (
                  <div key={item.name} className="bg-prosights-surface-muted p-3">
                    <div className="flex flex-col gap-3 sm:flex-row sm:items-start">
                      <div className="min-w-0 flex-1"><div className="text-[12px] font-semibold text-prosights-text">{item.name}</div><div className="mt-0.5 truncate font-mono text-[10px] text-prosights-muted">{item.image ?? item.dockerfile ?? 'compose build'}</div></div>
                      <div className="w-full shrink-0 sm:w-48">
                        <SelectInput
                          label="Run mode"
                          value={form.service_execution_modes[item.name] ?? 'follow_stack'}
                          onChange={(mode) => setForm((current) => ({ ...current, service_execution_modes: { ...current.service_execution_modes, [item.name]: mode as 'follow_stack' | 'singleton' } }))}
                        >
                          <option value="follow_stack">Follow stack</option>
                          <option value="singleton">Singleton</option>
                        </SelectInput>
                      </div>
                    </div>
                    <dl className="mt-3 grid gap-3 text-[11px] sm:grid-cols-2 lg:grid-cols-4">
                      <DetailItem label="Container port" value={composeContainerPorts(item, serviceRoutes)} />
                      <DetailItem label="Active host" value={activeServiceTargets(item, serviceRoutes)} />
                      <DetailItem label="Blue host" value={routeTargets(serviceRoutes, 'blue_upstream_url')} />
                      <DetailItem label="Green host" value={routeTargets(serviceRoutes, 'green_upstream_url')} />
                    </dl>
                    <div className="mt-3 flex flex-col gap-1 text-[10px] text-prosights-muted sm:flex-row sm:items-center sm:justify-between">
                      <ServiceRouteLinks routes={serviceRoutes} emptyLabel="No domain · private service" showServiceLabel={false} />
                      {(item.depends_on ?? []).length > 0 && <span>Depends on {(item.depends_on ?? []).join(', ')}</span>}
                    </div>
                  </div>
                )
              })}
            </div>
            <p className="mt-2 text-[11px] text-prosights-muted">Use “Singleton” for schedulers, queue consumers, and monitoring workers that must have exactly one running copy across blue/green.</p>
          </SettingsSection>
        )}
        {(error || save.error) && <InlineError message={error ?? save.error?.message ?? 'Settings could not be saved.'} />}
        <div className="flex justify-end"><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save settings'}</Button></div>
      </form>

      <ApplicationDomains application={application} routes={routes} server={server} />

      <SettingsSection title="Danger" description="Remove this service and its deployment history from the project.">
        <div className="flex items-center justify-between gap-4">
          <p className="text-[12px] text-prosights-muted">This does not delete the source repository.</p>
          <Button disabled={remove.isPending} onClick={() => {
            if (window.confirm(`Delete ${application.name}?`)) remove.mutate()
          }}><Trash2 className="size-4" /> Delete service</Button>
        </div>
        {remove.error && <div className="mt-3"><InlineError message={remove.error.message} /></div>}
      </SettingsSection>
    </div>
  )
}

function ApplicationDomains({ application, routes, server }: { application: Application, routes: ProxyRoute[], server?: ServerRecord }) {
  const queryClient = useQueryClient()
  const [addingDomain, setAddingDomain] = useState(false)
  const [domain, setDomain] = useState('')
  const [upstreamURL, setUpstreamURL] = useState('')
  const [blueUpstreamURL, setBlueUpstreamURL] = useState('')
  const [greenUpstreamURL, setGreenUpstreamURL] = useState('')
  const [tlsEnabled, setTLSEnabled] = useState(true)
  const [error, setError] = useState<string>()
  const invalidate = () => queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey })
  const apply = useMutation({
    mutationFn: applyProxyRoute,
    onSuccess: invalidate,
  })
  const create = useMutation({
    mutationFn: () => {
      validateProxyEndpoint(domain, upstreamURL, blueUpstreamURL, greenUpstreamURL)
      return createProxyRoute({
        application_id: application.id,
        domain: domain.trim().toLowerCase(),
        upstream_url: upstreamURL.trim(),
        blue_upstream_url: optionalTrimmed(blueUpstreamURL),
        green_upstream_url: optionalTrimmed(greenUpstreamURL),
        tls_enabled: tlsEnabled,
      })
    },
    onSuccess: async () => {
      setAddingDomain(false)
      setDomain('')
      setError(undefined)
      await invalidate()
    },
  })
  const remove = useMutation({ mutationFn: deleteProxyRoute, onSuccess: invalidate })

  function openDomainForm() {
    setAddingDomain(true)
    setDomain('')
    setUpstreamURL('')
    setBlueUpstreamURL('')
    setGreenUpstreamURL('')
    setTLSEnabled(server?.hostname !== 'playground')
    setError(undefined)
  }

  if (server?.proxy_type === 'none') {
    return (
      <SettingsSection title="Networking" description="Domains require Caddy or Traefik on this server.">
        <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-6 text-center text-[12px] text-prosights-muted">Enable a supported proxy on {application.server_name} before adding a public or internal domain.</div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title="Networking" description="Route a domain to ports published by this compose stack.">
      <div className="space-y-3">
        {routes.map((route) => {
          const scheme = route.tls_enabled ? 'https' : 'http'
          return (
            <div key={route.id} className="rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3">
              <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
                <div className="flex min-w-0 flex-1 items-center gap-3">
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-prosights-md bg-prosights-surface text-prosights-muted"><Globe2 className="size-4" /></div>
                  <div className="min-w-0"><a href={`${scheme}://${route.domain}`} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-prosights-text hover:underline">{route.domain}</a><div className="mt-0.5 truncate font-mono text-[11px] text-prosights-muted">{route.upstream_url}</div></div>
                </div>
                <Badge tone={statusTone(route.status)}>{route.status}</Badge>
                {route.status !== 'applied' && !(route.application_id && route.compose_service) && <Button disabled={apply.isPending} onClick={() => apply.mutate(route.id)}>{apply.isPending ? <RefreshCw className="size-4 animate-spin" /> : <RefreshCw className="size-4" />} Apply</Button>}
                <Button size="icon" aria-label={`Delete domain ${route.domain}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete domain ${route.domain}?`)) remove.mutate(route.id) }}><Trash2 className="size-4" /></Button>
              </div>
              {(route.blue_upstream_url || route.green_upstream_url) && <div className="mt-3 grid gap-2 sm:grid-cols-2">{route.blue_upstream_url && <ReadOnlyEndpoint label="Blue target" value={route.blue_upstream_url} />}{route.green_upstream_url && <ReadOnlyEndpoint label="Green target" value={route.green_upstream_url} />}</div>}
            </div>
          )
        })}
        {routes.length === 0 && <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-6 text-center text-[12px] text-prosights-muted">No domains yet. Add one only for a container that accepts HTTP traffic.</div>}

        {addingDomain
          ? (
              <form className="grid gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface p-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); setError(undefined); try { validateProxyEndpoint(domain, upstreamURL, blueUpstreamURL, greenUpstreamURL); create.mutate() } catch (cause) { setError(cause instanceof Error ? cause.message : 'Domain is invalid.') } }}>
                <TextInput label="Domain" value={domain} onChange={setDomain} placeholder="api.example.com" required />
                <TextInput label="Upstream" value={upstreamURL} onChange={setUpstreamURL} placeholder="http://127.0.0.1:3101" required />
                <TextInput label="Blue upstream" value={blueUpstreamURL} onChange={setBlueUpstreamURL} placeholder="http://127.0.0.1:3101" />
                <TextInput label="Green upstream" value={greenUpstreamURL} onChange={setGreenUpstreamURL} placeholder="http://127.0.0.1:3102" />
                <label className="flex items-center justify-between gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5 text-[12px]"><span className="text-prosights-text">HTTPS / TLS</span><input type="checkbox" className="size-4 accent-black" checked={tlsEnabled} onChange={(event) => setTLSEnabled(event.target.checked)} /></label>
                <p className="sm:col-span-2 text-[11px] text-prosights-muted">Use the host ports published by Docker Compose. Blue and green targets are used during zero-downtime deployments.</p>
                {(error || create.error) && <div className="sm:col-span-2"><InlineError message={error ?? create.error?.message ?? 'Domain could not be added.'} /></div>}
                <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" onClick={() => { setAddingDomain(false); setError(undefined) }}>Cancel</Button><Button type="submit" variant="primary" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add domain'}</Button></div>
              </form>
            )
          : <Button type="button" onClick={openDomainForm}><Plus className="size-4" /> Add domain</Button>}
      </div>
      {(apply.error || remove.error) && <div className="mt-3"><InlineError message={apply.error?.message ?? remove.error?.message ?? 'Domain action failed.'} /></div>}
    </SettingsSection>
  )
}

function ReadOnlyEndpoint({ label, value, href }: { label: string, value: string, href?: string }) {
  return <div className="rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5"><div className="text-[11px] text-prosights-muted">{label}</div>{href ? <a className="mt-1 block truncate font-mono text-[12px] text-prosights-text hover:underline" href={href} target="_blank" rel="noreferrer">{value}</a> : <div className="mt-1 truncate font-mono text-[12px] text-prosights-text">{value}</div>}</div>
}

function SettingsSection({ title, description, children }: { title: string, description: string, children: React.ReactNode }) {
  return (
    <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface">
      <div className="border-b border-prosights-border px-4 py-3"><h2 className="text-[13px] font-semibold text-prosights-text">{title}</h2><p className="mt-0.5 text-[11px] text-prosights-muted">{description}</p></div>
      <div className="p-4">{children}</div>
    </section>
  )
}

function CreateApplicationDialog({ open, onOpenChange, children }: { open: boolean, onOpenChange: (open: boolean) => void, children: React.ReactNode }) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] max-w-3xl -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-[12px] border border-prosights-border bg-prosights-surface shadow-[0_24px_80px_rgba(0,0,0,0.18)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out">
          <div className="flex items-start justify-between gap-4 border-b border-prosights-border px-6 py-5">
            <div><DialogPrimitive.Title className="text-[17px] font-semibold text-prosights-text">Add service</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-[13px] leading-5 text-prosights-muted">Import from GitHub. Deploy Manager discovers the compose file inside the repo.</DialogPrimitive.Description></div>
            <DialogPrimitive.Close className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text" aria-label="Close add service"><X className="size-4" /></DialogPrimitive.Close>
          </div>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ApplicationCreateForm({
  project,
  environments,
  servers,
  githubRepositories,
  githubStatus,
  defaultEnvironmentID,
  onCreated,
}: {
  project: Project
  environments: Environment[]
  servers: ServerRecord[]
  githubRepositories: GitHubRepository[]
  githubStatus: GitHubIntegrationStatus
  defaultEnvironmentID: string
  onCreated: () => void
}) {
  return (
    <GitHubServiceImportForm
      project={project}
      environments={environments}
      servers={servers}
      githubRepositories={githubRepositories}
      githubStatus={githubStatus}
      defaultEnvironmentID={defaultEnvironmentID}
      onCreated={onCreated}
    />
  )
}

function GitHubServiceImportForm({
  project,
  environments,
  servers,
  githubRepositories,
  githubStatus,
  defaultEnvironmentID,
  onCreated,
}: {
  project: Project
  environments: Environment[]
  servers: ServerRecord[]
  githubRepositories: GitHubRepository[]
  githubStatus: GitHubIntegrationStatus
  defaultEnvironmentID: string
  onCreated: () => void
}) {
  const queryClient = useQueryClient()
  const repositories = uniqueRepositories(githubRepositories)
  const [repositoryKey, setRepositoryKey] = useState(() => repositories[0] ? githubRepositoryKey(repositories[0]) : '')
  const [branch, setBranch] = useState(() => repositories[0]?.branch ?? 'main')
  const [root, setRoot] = useState('')
  const [environmentID, setEnvironmentID] = useState(defaultEnvironmentID || environments[0]?.id || '')
  const [serverID, setServerID] = useState(servers[0]?.id || '')
  const [selectedServices, setSelectedServices] = useState<string[]>([])
  const repository = repositories.find((item) => githubRepositoryKey(item) === repositoryKey)
  const importLabel = selectedServices.length === 1 ? selectedServices[0] : `${selectedServices.length} services`
  const branches = useQuery({
    queryKey: ['github-repository-branches', repository?.connector_id ?? '', repository?.repository ?? ''],
    queryFn: () => listGitHubRepositoryBranches({ connector_id: repository!.connector_id, repository: repository!.repository }),
    enabled: Boolean(repository),
  })
  const scan = useMutation({
    mutationFn: () => {
      if (!repository) throw new Error('Select a connected GitHub repository.')
      validateGitBranch(branch)
      validateRepositoryRoot(root)
      return detectGitHubRepositoryServices({ connector_id: repository.connector_id, repository: repository.repository, branch, root: optionalTrimmed(root) })
    },
    onSuccess: (result) => setSelectedServices(result.services.map((service) => service.name)),
  })
  const importServices = useMutation({
    mutationFn: () => {
      if (!repository) throw new Error('Select a connected GitHub repository.')
      if (!environmentID || !serverID || selectedServices.length === 0) throw new Error('Select an environment, server, and at least one service.')
      validateGitBranch(branch)
      validateRepositoryRoot(root)
      return importGitHubRepositoryServices(project.id, {
        connector_id: repository.connector_id,
        repository: repository.repository,
        branch,
        root: optionalTrimmed(root),
        environment_id: environmentID,
        server_id: serverID,
        services: selectedServices,
        detected_services: scan.data?.services ?? [],
      })
    },
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: githubRepositoriesQuery.queryKey }),
      ])
      onCreated()
    },
  })

  function changeRepository(value: string) {
    const selected = repositories.find((item) => githubRepositoryKey(item) === value)
    setRepositoryKey(value)
    setBranch(selected?.branch ?? 'main')
    setRoot('')
    setSelectedServices([])
    scan.reset()
  }

  function changeBranch(value: string) {
    setBranch(value)
    setSelectedServices([])
    scan.reset()
  }

  return (
    <div className="space-y-5 p-6">
      <div><h2 className="text-[14px] font-semibold text-prosights-text">Import from GitHub</h2><p className="mt-1 text-[11px] text-prosights-muted">Pick a repo, branch, and optional root. Deploy Manager scans for compose files, then you choose what to import.</p></div>

      {!githubStatus.app_configured
        ? (
            <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted p-5 text-center">
              <Github className="mx-auto size-5 text-prosights-muted" />
              <h3 className="mt-3 text-[13px] font-semibold text-prosights-text">Configure the GitHub App</h3>
              <p className="mt-1 text-[11px] leading-5 text-prosights-muted">Repository scanning needs the GitHub App credentials in this Deploy Manager environment.</p>
              <Button asChild className="mt-4"><Link to="/connectors">Open integrations</Link></Button>
            </div>
          )
        : repositories.length === 0
        ? (
            <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted p-5 text-center">
              <Github className="mx-auto size-5 text-prosights-muted" />
              <h3 className="mt-3 text-[13px] font-semibold text-prosights-text">Connect GitHub first</h3>
              <p className="mt-1 text-[11px] text-prosights-muted">Install or configure the GitHub connector, then return here to import services.</p>
              <Button asChild className="mt-4"><Link to="/connectors">Open connectors</Link></Button>
            </div>
          )
        : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <SearchablePicker label="Repository" value={repositoryKey} options={repositories.map((item) => ({ value: githubRepositoryKey(item), label: item.repository }))} onChange={changeRepository} searchPlaceholder="Search repositories" emptyText="No repositories found" disabled={importServices.isPending} />
                <SearchablePicker label="Branch" value={branch} options={(branches.data?.branches ?? []).map((item) => ({ value: item, label: item }))} onChange={changeBranch} searchPlaceholder="Search branches" emptyText="No branches found" loading={branches.isFetching} disabled={!repository || importServices.isPending} />
                <div className="sm:col-span-2"><TextInput label="Root directory (optional)" value={root} disabled={importServices.isPending} onChange={(value) => { setRoot(value); setSelectedServices([]); scan.reset() }} placeholder="apps/alleyes" /></div>
                <SelectInput label="Environment" value={environmentID} disabled={importServices.isPending} onChange={setEnvironmentID}>{environmentOrder(environments).map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</SelectInput>
                <SelectInput label="Server" value={serverID} disabled={importServices.isPending} onChange={setServerID}>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</SelectInput>
                <div className="sm:col-span-2 flex justify-end"><Button type="button" variant="primary" disabled={scan.isPending || importServices.isPending || branches.isFetching || !repository || !branch.trim()} onClick={() => scan.mutate()}>{scan.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{scan.isPending ? 'Scanning…' : 'Scan repository'}</Button></div>
              </div>

              {scan.isPending && <div className="animate-pulse rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted px-4 py-8 text-center text-[12px] text-prosights-muted">Scanning {repository?.repository}#{branch}{root.trim() ? `/${root.trim()}` : ''} for compose services…</div>}

              {scan.data && (
                <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
                  <div className="border-b border-prosights-border px-4 py-3"><h3 className="text-[12px] font-semibold text-prosights-text">Deployable services</h3><p className="mt-0.5 text-[11px] text-prosights-muted">Each selected compose target becomes one service with its own deployment history.</p></div>
                  {scan.data.services.length > 0
                    ? (
                        <div className="divide-y divide-prosights-border">
                          {scan.data.services.map((service) => (
                            <div key={service.name} className="px-4 py-3 transition-colors hover:bg-prosights-surface-muted">
                              <label className="flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  className="size-4 accent-black"
                                  disabled={importServices.isPending}
                                  checked={selectedServices.includes(service.name)}
                                  onChange={(event) => setSelectedServices((current) => event.target.checked ? [...current, service.name] : current.filter((name) => name !== service.name))}
                                />
                                <span className="flex size-8 items-center justify-center rounded-prosights-md border border-prosights-border bg-prosights-surface-muted text-prosights-muted"><Container className="size-4" /></span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-prosights-text">{service.name}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-prosights-muted">{service.compose_path}</span></span>
                              </label>
                              <DetectedStackPreview service={service} />
                            </div>
                          ))}
                        </div>
                      )
                    : <div className="px-5 py-10 text-center text-[12px] text-prosights-muted">No compose services found. Add a compose file beside the app, then scan again.</div>}
                </section>
              )}

              {importServices.isPending && (
                <div aria-live="polite" className="rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted px-4 py-3 text-[12px] text-prosights-muted">
                  <div className="flex items-center gap-2 font-medium text-prosights-text">
                    <RefreshCw className="size-4 animate-spin" />
                    Importing {importLabel}
                  </div>
                  <p className="mt-1 leading-5">Creating service configuration from {repository?.repository}#{branch}. This is not deploying yet.</p>
                </div>
              )}

              {(branches.error || scan.error || importServices.error) && <InlineError message={branches.error?.message ?? scan.error?.message ?? importServices.error?.message ?? 'GitHub import failed.'} />}
              <div className="flex items-center justify-end gap-2 border-t border-prosights-border pt-4">
                <DialogPrimitive.Close asChild><Button type="button" disabled={importServices.isPending}>Cancel</Button></DialogPrimitive.Close>
                <Button type="button" variant="primary" disabled={!scan.data || selectedServices.length === 0 || importServices.isPending} onClick={() => importServices.mutate()}>{importServices.isPending ? 'Importing…' : `Import ${selectedServices.length || ''} service${selectedServices.length === 1 ? '' : 's'}`}</Button>
              </div>
            </>
          )}
    </div>
  )
}

function DetectedStackPreview({ service }: { service: GitHubDetectedService }) {
  const composeServices = service.compose_services ?? []
  if (composeServices.length === 0) {
    return <p className="ml-11 mt-2 text-[10px] text-prosights-muted">Compose file found. Container details will be resolved when imported.</p>
  }
  return (
    <div className="ml-11 mt-2 grid gap-1.5">
      {composeServices.map((item) => (
        <div key={item.name} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-prosights-md border border-prosights-border bg-prosights-surface px-2.5 py-2 text-[10px]">
          <span className="font-semibold text-prosights-text">{item.name}</span>
          {item.image && <span className="truncate font-mono text-prosights-muted">{item.image}</span>}
          {(item.ports ?? []).map((port) => <Badge key={`${port.container_port}/${port.protocol ?? 'tcp'}`} tone="neutral">:{port.container_port}/{port.protocol ?? 'tcp'}</Badge>)}
          {(item.depends_on ?? []).length > 0 && <span className="text-prosights-muted">depends on {(item.depends_on ?? []).join(', ')}</span>}
        </div>
      ))}
    </div>
  )
}

function ProjectSettingsDialog({
  open,
  onOpenChange,
  project,
  environments,
  applications,
  registries,
}: {
  open: boolean
  onOpenChange: (open: boolean) => void
  project: Project
  environments: Environment[]
  applications: Application[]
  registries: ContainerRegistry[]
}) {
  const [tab, setTab] = useState<'general' | 'environments' | 'variables' | 'deploy'>('general')
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out" />
        <DialogPrimitive.Content className="fixed left-1/2 top-1/2 z-50 flex h-[min(82svh,760px)] w-[calc(100%-2rem)] max-w-4xl -translate-x-1/2 -translate-y-1/2 flex-col overflow-hidden rounded-[12px] border border-prosights-border bg-prosights-surface shadow-[0_24px_80px_rgba(0,0,0,0.18)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=closed]:ease-out data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150 data-[state=open]:ease-out">
          <header className="shrink-0 border-b border-prosights-border px-6 pt-5">
            <div className="flex items-start justify-between gap-4"><div><DialogPrimitive.Title className="text-[17px] font-semibold text-prosights-text">Project settings</DialogPrimitive.Title><DialogPrimitive.Description className="mt-1 text-[12px] text-prosights-muted">Settings shared by every service in {project.name}.</DialogPrimitive.Description></div><DialogPrimitive.Close aria-label="Close project settings" className="inline-flex size-8 items-center justify-center rounded-prosights-md text-prosights-muted hover:bg-prosights-surface-muted hover:text-prosights-text"><X className="size-4" /></DialogPrimitive.Close></div>
            <DrawerTabs tabs={[{ id: 'general', label: 'General' }, { id: 'environments', label: 'Environments' }, { id: 'variables', label: 'Shared variables' }, { id: 'deploy', label: 'Deploy defaults' }]} active={tab} onSelect={(value) => setTab(value as typeof tab)} />
          </header>
          <div className="min-h-0 flex-1 overflow-auto bg-prosights-canvas p-6">
            {tab === 'general'
              ? <ProjectGeneralSettings project={project} applications={applications} onDeleted={() => onOpenChange(false)} />
              : tab === 'environments'
                ? <ProjectEnvironmentsSettings project={project} environments={environments} applications={applications} />
                : tab === 'variables'
                  ? <ProjectVariablesSettings project={project} applications={applications} />
                  : <ProjectDeployDefaults project={project} registries={registries} />}
          </div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ProjectGeneralSettings({ project, applications, onDeleted }: { project: Project, applications: Application[], onDeleted: () => void }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState(project.name)
  const [slug, setSlug] = useState(project.slug)
  const [description, setDescription] = useState(project.description)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const save = useMutation({ mutationFn: () => updateProject(project.id, { name: name.trim(), slug: slugify(slug), description: description.trim() }), onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }) })
  const remove = useMutation({ mutationFn: () => deleteProject(project.id), onSuccess: async () => { await Promise.all([queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }), queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey })]); onDeleted(); window.location.assign('/projects') } })
  return (
    <div className="space-y-5">
      <SettingsSection title="General" description="Project identity shown across the workspace.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
          <TextInput label="Project name" value={name} onChange={setName} required />
          <TextInput label="Slug" value={slug} onChange={setSlug} required />
          <div className="sm:col-span-2"><TextInput label="Description" value={description} onChange={setDescription} /></div>
          <div className="sm:col-span-2 flex justify-end"><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save project'}</Button></div>
        </form>
        {save.error && <div className="mt-3"><InlineError message={save.error.message} /></div>}
      </SettingsSection>
      <section className="overflow-hidden rounded-prosights-lg border border-danger/35 bg-prosights-surface">
        <div className="border-b border-danger/20 bg-danger/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <h2 className="text-[13px] font-semibold text-danger">Delete project</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-prosights-muted">This permanently removes the project, its environments, deployment history, domains, and every service below.</p>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="overflow-hidden rounded-prosights-md border border-danger/25 bg-danger/[0.04]">
            <div className="flex items-center justify-between gap-3 border-b border-danger/15 px-3 py-2.5">
              <span className="text-[12px] font-semibold text-prosights-text">Services that will be deleted</span>
              <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">{applications.length}</span>
            </div>
            {applications.length > 0
              ? (
                  <ul aria-label="Services that will be deleted" className="max-h-44 divide-y divide-danger/15 overflow-auto">
                    {applications.map((application) => (
                      <li key={application.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-prosights-md border border-danger/20 bg-danger/[0.07] text-danger"><Container className="size-4" aria-hidden="true" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium text-prosights-text">{application.name}</div>
                          <div className="mt-0.5 truncate text-[11px] text-prosights-muted">{application.environment_name} · {application.status}</div>
                        </div>
                        {application.domain ? <div className="hidden max-w-64 truncate font-mono text-[10px] text-prosights-muted sm:block">{application.domain}</div> : null}
                      </li>
                    ))}
                  </ul>
                )
              : <p className="px-3 py-3 text-[11px] text-prosights-muted">This project has no services.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextInput label={`Type ${project.name} to confirm`} value={deleteConfirmation} onChange={setDeleteConfirmation} placeholder={project.name} />
            <Button className="transition-[background-color,transform] duration-150 active:scale-[0.98] !bg-danger hover:!bg-danger/85" type="button" disabled={deleteConfirmation !== project.name || remove.isPending} onClick={() => remove.mutate()}><Trash2 className="size-4" /> {remove.isPending ? 'Deleting…' : 'Delete project'}</Button>
          </div>
          <p className="text-[11px] font-medium text-danger">This action cannot be undone.</p>
          {remove.error && <InlineError message={remove.error.message} />}
        </div>
      </section>
    </div>
  )
}

function ProjectEnvironmentsSettings({ project, environments, applications }: { project: Project, environments: Environment[], applications: Application[] }) {
  const queryClient = useQueryClient()
  const [name, setName] = useState('')
  const [confirmDeleteID, setConfirmDeleteID] = useState('')
  const create = useMutation({ mutationFn: () => createEnvironment({ project_id: project.id, name: name.trim(), slug: slugify(name), kind: 'development', is_ephemeral: false }), onSuccess: async () => { setName(''); await queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }) } })
  const remove = useMutation({ mutationFn: (environmentID: string) => deleteEnvironment(environmentID), onSuccess: async () => { setConfirmDeleteID(''); await queryClient.invalidateQueries({ queryKey: environmentsQuery.queryKey }) } })
  return (
    <SettingsSection title="Environments" description="Production is created automatically. Add another named environment when you need a separate deployment scope.">
      <div className="space-y-3">
        {environmentOrder(environments).map((environment) => {
          const serviceCount = applications.filter((application) => application.environment_id === environment.id).length
          const blockedReason = environment.kind === 'production' ? 'Default environment' : serviceCount > 0 ? `Remove ${serviceCount} service${serviceCount === 1 ? '' : 's'} first` : ''
          const serviceLabel = `${serviceCount} service${serviceCount === 1 ? '' : 's'}`
          return (
            <div key={environment.id} className="flex items-center justify-between gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5">
              <div><div className="text-[13px] font-medium text-prosights-text">{environment.name}</div><div className="mt-0.5 text-[11px] text-prosights-muted">{environment.kind === 'production' ? `Default · ${serviceLabel}` : serviceLabel}</div></div>
              {confirmDeleteID === environment.id
                ? <div className="flex items-center gap-2"><span className="text-[11px] text-prosights-muted">Delete?</span><Button type="button" onClick={() => setConfirmDeleteID('')}>Cancel</Button><Button type="button" disabled={remove.isPending} onClick={() => remove.mutate(environment.id)}>{remove.isPending ? 'Deleting…' : 'Confirm'}</Button></div>
                : <Button type="button" aria-label={`Delete environment ${environment.name}`} title={blockedReason || undefined} disabled={remove.isPending || Boolean(blockedReason)} onClick={() => setConfirmDeleteID(environment.id)}><Trash2 className="size-4" /></Button>}
            </div>
          )
        })}
        <form className="grid gap-3 border-t border-prosights-border pt-4 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}><TextInput label="Environment name" value={name} onChange={setName} placeholder="Staging" /><div className="flex items-end"><Button variant="primary" disabled={!name.trim() || create.isPending}>{create.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}{create.isPending ? 'Adding…' : 'Add environment'}</Button></div></form>
        {(create.error || remove.error) && <InlineError message={create.error?.message ?? remove.error?.message ?? 'Environment action failed.'} />}
      </div>
    </SettingsSection>
  )
}

function ProjectVariablesSettings({ project, applications }: { project: Project, applications: Application[] }) {
  const variables = useQuery({
    queryKey: ['projects', project.id, 'variables'],
    queryFn: () => listProjectRuntimeVariables(project.id),
  })

  if (variables.isPending) {
    return <SettingsSection title="Shared variables" description="Non-secret values injected into every service in this project."><div className="flex items-center gap-2 text-[12px] text-prosights-muted"><RefreshCw className="size-4 animate-spin" /> Loading variables…</div></SettingsSection>
  }
  if (variables.error || !variables.data) {
    return <SettingsSection title="Shared variables" description="Non-secret values injected into every service in this project."><InlineError message={variables.error?.message ?? 'Variables could not be loaded.'} /></SettingsSection>
  }
  return <ProjectVariablesForm key={`${project.id}:${variables.data.configuration_revision}`} project={project} applications={applications} initialVariables={variables.data.variables} />
}

function ProjectVariablesForm({ project, applications, initialVariables }: { project: Project, applications: Application[], initialVariables: ProjectRuntimeVariable[] }) {
  const queryClient = useQueryClient()
  const [variables, setVariables] = useState(() => initialVariables.map((variable) => ({ key: variable.key, value: variable.value })))
  const [error, setError] = useState<string>()
  const staleApplications = applications.filter((application) => application.redeploy_required)
  const save = useMutation({
    mutationFn: () => {
      const normalized = normalizeProjectRuntimeVariables(variables)
      return replaceProjectRuntimeVariables(project.id, normalized)
    },
    onSuccess: async () => {
      setError(undefined)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: ['projects', project.id, 'variables'] }),
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
      ])
    },
  })
  const redeploy = useMutation({
    mutationFn: () => redeployProjectConfiguration(project.id),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey }),
      ])
    },
  })

  return (
    <div className="space-y-5">
      {staleApplications.length > 0 && (
        <section className="flex flex-col gap-3 rounded-prosights-lg border border-warning/40 bg-warning/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5"><CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><div><div className="text-[12px] font-semibold text-prosights-text">{staleApplications.length} service{staleApplications.length === 1 ? '' : 's'} need redeploying</div><p className="mt-0.5 text-[11px] text-prosights-muted">Queue each stale service with its currently active source or image.</p></div></div>
          <Button type="button" disabled={redeploy.isPending} onClick={() => redeploy.mutate()}>{redeploy.isPending ? <RefreshCw className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{redeploy.isPending ? 'Queuing…' : 'Redeploy all'}</Button>
        </section>
      )}
      <SettingsSection title="Shared variables" description="Non-secret values injected into every service in this project at deploy time.">
        <form
          className="space-y-3"
          onSubmit={(event) => {
            event.preventDefault()
            setError(undefined)
            try {
              normalizeProjectRuntimeVariables(variables)
              save.mutate()
            } catch (cause) {
              setError(cause instanceof Error ? cause.message : 'Shared variables are invalid.')
            }
          }}
        >
          {variables.length > 0
            ? variables.map((variable, index) => (
                <div key={index} className="grid gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] sm:items-end">
                  <TextInput label="Key" value={variable.key} onChange={(key) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key } : item))} placeholder="PUBLIC_API_URL" />
                  <TextInput label="Value" value={variable.value} onChange={(value) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item))} placeholder="https://api.internal" />
                  <Button type="button" size="icon" aria-label={`Remove variable ${variable.key || index + 1}`} onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button>
                </div>
              ))
            : <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-6 text-center text-[12px] text-prosights-muted">No shared variables yet.</div>}
          <div className="flex flex-col gap-3 border-t border-prosights-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-4 text-prosights-muted">Values are stored as plain text. Keep credentials and other secrets in Doppler.</p>
            <div className="flex gap-2"><Button type="button" onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}><Plus className="size-4" /> Add variable</Button><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save variables'}</Button></div>
          </div>
        </form>
        {(error || save.error || redeploy.error) && <div className="mt-3"><InlineError message={error ?? save.error?.message ?? redeploy.error?.message ?? 'Variable action failed.'} /></div>}
      </SettingsSection>
    </div>
  )
}

function ProjectDeployDefaults({ project, registries }: { project: Project, registries: ContainerRegistry[] }) {
  const queryClient = useQueryClient()
  const [registryID, setRegistryID] = useState(project.default_registry_id ?? '')
  const save = useMutation({ mutationFn: () => updateProjectRegistry(project.id, registryID || undefined), onSuccess: () => queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }) })
  return (
    <SettingsSection title="Default registry" description="Used when a service does not define its own artifact source.">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><SelectInput label="Container registry" value={registryID} onChange={setRegistryID}><option value="">No default registry</option>{registries.filter((registry) => registry.enabled).map((registry) => <option key={registry.id} value={registry.id}>{registry.name}</option>)}</SelectInput><div className="flex items-end"><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save default</Button></div></div>
      {save.error && <div className="mt-3"><InlineError message={save.error.message} /></div>}
    </SettingsSection>
  )
}

function applicationToServiceForm(application: Application): ServiceForm {
  const service_execution_modes = Object.fromEntries(applicationComposeServices(application).map((service) => [service.name, service.execution_mode ?? 'follow_stack'])) as ServiceForm['service_execution_modes']
  return { environment_id: application.environment_id, server_id: application.server_id, name: application.name, repository_url: application.repository_url ?? '', branch: application.branch, compose_path: application.compose_path, remote_directory: application.remote_directory, health_check_url: application.health_check_url ?? '', github_auto_deploy: application.github_auto_deploy, service_execution_modes }
}

function serviceInput(form: ServiceForm, current?: Application): UpdateApplicationInput {
  return { environment_id: form.environment_id, server_id: form.server_id, name: form.name.trim(), repository_url: optionalTrimmed(form.repository_url), branch: form.branch.trim() || 'main', compose_path: form.compose_path.trim() || 'docker-compose.yml', remote_directory: form.remote_directory.trim(), health_check_url: optionalTrimmed(form.health_check_url), domain: current?.domain ?? undefined, doppler_project: current?.doppler_project ?? undefined, doppler_config: current?.doppler_config ?? undefined, github_auto_deploy: form.github_auto_deploy, service_execution_modes: form.service_execution_modes }
}

function validateServiceForm(form: ServiceForm): void {
  if (!form.environment_id || !form.server_id || !form.name.trim() || !form.remote_directory.trim()) throw new Error('Environment, server, service name, and remote directory are required.')
  validateRemoteDirectory(form.remote_directory)
  validateGitBranch(form.branch)
  validateComposePath(form.compose_path)
  validateRepositoryURL(form.repository_url)
  validateHealthCheckURL(form.health_check_url)
}

function validateRemoteDirectory(value: string): void {
  const directory = value.trim()
  if (!directory.startsWith('/') || directory === '/' || directory.includes('//') || directory.split('/').includes('..') || hasControlCharacters(directory)) throw new Error('Remote directory must be a safe absolute path below root.')
}

function validateGitBranch(value: string): void {
  const branch = value.trim()
  if (!branch || branch.startsWith('-') || branch.startsWith('/') || branch.endsWith('/') || branch.includes('//') || branch.includes('..') || branch.includes('@{') || branch.endsWith('.lock') || !/^[A-Za-z0-9/._-]+$/.test(branch)) throw new Error('Branch is not a safe git ref.')
}

function validateComposePath(value: string): void {
  const path = value.trim()
  if (!path || path.startsWith('/') || path === '.' || path.split('/').includes('..') || hasControlCharacters(path)) throw new Error('Compose path must be a safe relative file path.')
}

function validateRepositoryRoot(value: string): void {
  const root = value.trim()
  if (!root || root === '.') return
  if (root.startsWith('/') || root.endsWith('/') || root.includes('//') || root.split('/').includes('..') || hasControlCharacters(root)) throw new Error('Root directory must be a safe relative path.')
}

function validateProxyEndpoint(domain: string, upstreamURL: string, blueUpstreamURL: string, greenUpstreamURL: string): void {
  const hostname = domain.trim().toLowerCase()
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) throw new Error('Enter a hostname without a protocol or path.')
  for (const [label, value] of [['Upstream', upstreamURL], ['Blue upstream', blueUpstreamURL], ['Green upstream', greenUpstreamURL]] as const) {
    if (!value.trim()) {
      if (label === 'Upstream') throw new Error('Upstream is required.')
      continue
    }
    let parsed: URL
    try {
      parsed = new URL(value.trim())
    } catch {
      throw new Error(`${label} must be an absolute HTTP URL.`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password) throw new Error(`${label} must be an absolute HTTP URL without credentials.`)
  }
}

function validateRepositoryURL(value: string): void {
  const repository = value.trim()
  if (!repository) return
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repository)) return
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repository)) return
  throw new Error('Repository URL must be a GitHub owner/repository remote.')
}

function validateDopplerScope(project: string, config: string): void {
  if (Boolean(project.trim()) !== Boolean(config.trim())) throw new Error('Doppler project and config must be provided together.')
  if (hasControlCharacters(project) || hasControlCharacters(config)) throw new Error('Doppler scope cannot contain control characters.')
}

function normalizeProjectRuntimeVariables(variables: ProjectRuntimeVariable[]): ProjectRuntimeVariable[] {
  const normalized = variables.map((variable) => ({ key: variable.key.trim(), value: variable.value }))
  const keys = new Set<string>()
  for (const variable of normalized) {
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(variable.key) || variable.key.length > 128) throw new Error('Variable keys must use letters, numbers, and underscores, and cannot start with a number.')
    if (keys.has(variable.key)) throw new Error(`Variable ${variable.key} is duplicated.`)
    if (variable.value.length > 8192 || containsControlCharacter(variable.value)) throw new Error(`Variable ${variable.key} contains an unsupported value.`)
    keys.add(variable.key)
  }
  return normalized
}

function applicationComposeServices(application: Application): ComposeService[] {
  const value = decodeJSONField(application.compose_services)
  return Array.isArray(value) ? value as ComposeService[] : []
}

function defaultComposeServiceName(services: ComposeService[]): string {
  return services.find((service) => !isInfrastructureComposeService(service.name) && (service.ports ?? []).length > 0)?.name
    ?? services.find((service) => !isInfrastructureComposeService(service.name))?.name
    ?? services[0]?.name
    ?? ''
}

function legacyApplicationServiceRuntimeConfig(application: Application, composeService: string, defaultComposeService: string): ApplicationServiceRuntimeConfig | undefined {
  if (composeService !== defaultComposeService || !application.doppler_project || !application.doppler_config) return undefined
  return {
    compose_service: composeService,
    doppler_project: application.doppler_project,
    doppler_config: application.doppler_config,
    variables: [],
    configuration_revision: application.configuration_revision ?? 0,
    changed: Boolean(application.redeploy_required),
  }
}

function isInfrastructureComposeService(name: string): boolean {
  const normalized = name.toLowerCase()
  return normalized.includes('cloud-sql')
    || normalized.includes('postgres')
    || normalized.includes('redis')
    || normalized === 'db'
    || normalized.endsWith('-db')
}

function deploymentConfigurationSnapshot(deployment?: Deployment): ConfigurationSnapshot {
  const value = decodeJSONField(deployment?.configuration_snapshot)
  return value && typeof value === 'object' && !Array.isArray(value) ? value as ConfigurationSnapshot : {}
}

function deploymentComposeServices(application: Application, snapshot: ConfigurationSnapshot): ComposeService[] {
  const services = snapshot.configuration_state?.application?.compose_services
  return Array.isArray(services) ? services : applicationComposeServices(application)
}

function proxyRouteURL(route: ProxyRoute): string {
  return `${route.tls_enabled === false ? 'http' : 'https'}://${route.domain}`
}

function architectureRouteRows(application: Application, routes: ProxyRoute[]): Array<{ label: string, url: string, upstream?: string, port?: string }> {
  const services = applicationComposeServices(application)
  if (services.length === 0) {
    if (routes.length > 0) return routes.map((route) => ({ label: route.compose_service || 'service', url: proxyRouteURL(route), upstream: route.upstream_url }))
    return [{ label: 'service', url: application.domain ? `https://${application.domain}` : 'No domains yet' }]
  }

  const matchedRoutes = new Set<string>()
  const rows = services.flatMap<{ label: string, url: string, upstream?: string, port?: string }>((service) => {
    const serviceRoutes = routes.filter((route) => route.compose_service === service.name || (!route.compose_service && services.length === 1))
    serviceRoutes.forEach((route) => matchedRoutes.add(route.id))
    if (serviceRoutes.length > 0) return serviceRoutes.map((route) => ({ label: service.name, url: proxyRouteURL(route), upstream: route.upstream_url }))
    const ports = service.ports?.flatMap((port) => port.published_port ? [`:${port.published_port}`] : []).join(', ')
    return [{ label: service.name, url: 'private', port: ports || undefined }]
  })
  return [...rows, ...routes.filter((route) => !matchedRoutes.has(route.id)).map((route) => ({ label: route.compose_service || 'service', url: proxyRouteURL(route), upstream: route.upstream_url }))]
}

function upstreamPortLabel(upstream: string): string {
  try {
    const url = new URL(upstream)
    return `:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return upstream
  }
}

function composeContainerPorts(service: ComposeService, routes: ProxyRoute[] = []): string {
  const ports = [
    ...(service.ports ?? []).map((port) => `:${port.container_port}/${port.protocol ?? 'tcp'}`),
    ...routes.flatMap((route) => route.container_port ? [`:${route.container_port}/tcp`] : []),
  ]
  return [...new Set(ports)].join(', ') || 'none'
}

function composePublishedPorts(service: ComposeService): string {
  return service.ports?.filter((port) => port.published_port).map((port) => `127.0.0.1:${port.published_port}`).join(', ') || ''
}

function routeTargets(routes: ProxyRoute[], field: 'upstream_url' | 'blue_upstream_url' | 'green_upstream_url'): string {
  const values = [...new Set(routes.flatMap((route) => route[field] ? [route[field]] : []))]
  return values.join(', ') || 'not published'
}

function activeServiceTargets(service: ComposeService, routes: ProxyRoute[]): string {
  return routes.length > 0 ? routeTargets(routes, 'upstream_url') : composePublishedPorts(service) || 'private'
}

function decodeJSONField(value: unknown): unknown {
  if (typeof value !== 'string') return value
  try {
    return JSON.parse(value)
  } catch {
    try {
      return JSON.parse(window.atob(value))
    } catch {
      return undefined
    }
  }
}

function applicationPendingChanges(application: Application, projectConfigurationRevision: number, activeDeployment?: Deployment): string[] {
  if (!activeDeployment) return ['Service imported and ready for its first deployment.']
  if (!application.redeploy_required) return []
  const snapshot = deploymentConfigurationSnapshot(activeDeployment)
  const changes: string[] = []
  if (application.configuration_revision > application.deployed_configuration_revision) changes.push(`Service settings changed (revision ${application.deployed_configuration_revision} → ${application.configuration_revision}).`)
  if (projectConfigurationRevision > application.deployed_project_configuration_revision) changes.push(`Shared project variables changed (revision ${application.deployed_project_configuration_revision} → ${projectConfigurationRevision}).`)
  if (snapshot.repository_url !== undefined && snapshot.repository_url !== application.repository_url) changes.push('Source repository changed.')
  if (snapshot.branch !== undefined && snapshot.branch !== application.branch) changes.push(`Branch changed from ${snapshot.branch} to ${application.branch}.`)
  if (snapshot.compose_path !== undefined && snapshot.compose_path !== application.compose_path) changes.push(`Compose path changed from ${snapshot.compose_path} to ${application.compose_path}.`)
  if (application.redeploy_required && changes.length === 0) changes.push('Runtime configuration changed after the active deployment.')
  return [...new Set(changes)]
}

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

function githubRepositoryForApplication(application: Application, repositories: GitHubRepository[]): GitHubRepository | undefined {
  return repositories.find((repository) => repository.application_id === application.id)
    ?? repositories.find((repository) => !repository.application_id && repository.clone_url === application.repository_url)
}

function uniqueRepositories(repositories: GitHubRepository[]): GitHubRepository[] {
  const seen = new Set<string>()
  return repositories.filter((repository) => {
    const key = `${repository.connector_id}:${repository.repository}`
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function githubRepositoryKey(repository: GitHubRepository): string {
  return `${repository.connector_id}:${repository.repository}`
}

function workspaceScopeFromURL(applications: Application[], deployments: Deployment[]): { serviceID: string, deploymentID: string } {
  const search = new URLSearchParams(window.location.search)
  const serviceID = search.get('service') ?? ''
  const deploymentID = search.get('deployment') ?? ''
  const application = applications.find((item) => item.id === serviceID)
  const deployment = deployments.find((item) => item.id === deploymentID && item.application_id === application?.id)
  return { serviceID: application?.id ?? '', deploymentID: deployment?.id ?? '' }
}

function replaceWorkspaceQuery(serviceID: string, deploymentID?: string, view?: string): void {
  const url = new URL(window.location.href)
  if (serviceID) url.searchParams.set('service', serviceID)
  else url.searchParams.delete('service')
  if (serviceID && deploymentID) url.searchParams.set('deployment', deploymentID)
  else url.searchParams.delete('deployment')
  if (serviceID && view) url.searchParams.set('view', view)
  else url.searchParams.delete('view')
  window.history.replaceState(null, '', `${url.pathname}${url.search}`)
}

function isServiceTab(value: string | null): value is ServiceTab { return serviceTabs.some((tab) => tab.id === value) }
function isDeploymentTab(value: string | null): value is DeploymentTab { return deploymentTabs.some((tab) => tab.id === value) }
function newestFirst(deployments: Deployment[]): Deployment[] { return [...deployments].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) }
function newestBuilds(builds: BuildRun[]): BuildRun[] { return [...builds].sort((a, b) => Date.parse(b.created_at) - Date.parse(a.created_at)) }
function environmentOrder(environments: Environment[]): Environment[] { const rank = { production: 0, development: 1, preview: 2 }; return [...environments].sort((a, b) => rank[a.kind] - rank[b.kind] || a.name.localeCompare(b.name)) }
function defaultNodeLayout(index: number): NodeLayout { return { x: 44 + (index % 3) * 286, y: 44 + Math.floor(index / 3) * 176 } }
function snapToGrid(value: number): number { return Math.round(value / architectureGridSize) * architectureGridSize }
function nodeTransform(position: NodePosition): string { return `translate3d(${position.x}px, ${position.y}px, 0)` }
function nodePositionStorageKey(projectID: string): string { return `deploy-manager:architecture:${projectID}` }
function canvasOffsetStorageKey(projectID: string): string { return `deploy-manager:architecture-camera:${projectID}` }
function selectedEnvironmentStorageKey(projectID: string): string { return `deploy-manager:project-environment:v1:${projectID}` }
function readSelectedEnvironmentID(projectID: string): string { return window.localStorage.getItem(selectedEnvironmentStorageKey(projectID)) ?? '' }

function readCanvasOffset(projectID: string): NodePosition {
  try {
    const stored = JSON.parse(window.localStorage.getItem(canvasOffsetStorageKey(projectID)) ?? '{}') as Partial<NodePosition>
    return Number.isFinite(stored.x) && Number.isFinite(stored.y) ? { x: stored.x as number, y: stored.y as number } : { x: 0, y: 0 }
  } catch {
    return { x: 0, y: 0 }
  }
}

function readNodeLayouts(projectID: string): Record<string, NodeLayout> {
  try {
    const stored = JSON.parse(window.localStorage.getItem(nodePositionStorageKey(projectID)) ?? '{}') as Record<string, Partial<NodeLayout>>
    return Object.fromEntries(Object.entries(stored).flatMap(([applicationID, layout]) => {
      if (!Number.isFinite(layout.x) || !Number.isFinite(layout.y)) return []
      const value: NodeLayout = { x: snapToGrid(layout.x as number), y: snapToGrid(layout.y as number) }
      if (Number.isFinite(layout.width)) value.width = Math.max(architectureNodeMinWidth, layout.width as number)
      if (Number.isFinite(layout.height)) value.height = Math.max(architectureNodeMinHeight, layout.height as number)
      return [[applicationID, value]]
    }))
  } catch {
    return {}
  }
}
function shortVersion(value: string | null): string { return value ? value.slice(0, 12) : 'pending' }
function repositoryDisplayName(value: string | null): string { return value ? value.replace(/^git@github\.com:/, '').replace(/^https:\/\/github\.com\//, '').replace(/\.git$/, '') : 'Manual compose source' }
function slugify(value: string): string { return value.trim().toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').replace(/-{2,}/g, '-') }
function optionalTrimmed(value: string): string | undefined { return value.trim() || undefined }
function hasControlCharacters(value: string): boolean { return /[\r\n\t]/.test(value) }
function containsControlCharacter(value: string): boolean { return [...value].some((character) => character.charCodeAt(0) < 32 || character.charCodeAt(0) === 127) }

function formatDeploymentTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'Recently'
  return new Intl.DateTimeFormat(undefined, { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' }).format(timestamp)
}

function formatRelativeDeploymentTime(value: string): string {
  const timestamp = Date.parse(value)
  if (Number.isNaN(timestamp)) return 'recently'
  const delta = timestamp - Date.now()
  const absolute = Math.abs(delta)
  const formatter = new Intl.RelativeTimeFormat(undefined, { numeric: 'auto' })
  if (absolute < 60_000) return 'just now'
  if (absolute < 3_600_000) return formatter.format(Math.round(delta / 60_000), 'minute')
  if (absolute < 86_400_000) return formatter.format(Math.round(delta / 3_600_000), 'hour')
  if (absolute < 604_800_000) return formatter.format(Math.round(delta / 86_400_000), 'day')
  return formatter.format(Math.round(delta / 604_800_000), 'week')
}

function deploymentTitle(deployment: Deployment, fetchedMessage?: string): string {
  if (fetchedMessage?.trim()) return fetchedMessage.trim()
  if (deployment.commit_message?.trim()) return deployment.commit_message.trim()
  if (deployment.commit_sha) return `Commit ${deployment.commit_sha.slice(0, 12)}`
  if (deployment.image_ref) return deployment.image_ref
  return 'Source deployment'
}

function deploymentStatusMessage(status: Deployment['status']): string {
  if (status === 'succeeded') return 'Deployment successful'
  if (status === 'failed') return 'Deployment failed'
  if (status === 'cancelled') return 'Deployment cancelled'
  if (status === 'queued') return 'Deployment queued'
  return 'Deployment in progress'
}

function deploymentDuration(deployment: Deployment): string {
  const seconds = deploymentDurationSeconds(deployment)
  return seconds === undefined ? 'not started' : formatSeconds(seconds)
}

function deploymentDurationSeconds(deployment: Deployment): number | undefined {
  const start = deployment.started_at ?? deployment.created_at
  const end = deployment.finished_at ?? (deployment.status === 'running' ? new Date().toISOString() : undefined)
  if (!start || !end) return undefined
  const milliseconds = Date.parse(end) - Date.parse(start)
  return Number.isFinite(milliseconds) ? Math.max(0, Math.round(milliseconds / 1000)) : undefined
}

function formatSeconds(seconds: number): string {
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  return minutes ? `${minutes}m ${remainder}s` : `${remainder}s`
}

function medianValue(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}
