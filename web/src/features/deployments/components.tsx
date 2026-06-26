import { Ban, RotateCcw, Rocket, ScrollText } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import type { Application, Deployment } from '../../lib/api'
import { validateHealthCheckURL } from '../../lib/urls'
import { statusTone } from '../status'

type DeploymentQueuePanelProps = {
  applications: Application[]
  target?: Application
  strategy: 'rolling' | 'blue_green'
  commitSha: string
  actor: string
  isQueueing: boolean
  onApplicationChange: (applicationID: string) => void
  onStrategyChange: (strategy: 'rolling' | 'blue_green') => void
  onCommitShaChange: (commitSha: string) => void
  onActorChange: (actor: string) => void
  onQueue: () => void
}

export function DeploymentQueuePanel({
  applications,
  target,
  strategy,
  commitSha,
  actor,
  isQueueing,
  onApplicationChange,
  onStrategyChange,
  onCommitShaChange,
  onActorChange,
  onQueue,
}: DeploymentQueuePanelProps) {
  const blueGreenError = strategy === 'blue_green' ? blueGreenHealthCheckError(target?.health_check_url ?? '') : ''
  const blueGreenReady = blueGreenError === ''

  return (
    <Panel title="Queue deployment">
      <div className="grid gap-3 p-4 md:grid-cols-[minmax(180px,1fr)_160px_180px_180px_auto]">
        <SelectInput label="Application" value={target?.id ?? ''} onChange={onApplicationChange} disabled={applications.length === 0}>
          {applications.map((application) => (
            <option key={application.id} value={application.id}>{application.name} / {application.server_name}</option>
          ))}
        </SelectInput>
        <SelectInput label="Strategy" value={strategy} onChange={(value) => onStrategyChange(value as 'rolling' | 'blue_green')}>
          <option value="rolling">Rolling</option>
          <option value="blue_green">Blue-green</option>
        </SelectInput>
        <TextInput label="Commit SHA" value={commitSha} onChange={onCommitShaChange} placeholder="optional" />
        <TextInput label="Actor" value={actor} onChange={onActorChange} placeholder="optional" />
        <div className="flex items-end">
          <Button variant="primary" disabled={!target || isQueueing || !blueGreenReady} onClick={onQueue}>
            <Rocket className="size-4" />
            {isQueueing ? 'Queueing...' : 'Queue deploy'}
          </Button>
        </div>
      </div>
      {strategy === 'blue_green' && (
        <div className="border-t px-4 py-3 text-sm text-muted">
          Blue-green compose targets must use <span className="font-mono text-ink">DEPLOY_COLOR</span> for color-specific service names, labels, or ports, and the application health check URL must include <span className="font-mono text-ink">{'{color}'}</span>.
        </div>
      )}
      {blueGreenError && (
        <div className="border-t px-4 py-3 text-sm text-danger">
          {blueGreenError}
        </div>
      )}
    </Panel>
  )
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
                <td className="px-4 py-3 font-mono text-xs text-muted">{deployment.commit_sha?.slice(0, 12) ?? 'n/a'}</td>
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
