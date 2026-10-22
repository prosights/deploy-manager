import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Activity } from 'lucide-react'
import type { Application } from '../../lib/api'
import { deploymentsQuery, serverCheckQuery, serversQuery } from '../../lib/queries'
import { deploymentDurationSeconds, forApplication, formatSeconds } from './helpers'

export function MetricsTab({ application }: { application: Application }) {
  const { data: deployments } = useSuspenseQuery({ ...deploymentsQuery, select: forApplication(application.id) })
  const { data: listedServer } = useSuspenseQuery({ ...serversQuery, select: (servers) => servers.find((server) => server.id === application.server_id) })
  // The check refreshes the host's usage numbers; show the listed values until it answers.
  const check = useQuery(serverCheckQuery(application.server_id))
  const server = check.data?.server ?? listedServer
  const completed = deployments.filter((deployment) => deployment.status === 'succeeded' || deployment.status === 'failed')
  const succeeded = completed.filter((deployment) => deployment.status === 'succeeded').length
  const durations = completed.flatMap((deployment) => deploymentDurationSeconds(deployment) ?? [])
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

function DeploymentFact({ label, value }: { label: string, value: string }) {
  return <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface px-4 py-3"><div className="text-[11px] text-prosights-muted">{label}</div><div className="mt-1 truncate text-[13px] font-medium capitalize text-prosights-text">{value}</div></div>
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

function medianValue(values: number[]): number | undefined {
  if (!values.length) return undefined
  const sorted = [...values].sort((a, b) => a - b)
  const middle = Math.floor(sorted.length / 2)
  return sorted.length % 2 ? sorted[middle] : Math.round((sorted[middle - 1] + sorted[middle]) / 2)
}
