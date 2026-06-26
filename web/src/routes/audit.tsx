import { useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Panel } from '../components/ui/panel'
import { auditEventsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useUiStore } from '../store/ui'

export function AuditRoute() {
  const { data: events } = useSuspenseQuery(auditEventsQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const visibleEvents = events.filter((event) => matchesSearch(searchQuery, [
    event.actor,
    event.action,
    event.target_type,
    event.target_id,
    event.target_name,
    event.metadata,
  ]))

  return (
    <div className="space-y-5">
      <PageHeader title="Audit trail" description="Control-plane changes across servers, applications, deployments, connectors, proxy routes, and inventory syncs." />
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {visibleEvents.map((event) => (
                <tr key={event.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs text-muted">{formatTime(event.created_at)}</td>
                  <td className="px-4 py-3"><Badge tone="accent">{event.action}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{event.target_name}</div>
                    <div className="text-xs text-muted">{event.target_type} / {event.target_id}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">{event.actor}</td>
                  <td className="px-4 py-3 font-mono text-xs text-muted">{formatMetadata(event.metadata)}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleEvents.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No audit events match the current search.</div>}
      </Panel>
    </div>
  )
}

function formatTime(value: string) {
  if (!value) {
    return 'n/a'
  }
  return new Date(value).toLocaleString()
}

function formatMetadata(value: unknown) {
  if (!value || Array.isArray(value) || typeof value !== 'object') {
    return '{}'
  }
  const entries = Object.entries(value)
  if (entries.length === 0) {
    return '{}'
  }
  const formatted = entries.map(([key, item]) => `${key}=${formatMetadataValue(item)}`).join(' ')
  if (formatted.length > 240) {
    return `${formatted.slice(0, 240)}...`
  }
  return formatted
}

function formatMetadataValue(value: unknown) {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}
