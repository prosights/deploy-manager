import { Activity, ArrowUpRight } from 'lucide-react'
import { Link } from '@tanstack/react-router'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Panel } from '../../components/ui/panel'
import type { ConnectorAccount, Deployment, Server } from '../../lib/api'
import { percent, statusTone } from '../status'

type OverviewDashboardProps = {
  servers: Server[]
  activeDeployment?: Deployment
  applicationCount: number
  credentialCount: number
  connectors: ConnectorAccount[]
}

export function OverviewDashboard({
  servers,
  activeDeployment,
  applicationCount,
  credentialCount,
  connectors,
}: OverviewDashboardProps) {
  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h1 className="text-xl font-semibold">Operations</h1>
          <p className="mt-1 text-sm text-muted">Remote servers, compose deployments, proxy routes, and credential visibility.</p>
        </div>
        <Button asChild variant="primary">
          <Link to="/deployments">
            <Activity className="size-4" />
            New deployment
          </Link>
        </Button>
      </div>

      <div className="grid gap-4 lg:grid-cols-[1.2fr_0.8fr]">
        <ServerHealthPanel servers={servers} />
        <ActiveDeploymentPanel deployment={activeDeployment} />
      </div>

      <div className="grid gap-4 lg:grid-cols-3">
        <Panel title="Applications">
          <Metric value={applicationCount} label="compose targets" />
        </Panel>
        <Panel title="Credential inventory">
          <Metric value={credentialCount} label="tracked credentials" />
        </Panel>
        <Panel title="Connectors">
          <Metric value={connectors.filter((connector) => connector.enabled).length} label="enabled connectors" />
        </Panel>
      </div>
    </div>
  )
}

function ServerHealthPanel({ servers }: { servers: Server[] }) {
  return (
    <Panel title="Server health">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Server</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">CPU</th>
              <th className="px-4 py-3 font-medium">RAM</th>
              <th className="px-4 py-3 font-medium">Disk</th>
              <th className="px-4 py-3 font-medium">Last snapshot</th>
              <th className="px-4 py-3 font-medium">Proxy</th>
            </tr>
          </thead>
          <tbody>
            {servers.map((server) => (
              <tr key={server.id} className="border-t">
                <td className="px-4 py-3">
                  <div className="font-medium">{server.name}</div>
                  <div className="text-xs text-muted">{server.hostname}</div>
                </td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(server.status)}>{server.status}</Badge>
                </td>
                <td className="px-4 py-3 text-muted">{percent(server.cpu_usage)}</td>
                <td className="px-4 py-3 text-muted">{percent(server.memory_usage)}</td>
                <td className="px-4 py-3 text-muted">{percent(server.disk_usage)}</td>
                <td className="px-4 py-3 text-muted">{formatSnapshotTime(server.last_checked_at)}</td>
                <td className="px-4 py-3 text-muted">{server.proxy_type}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}

function ActiveDeploymentPanel({ deployment }: { deployment?: Deployment }) {
  return (
    <Panel title="Active deployment">
      <div className="space-y-4 p-4">
        {deployment ? (
          <>
            <div className="flex items-start justify-between gap-3">
              <div>
                <div className="font-medium">{deployment.application_name}</div>
                <div className="text-xs text-muted">{deployment.server_name}</div>
              </div>
              <Badge tone={statusTone(deployment.status)}>{deployment.status}</Badge>
            </div>
            <dl className="grid gap-3 rounded-md border bg-background p-3 text-sm sm:grid-cols-2">
              <DeploymentFact label="Strategy" value={deployment.strategy} />
              <DeploymentFact label="Trigger" value={deployment.trigger} />
              <DeploymentFact label="Commit" value={deployment.commit_sha?.slice(0, 12) ?? 'not pinned'} monospace />
              <DeploymentFact label="Started" value={formatDateTime(deployment.started_at)} />
              <DeploymentFact label="Created" value={formatDateTime(deployment.created_at)} />
              <DeploymentFact label="Finished" value={formatDateTime(deployment.finished_at)} />
            </dl>
          </>
        ) : (
          <div className="text-sm text-muted">No deployments have run yet.</div>
        )}
      </div>
    </Panel>
  )
}

function DeploymentFact({ label, value, monospace }: { label: string; value: string; monospace?: boolean }) {
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted">{label}</dt>
      <dd className={monospace ? 'truncate font-mono text-xs text-ink' : 'truncate text-sm text-ink'}>{value}</dd>
    </div>
  )
}

function formatDateTime(value: string | null) {
  if (!value) {
    return 'not set'
  }
  return new Date(value).toLocaleString()
}

function formatSnapshotTime(value: string | null) {
  if (!value) {
    return 'not checked'
  }
  return new Date(value).toLocaleString()
}

function Metric({ value, label }: { value: number; label: string }) {
  return (
    <div className="flex items-center justify-between p-4">
      <div>
        <div className="text-2xl font-semibold">{value}</div>
        <div className="text-sm text-muted">{label}</div>
      </div>
      <ArrowUpRight className="size-4 text-muted" />
    </div>
  )
}
