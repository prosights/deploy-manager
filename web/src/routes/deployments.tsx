import { useMutation, useQuery, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useCallback, useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { BlockError } from '../components/ui/error-message'
import { SelectInput } from '../components/ui/select-input'
import { cn } from '../lib/cn'
import { blueGreenHealthCheckError, DeploymentList, DeploymentQueuePanel } from '../features/deployments/components'
import { useDeploymentLogs } from '../features/deployments/logs'
import { cancelDeployment, createDeployment, retryDeployment, rollbackApplication, updateApplication, type Application, type ContainerRegistry, type CreateDeploymentInput, type Deployment } from '../lib/api'
import { applicationsQuery, containerRegistriesQuery, deploymentsQuery, deploymentSlotsQuery, projectsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useDeploymentSelection } from '../store/deployments'
import { useUiStore } from '../store/ui'

const manualRegistryID = '__manual__'

export function DeploymentsRoute() {
  const queryClient = useQueryClient()
  const [{ data: deployments }, { data: applications }, { data: registries }, { data: projects }] = useSuspenseQueries({
    queries: [deploymentsQuery, applicationsQuery, containerRegistriesQuery, projectsQuery],
  })
  const searchQuery = useUiStore((state) => state.searchQuery)
  const selectedDeploymentID = useDeploymentSelection((state) => state.selectedDeploymentID)
  const setSelectedDeploymentID = useDeploymentSelection((state) => state.setSelectedDeploymentID)
  const [commitSha, setCommitSha] = useState('')
  const [imageRef, setImageRef] = useState('')
  const [registryOverrideID, setRegistryOverrideID] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [imageTag, setImageTag] = useState('')
  const [imageDigest, setImageDigest] = useState('')
  const [healthCheckDraft, setHealthCheckDraft] = useState({ applicationID: '', value: '' })
  const [actor, setActor] = useState('')
  const [formError, setFormError] = useState<string>()
  const [scopeSearch, setScopeSearch] = useState(window.location.search)
  const projectIDFromURL = deploymentProjectIDFromSearch(scopeSearch)
  const serviceIDFromURL = deploymentServiceIDFromSearch(scopeSearch)
  const selectedProjectID = validDeploymentProjectID(projectIDFromURL, projects)
  const selectedProject = projects.find((project) => project.id === selectedProjectID)
  const applicationProjectIDs = useMemo(
    () => new Map(applications.map((application) => [application.id, application.project_id])),
    [applications],
  )
  const scopedApplications = useMemo(
    () => selectedProject
      ? applications.filter((application) => application.project_id === selectedProject.id)
      : [],
    [applications, selectedProject],
  )
  const selectedServiceID = validDeploymentServiceID(serviceIDFromURL, scopedApplications)
  const selectedService = useMemo(
    () => scopedApplications.find((application) => application.id === selectedServiceID),
    [scopedApplications, selectedServiceID],
  )
  const scopedProjectDeployments = useMemo(
    () => selectedProject
      ? deployments.filter((deployment) => deploymentProjectID(deployment, applicationProjectIDs) === selectedProject.id)
      : [],
    [applicationProjectIDs, deployments, selectedProject],
  )
  const scopedDeployments = useMemo(
    () => selectedServiceID
      ? scopedProjectDeployments.filter((deployment) => deployment.application_id === selectedServiceID)
      : scopedProjectDeployments,
    [scopedProjectDeployments, selectedServiceID],
  )
  const serviceDeploymentCounts = useMemo(
    () => deploymentCountsByApplication(scopedProjectDeployments),
    [scopedProjectDeployments],
  )
  const target = useMemo(
    () => selectedService ?? scopedApplications[0],
    [scopedApplications, selectedService],
  )
  const visibleDeployments = scopedDeployments.filter((deployment) => matchesSearch(searchQuery, [
    deployment.id,
    deployment.application_name,
    deployment.server_name,
    deployment.project_name,
    deployment.trigger,
    deployment.strategy,
    deployment.status,
    deployment.commit_sha,
    deployment.actor,
  ]))
  const selectedDeployment = useMemo(
    () => visibleDeployments.find((deployment) => deployment.id === selectedDeploymentID),
    [visibleDeployments, selectedDeploymentID],
  )
  const selectedDeploymentIDForLogs = selectedDeployment?.id
  const effectiveRegistryID = registryOverrideID ?? target?.default_registry_id ?? manualRegistryID
  const selectedRegistry = useMemo(
    () => {
      if (effectiveRegistryID === manualRegistryID) {
        return undefined
      }
      return registries.find((registry) => registry.id === effectiveRegistryID)
    },
    [effectiveRegistryID, registries],
  )
  const { logs, live } = useDeploymentLogs(selectedDeploymentIDForLogs)
  const { data: deploymentSlots = [] } = useQuery({
    ...deploymentSlotsQuery(target?.id ?? ''),
    enabled: Boolean(target?.id),
  })
  const healthCheckDraftValue = target && healthCheckDraft.applicationID === target.id ? healthCheckDraft.value : target?.health_check_url ?? ''
  const applyDeploymentScope = useCallback((projectID: string, serviceID?: string) => {
    setScopeSearch(replaceDeploymentScopeURL(projectID, serviceID))
  }, [])
  const deploy = useMutation({
    mutationFn: () => {
      if (!target) {
        throw new Error('No application target is available')
      }
      return createDeployment(deploymentInput(target.id, commitSha, imageRef, selectedRegistry, imageName, imageTag, imageDigest, actor))
    },
    onSuccess: async () => {
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey })
      if (target) {
        await queryClient.invalidateQueries({ queryKey: deploymentSlotsQuery(target.id).queryKey })
      }
    },
  })
  const cancel = useMutation({
    mutationFn: (deploymentID: string) => cancelDeployment(deploymentID),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey })
    },
  })
  const retry = useMutation({
    mutationFn: (deploymentID: string) => retryDeployment(deploymentID),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey })
    },
  })
  const saveHealthCheck = useMutation({
    mutationFn: () => {
      if (!target) {
        throw new Error('No application target is available')
      }
      const error = blueGreenHealthCheckError(healthCheckDraftValue)
      if (error) {
        throw new Error(error)
      }
      return updateApplication(target.id, applicationUpdateInput(target, healthCheckDraftValue))
    },
    onSuccess: async (application) => {
      setFormError(undefined)
      setHealthCheckDraft({ applicationID: application.id, value: application.health_check_url ?? '' })
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })
  const rollback = useMutation({
    mutationFn: () => {
      if (!target) {
        throw new Error('No application target is available')
      }
      return rollbackApplication(target.id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey })
      if (target) {
        await queryClient.invalidateQueries({ queryKey: deploymentSlotsQuery(target.id).queryKey })
      }
    },
  })

  useEffect(() => {
    if (!visibleDeployments.length && selectedDeploymentID) {
      setSelectedDeploymentID('')
      return
    }
    if (selectedDeploymentID && !visibleDeployments.some((deployment) => deployment.id === selectedDeploymentID)) {
      setSelectedDeploymentID('')
    }
  }, [selectedDeploymentID, setSelectedDeploymentID, visibleDeployments])

  return (
    <div className="space-y-5">
      <PageHeader
        title={selectedService ? `${selectedService.name} deployments` : selectedProject ? `${selectedProject.name} deployments` : 'Deployments'}
        description={selectedService
          ? `Deploy, inspect logs, and rollback ${selectedService.name} inside ${selectedProject?.name}.`
          : 'Pick a project service to view its deploy queue, history, rollback slots, and logs.'}
        actionNode={(
          <div className="w-full max-w-xs">
            <SelectInput
              label="Project"
              value={selectedProjectID}
              onChange={(projectID) => {
                applyDeploymentScope(projectID)
                setRegistryOverrideID(null)
                setSelectedDeploymentID('')
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
            </SelectInput>
          </div>
        )}
      />
      {selectedProject && (
        <DeploymentServiceScope
          applications={scopedApplications}
          selectedServiceID={selectedServiceID}
          deploymentCounts={serviceDeploymentCounts}
          onServiceChange={(serviceID) => {
            applyDeploymentScope(selectedProject.id, serviceID)
            setRegistryOverrideID(null)
            setSelectedDeploymentID('')
          }}
        />
      )}
      <DeploymentQueuePanel
        applications={scopedApplications}
        target={target}
        deploymentSlots={deploymentSlots}
        healthCheckDraft={healthCheckDraftValue}
        commitSha={commitSha}
        imageRef={imageRef}
        imageName={imageName}
        imageTag={imageTag}
        selectedRegistry={selectedRegistry}
        registries={registries}
        imageDigest={imageDigest}
        actor={actor}
        isQueueing={deploy.isPending}
        isRollingBack={rollback.isPending}
        isSavingHealthCheck={saveHealthCheck.isPending}
        onApplicationChange={(nextApplicationID) => {
          if (selectedProject) {
            applyDeploymentScope(selectedProject.id, nextApplicationID)
          }
          setRegistryOverrideID(null)
          setSelectedDeploymentID('')
        }}
        onHealthCheckDraftChange={(value) => {
          setHealthCheckDraft({ applicationID: target?.id ?? '', value })
        }}
        onSaveHealthCheck={() => saveHealthCheck.mutate()}
        onCommitShaChange={setCommitSha}
        onImageRefChange={setImageRef}
        onRegistryChange={(value) => setRegistryOverrideID(value || manualRegistryID)}
        onImageNameChange={setImageName}
        onImageTagChange={setImageTag}
        onImageDigestChange={setImageDigest}
        onActorChange={setActor}
        onQueue={() => {
          setFormError(undefined)
          try {
            validateCommitSha(commitSha)
            validateRegistryImage(selectedRegistry, imageName, imageTag, imageRef, target)
            validateImageDigest(imageDigest)
            validateDeploymentActor(actor)
          } catch (error) {
            setFormError(error instanceof Error ? error.message : 'Deployment request is invalid.')
            return
          }
          deploy.mutate()
        }}
        onRollback={() => rollback.mutate()}
      />
      {!target && (
        <div className="rounded-md border bg-panel px-4 py-3 text-sm text-muted">
          {selectedProject ? `Create a service in ${selectedProject.name} before queueing a deployment.` : 'Create an application target before queueing a deployment.'}
        </div>
      )}
      {(formError || deploy.error) && <BlockError message={formError ?? deploy.error?.message ?? 'Deployment could not be queued.'} />}
      {saveHealthCheck.error && <BlockError message={saveHealthCheck.error.message} />}
      <DeploymentList
        deployments={visibleDeployments}
        selectedDeployment={selectedDeployment}
        selectedDeploymentLogs={logs}
        selectedDeploymentLive={live}
        isCancelling={cancel.isPending}
        isRetrying={retry.isPending}
        onInspect={(deploymentID) => setSelectedDeploymentID(selectedDeploymentID === deploymentID ? '' : deploymentID)}
        onCancel={(deploymentID) => cancel.mutate(deploymentID)}
        onRetry={(deploymentID) => retry.mutate(deploymentID)}
      />
      {cancel.error && <BlockError message={cancel.error.message} />}
      {retry.error && <BlockError message={retry.error.message} />}
      {rollback.error && <BlockError message={rollback.error.message} />}
    </div>
  )
}

function DeploymentServiceScope({
  applications,
  selectedServiceID,
  deploymentCounts,
  onServiceChange,
}: {
  applications: Application[]
  selectedServiceID: string
  deploymentCounts: Map<string, number>
  onServiceChange: (serviceID: string) => void
}) {
  if (applications.length === 0) {
    return (
      <div className="rounded-md border bg-panel px-4 py-3 text-sm text-muted">
        No services exist in this project yet.
      </div>
    )
  }

  return (
    <section className="rounded-lg border bg-surface">
      <div className="border-b px-4 py-3">
        <h2 className="text-sm font-semibold text-ink">Project services</h2>
        <p className="mt-1 text-xs text-muted">Deployments are scoped to one service at a time.</p>
      </div>
      <div className="flex gap-2 overflow-x-auto p-3">
        {applications.map((application) => {
          const active = application.id === selectedServiceID
          const deploymentCount = deploymentCounts.get(application.id) ?? 0
          return (
            <button
              key={application.id}
              type="button"
              aria-pressed={active}
              className={cn(
                'min-w-56 rounded-md border px-3 py-2 text-left transition-colors hover:bg-panel',
                active ? 'border-accent bg-accent/10 text-accent-text' : 'bg-background text-muted',
              )}
              onClick={() => onServiceChange(application.id)}
            >
              <div className="flex items-start justify-between gap-3">
                <div className="min-w-0">
                  <div className="truncate text-sm font-medium text-ink">{application.name}</div>
                  <div className="mt-1 truncate text-xs">{application.environment_name} / {application.server_name}</div>
                </div>
                <div className="shrink-0 rounded-full bg-panel px-2 py-0.5 text-xs text-muted">{deploymentCount}</div>
              </div>
            </button>
          )
        })}
      </div>
    </section>
  )
}

function deploymentProjectIDFromSearch(search: string): string {
  return new URLSearchParams(search).get('project') ?? ''
}

function deploymentServiceIDFromSearch(search: string): string {
  return new URLSearchParams(search).get('service') ?? ''
}

function validDeploymentProjectID(projectID: string, projects: Array<{ id: string }>): string {
  if (projects.some((project) => project.id === projectID)) {
    return projectID
  }
  return projects[0]?.id ?? ''
}

function validDeploymentServiceID(serviceID: string, applications: Application[]): string {
  if (applications.some((application) => application.id === serviceID)) {
    return serviceID
  }
  return applications[0]?.id ?? ''
}

function replaceDeploymentScopeURL(projectID: string, serviceID?: string): string {
  const params = new URLSearchParams()
  if (projectID) {
    params.set('project', projectID)
  }
  if (serviceID) {
    params.set('service', serviceID)
  }
  const suffix = params.toString()
  const url = suffix ? `/deployments?${suffix}` : '/deployments'
  window.history.replaceState(null, '', url)
  return window.location.search
}

function deploymentProjectID(deployment: Deployment, applicationProjectIDs: Map<string, string>): string | undefined {
  return deployment.project_id ?? applicationProjectIDs.get(deployment.application_id)
}

function deploymentCountsByApplication(deployments: Deployment[]): Map<string, number> {
  const counts = new Map<string, number>()
  for (const deployment of deployments) {
    counts.set(deployment.application_id, (counts.get(deployment.application_id) ?? 0) + 1)
  }
  return counts
}

function applicationUpdateInput(application: Application, healthCheckURL: string) {
  return {
    environment_id: application.environment_id,
    server_id: application.server_id,
    name: application.name,
    repository_url: application.repository_url ?? undefined,
    branch: application.branch,
    compose_path: application.compose_path,
    remote_directory: application.remote_directory,
    domain: application.domain ?? undefined,
    health_check_url: healthCheckURL.trim(),
    doppler_project: application.doppler_project ?? undefined,
    doppler_config: application.doppler_config ?? undefined,
    github_auto_deploy: application.github_auto_deploy,
  }
}

function deploymentInput(
  applicationID: string,
  commitSha: string,
  imageRef: string,
  registry: ContainerRegistry | undefined,
  imageName: string,
  imageTag: string,
  imageDigest: string,
  actor: string,
): CreateDeploymentInput {
  return {
    application_id: applicationID,
    trigger: 'manual',
    strategy: 'blue_green',
    commit_sha: optionalTrimmed(commitSha),
    image_ref: registry ? resolvedImageRef(registry, imageName, imageTag) : optionalTrimmed(imageRef),
    image_digest: optionalTrimmed(imageDigest),
    actor: optionalTrimmed(actor),
  }
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function validateCommitSha(value: string): void {
  const commitSha = value.trim()
  if (!commitSha) {
    return
  }
  if (!/^[0-9A-Fa-f]{7,40}$/.test(commitSha)) {
    throw new Error('Commit SHA must be 7 to 40 hexadecimal characters.')
  }
}

function validateRegistryImage(
  registry: ContainerRegistry | undefined,
  imageName: string,
  imageTag: string,
  manualRef: string,
  target: Application | undefined,
): void {
  if (!registry) {
    if (!manualRef.trim()) {
      if (canBuildFromSource(target)) {
        return
      }
      throw new Error('Provide an image ref, or configure the application with a repository and compose file to build from.')
    }
    validateImageRef(manualRef)
    return
  }
  const image = cleanImagePath(imageName || registry.default_image)
  if (!image || !imageTag.trim()) {
    throw new Error('Image and tag are required when using a registry.')
  }
  validateImageRef(resolvedImageRef(registry, imageName, imageTag))
}

// canBuildFromSource mirrors the backend rule: an application with a repository
// and compose file can be built on the target VM, so no pinned image ref is
// required for a deployment.
function canBuildFromSource(target: Application | undefined): boolean {
  return Boolean(target?.repository_url?.trim() && target?.compose_path?.trim())
}

function validateImageRef(value: string | undefined): void {
  if (!value) {
    return
  }
  const imageRef = value.trim()
  if (!imageRef) {
    return
  }
  if (imageRef.length > 512 || /\s/.test(imageRef)) {
    throw new Error('Image ref must be 512 characters or fewer and cannot contain whitespace.')
  }
}

function resolvedImageRef(registry: ContainerRegistry, imageName: string, imageTag: string): string {
  return `${registryBasePath(registry)}/${cleanImagePath(imageName || registry.default_image)}:${imageTag.trim()}`
}

function registryBasePath(registry: ContainerRegistry): string {
  return [registry.registry_host, registry.namespace, registry.repository].map(cleanImagePath).filter(Boolean).join('/')
}

function cleanImagePath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function validateImageDigest(value: string): void {
  const imageDigest = value.trim()
  if (!imageDigest) {
    return
  }
  if (!/^sha256:[0-9a-f]{64}$/.test(imageDigest)) {
    throw new Error('Image digest must be a sha256 digest.')
  }
}

function validateDeploymentActor(value: string): void {
  if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
    throw new Error('Actor cannot contain control characters.')
  }
}
