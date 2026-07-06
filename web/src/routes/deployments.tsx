import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useEffect, useMemo, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { BlockError } from '../components/ui/error-message'
import { DeploymentList, DeploymentQueuePanel } from '../features/deployments/components'
import { DeploymentLogsPanel, useDeploymentLogs } from '../features/deployments/logs'
import { cancelDeployment, createDeployment, retryDeployment, rollbackApplication, type Application, type ContainerRegistry, type CreateDeploymentInput } from '../lib/api'
import { applicationsQuery, containerRegistriesQuery, deploymentsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useDeploymentSelection } from '../store/deployments'
import { useUiStore } from '../store/ui'

const manualRegistryID = '__manual__'

export function DeploymentsRoute() {
  const queryClient = useQueryClient()
  const [{ data: deployments }, { data: applications }, { data: registries }] = useSuspenseQueries({
    queries: [deploymentsQuery, applicationsQuery, containerRegistriesQuery],
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
  const [actor, setActor] = useState('')
  const [formError, setFormError] = useState<string>()
  const visibleDeployments = deployments.filter((deployment) => matchesSearch(searchQuery, [
    deployment.id,
    deployment.application_name,
    deployment.server_name,
    deployment.trigger,
    deployment.strategy,
    deployment.status,
    deployment.commit_sha,
    deployment.actor,
  ]))
  const target = useMemo(
    () => applications.find((application) => application.id === applicationID) ?? applications[0],
    [applications, applicationID],
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
  const rollback = useMutation({
    mutationFn: () => {
      if (!target) {
        throw new Error('No application target is available')
      }
      return rollbackApplication(target.id)
    },
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: deploymentsQuery.queryKey })
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
        title="Deployments"
        description="Audit trail, blue-green strategy, webhook/manual triggers, and historical logs."
      />
      <DeploymentQueuePanel
        applications={applications}
        target={target}
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
        onApplicationChange={(nextApplicationID) => {
          setApplicationID(nextApplicationID)
          setRegistryOverrideID(null)
        }}
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
          Create an application target before queueing a deployment.
        </div>
      )}
      {(formError || deploy.error) && <BlockError message={formError ?? deploy.error?.message ?? 'Deployment could not be queued.'} />}
      <DeploymentList
        deployments={visibleDeployments}
        selectedDeployment={selectedDeployment}
        isCancelling={cancel.isPending}
        isRetrying={retry.isPending}
        onInspect={setSelectedDeploymentID}
        onCancel={(deploymentID) => cancel.mutate(deploymentID)}
        onRetry={(deploymentID) => retry.mutate(deploymentID)}
      />
      {cancel.error && <BlockError message={cancel.error.message} />}
      {retry.error && <BlockError message={retry.error.message} />}
      {rollback.error && <BlockError message={rollback.error.message} />}
      <DeploymentLogsPanel deployment={selectedDeployment} logs={logs} live={live} />
    </div>
  )
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
