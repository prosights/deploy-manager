import { useMutation, useQuery, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { BlockError } from '../components/ui/error-message'
import { SelectInput } from '../components/ui/select-input'
import { blueGreenHealthCheckError, DeploymentList, DeploymentQueuePanel } from '../features/deployments/components'
import { useDeploymentLogs } from '../features/deployments/logs'
import { cancelDeployment, createDeployment, retryDeployment, rollbackApplication, updateApplication, type Application, type ContainerRegistry, type CreateDeploymentInput, type Deployment } from '../lib/api'
import { applicationsQuery, containerRegistriesQuery, deploymentsQuery, deploymentSlotsQuery, projectsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useDeploymentSelection } from '../store/deployments'
import { useUiStore } from '../store/ui'

const manualRegistryID = '__manual__'
const allProjectsID = 'all'

export function DeploymentsRoute() {
  const queryClient = useQueryClient()
  const [{ data: deployments }, { data: applications }, { data: registries }, { data: projects }] = useSuspenseQueries({
    queries: [deploymentsQuery, applicationsQuery, containerRegistriesQuery, projectsQuery],
  })
  const searchQuery = useUiStore((state) => state.searchQuery)
  const selectedDeploymentID = useDeploymentSelection((state) => state.selectedDeploymentID)
  const setSelectedDeploymentID = useDeploymentSelection((state) => state.setSelectedDeploymentID)
  const [applicationID, setApplicationID] = useState(applications[0]?.id ?? '')
  const [commitSha, setCommitSha] = useState('')
  const [imageRef, setImageRef] = useState('')
  const [registryOverrideID, setRegistryOverrideID] = useState<string | null>(null)
  const [imageName, setImageName] = useState('')
  const [imageTag, setImageTag] = useState('')
  const [imageDigest, setImageDigest] = useState('')
  const [healthCheckDraft, setHealthCheckDraft] = useState({ applicationID: '', value: '' })
  const [actor, setActor] = useState('')
  const [formError, setFormError] = useState<string>()
  const projectIDFromURL = deploymentProjectIDFromSearch(window.location.search)
  const selectedProjectID = validDeploymentProjectID(projectIDFromURL, projects)
  const selectedProject = selectedProjectID === allProjectsID ? undefined : projects.find((project) => project.id === selectedProjectID)
  const applicationProjectIDs = useMemo(
    () => new Map(applications.map((application) => [application.id, application.project_id])),
    [applications],
  )
  const scopedApplications = useMemo(
    () => selectedProjectID === allProjectsID
      ? applications
      : applications.filter((application) => application.project_id === selectedProjectID),
    [applications, selectedProjectID],
  )
  const scopedDeployments = useMemo(
    () => selectedProjectID === allProjectsID
      ? deployments
      : deployments.filter((deployment) => deploymentProjectID(deployment, applicationProjectIDs) === selectedProjectID),
    [applicationProjectIDs, deployments, selectedProjectID],
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
  const target = useMemo(
    () => scopedApplications.find((application) => application.id === applicationID) ?? scopedApplications[0],
    [applicationID, scopedApplications],
  )
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
    if (!projectIDFromURL && projects[0]) {
      replaceDeploymentProjectURL(projects[0].id)
    }
  }, [projectIDFromURL, projects])

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
        title={selectedProject ? `${selectedProject.name} deployments` : 'All deployments'}
        description={selectedProject
          ? 'Project-scoped deploy queue, blue-green history, rollback, and logs.'
          : 'All project deployment history. Pick a project to reduce noise.'}
        actionNode={(
          <div className="w-full max-w-xs">
            <SelectInput
              label="Project scope"
              value={selectedProjectID}
              onChange={(projectID) => {
                replaceDeploymentProjectURL(projectID)
                setApplicationID('')
                setRegistryOverrideID(null)
                setSelectedDeploymentID('')
              }}
            >
              {projects.map((project) => (
                <option key={project.id} value={project.id}>{project.name}</option>
              ))}
              <option value={allProjectsID}>All projects</option>
            </SelectInput>
          </div>
        )}
      />
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
          setApplicationID(nextApplicationID)
          setRegistryOverrideID(null)
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

function deploymentProjectIDFromSearch(search: string): string {
  return new URLSearchParams(search).get('project') ?? ''
}

function validDeploymentProjectID(projectID: string, projects: Array<{ id: string }>): string {
  if (projectID === allProjectsID) {
    return allProjectsID
  }
  if (projects.some((project) => project.id === projectID)) {
    return projectID
  }
  return projects[0]?.id ?? allProjectsID
}

function replaceDeploymentProjectURL(projectID: string): void {
  const nextProjectID = projectID || allProjectsID
  const url = nextProjectID === allProjectsID ? '/deployments?project=all' : `/deployments?project=${encodeURIComponent(nextProjectID)}`
  window.history.replaceState(null, '', url)
}

function deploymentProjectID(deployment: Deployment, applicationProjectIDs: Map<string, string>): string | undefined {
  return deployment.project_id ?? applicationProjectIDs.get(deployment.application_id)
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
