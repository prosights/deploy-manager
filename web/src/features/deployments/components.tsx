import { Ban, RotateCcw, Rocket, ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import type { Application, ContainerRegistry, Deployment } from '../../lib/api'
import { validateHealthCheckURL } from '../../lib/urls'
import { statusTone } from '../status'

type DeploymentQueuePanelProps = {
  applications: Application[]
  target?: Application
  commitSha: string
  imageRef: string
  imageName: string
  imageTag: string
  selectedRegistry?: ContainerRegistry
  registries: ContainerRegistry[]
  imageDigest: string
  actor: string
  isQueueing: boolean
  isRollingBack: boolean
  onApplicationChange: (applicationID: string) => void
  onCommitShaChange: (commitSha: string) => void
  onImageRefChange: (imageRef: string) => void
  onRegistryChange: (registryID: string) => void
  onImageNameChange: (imageName: string) => void
  onImageTagChange: (imageTag: string) => void
  onImageDigestChange: (imageDigest: string) => void
  onActorChange: (actor: string) => void
  onQueue: () => void
  onRollback: () => void
}

export function DeploymentQueuePanel({
  applications,
  target,
  commitSha,
  imageRef,
  imageName,
  imageTag,
  selectedRegistry,
  registries,
  imageDigest,
  actor,
  isQueueing,
  isRollingBack,
  onApplicationChange,
  onCommitShaChange,
  onImageRefChange,
  onRegistryChange,
  onImageNameChange,
  onImageTagChange,
  onImageDigestChange,
  onActorChange,
  onQueue,
  onRollback,
}: DeploymentQueuePanelProps) {
  const blueGreenError = blueGreenHealthCheckError(target?.health_check_url ?? '')
  const blueGreenReady = blueGreenError === ''
  const rollbackError = blueGreenError
  const rollbackReady = rollbackError === ''

  return (
    <Panel title="Queue deployment">
      <div className="grid gap-3 p-4 md:grid-cols-[minmax(220px,1fr)_150px_180px_180px]">
        <SelectInput label="Application" value={target?.id ?? ''} onChange={onApplicationChange} disabled={applications.length === 0}>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>{application.name} / {application.server_name}</option>
          ))}
        </SelectInput>
        <div className="flex flex-col justify-end">
          <span className="mb-1 text-xs font-medium text-muted">Strategy</span>
          <span className="rounded-md border bg-panel px-3 py-2 text-sm text-ink">Blue-green</span>
        </div>
        <TextInput label="Commit SHA" value={commitSha} onChange={onCommitShaChange} placeholder="optional" />
        <TextInput label="Actor" value={actor} onChange={onActorChange} placeholder="optional" />
      </div>
      <div className="grid gap-3 border-t p-4 md:grid-cols-[minmax(220px,0.8fr)_minmax(180px,0.7fr)_120px_minmax(220px,0.8fr)_auto_auto]">
        <SelectInput label="Registry" value={selectedRegistry?.id ?? ''} onChange={onRegistryChange} disabled={registries.length === 0}>
          <option value="">Manual ref</option>
          {registries.filter((registry) => registry.enabled).map((registry) => (
            <option key={registry.id} value={registry.id}>{registry.name}</option>
          ))}
        </SelectInput>
        <TextInput label="Image" value={imageName} onChange={onImageNameChange} placeholder={selectedRegistry?.default_image || 'workflows-server'} />
        <TextInput label="Tag" value={imageTag} onChange={onImageTagChange} placeholder="v2" />
        <TextInput label="Image digest" value={imageDigest} onChange={onImageDigestChange} placeholder="sha256:..." />
        <div className="flex items-end">
          <Button variant="primary" disabled={!target || isQueueing || !blueGreenReady} onClick={onQueue}>
            <Rocket className="size-4" />
            {isQueueing ? 'Queueing...' : 'Queue deploy'}
          </Button>
        </div>
        <div className="flex items-end">
          <Button variant="secondary" disabled={!target || isRollingBack || !rollbackReady} onClick={onRollback}>
            <RotateCcw className="size-4" />
            {isRollingBack ? 'Rolling back...' : 'Rollback'}
          </Button>
        </div>
      </div>
      <div className="border-t px-4 py-3 text-sm text-muted">
        {selectedRegistry
          ? <>Resolved image ref: <span className="font-mono text-ink">{resolvedImageRef(selectedRegistry, imageName, imageTag) || 'choose image and tag'}</span></>
          : <>Manual image ref: <span className="font-mono text-ink">{imageRef || 'optional full image reference'}</span></>
        }
      </div>
      {!selectedRegistry && (
        <div className="grid gap-3 border-t p-4 md:grid-cols-[minmax(280px,1fr)]">
          <TextInput label="Manual image ref" value={imageRef} onChange={onImageRefChange} placeholder="us-east1-docker.pkg.dev/project/repo/image:tag" />
          {canBuildFromSource(target) && !imageRef.trim() && (
            <p className="text-xs text-muted">
              Leave blank to build from the application repository (<span className="font-mono text-ink">{target?.repository_url}</span>) on the target server using <span className="font-mono text-ink">{target?.compose_path}</span>.
            </p>
          )}
        </div>
      )}
      <div className="border-t px-4 py-3 text-sm text-muted">
        Blue-green compose targets must use <span className="font-mono text-ink">DEPLOY_COLOR</span> for color-specific service names, labels, or ports, and the application health check URL must include <span className="font-mono text-ink">{'{color}'}</span>.
      </div>
      {blueGreenError && (
        <div className="border-t px-4 py-3 text-sm text-danger">
          {blueGreenError}
        </div>
      )}
    </Panel>
  )
}

function resolvedImageRef(registry: ContainerRegistry, imageName: string, imageTag: string): string {
  const image = cleanImagePath(imageName || registry.default_image)
  const tag = imageTag.trim()
  if (!image || !tag) {
    return ''
  }
  return `${registryBasePath(registry)}/${image}:${tag}`
}

function registryBasePath(registry: ContainerRegistry): string {
  return [registry.registry_host, registry.namespace, registry.repository].map(cleanImagePath).filter(Boolean).join('/')
}

function cleanImagePath(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}

function canBuildFromSource(target: Application | undefined): boolean {
  return Boolean(target?.repository_url?.trim() && target?.compose_path?.trim())
}

function blueGreenHealthCheckError(value: string): string {
  if (!value.trim().includes('{color}')) {
    return 'Configure a health check URL with {color} before queueing blue-green deployments.'
  }
  try {
    validateHealthCheckURL(value)
  } catch (error) {
    return error instanceof Error ? error.message : 'Health check URL is invalid.'
  }
  return ''
}

type DeploymentListProps = {
  deployments: Deployment[]
  selectedDeployment?: Deployment
  isCancelling: boolean
  isRetrying: boolean
  onInspect: (deploymentID: string) => void
  onCancel: (deploymentID: string) => void
  onRetry: (deploymentID: string) => void
}

export function DeploymentList({
  deployments,
  selectedDeployment,
  isCancelling,
  isRetrying,
  onInspect,
  onCancel,
  onRetry,
}: DeploymentListProps) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Deployment</th>
              <th className="px-4 py-3 font-medium">Target</th>
              <th className="px-4 py-3 font-medium">Strategy</th>
              <th className="px-4 py-3 font-medium">Trigger</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Actor</th>
              <th className="px-4 py-3 font-medium">Commit</th>
              <th className="px-4 py-3 font-medium">Actions</th>
            </tr>
          </thead>
          <tbody>
            {deployments.map((deployment) => (
              <tr key={deployment.id} className={deployment.id === selectedDeployment?.id ? 'border-t bg-accent/5' : 'border-t'}>
                <td className="px-4 py-3 font-mono text-xs text-muted">{deployment.id.slice(0, 8)}</td>
                <td className="px-4 py-3">
                  <div className="font-medium">{deployment.application_name}</div>
                  <div className="text-xs text-muted">{deployment.server_name}</div>
                </td>
                <td className="px-4 py-3 text-muted">{deployment.strategy}</td>
                <td className="px-4 py-3 text-muted">{deployment.trigger}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(deployment.status)}>{deployment.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted">{deployment.actor ?? 'system'}</td>
                <td className="max-w-60 truncate px-4 py-3 font-mono text-xs text-muted">{deployment.image_digest?.slice(0, 19) ?? deployment.image_ref ?? deployment.commit_sha?.slice(0, 12) ?? 'n/a'}</td>
                <td className="px-4 py-3">
                  <div className="flex flex-wrap gap-2">
                    <Button variant="ghost" onClick={() => onInspect(deployment.id)}>
                      <ScrollText className="size-4" />
                      Inspect
                    </Button>
                    {deployment.status === 'queued' && (
                      <Button variant="ghost" disabled={isCancelling} onClick={() => onCancel(deployment.id)}>
                        <Ban className="size-4" />
                        Cancel
                      </Button>
                    )}
                    {(deployment.status === 'failed' || deployment.status === 'cancelled') && (
                      <Button variant="ghost" disabled={isRetrying} onClick={() => onRetry(deployment.id)}>
                        <RotateCcw className="size-4" />
                        Retry
                      </Button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {deployments.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No deployments found.</div>}
    </Panel>
  )
}
