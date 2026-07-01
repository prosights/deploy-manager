import { useSuspenseQuery } from '@tanstack/react-query'
import { useMemo } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Panel } from '../components/ui/panel'
import { auditEventsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useUiStore } from '../store/ui'

export function AuditRoute() {
  const { data: events } = useSuspenseQuery(auditEventsQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const rows = useMemo(() => events.map(auditEventRow), [events])
  const visibleRows = useMemo(() => rows.filter((row) => matchesSearch(searchQuery, row.searchValues)), [rows, searchQuery])

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
              {visibleRows.map((row) => (
                <tr key={row.id} className="border-t">
                  <td className="px-4 py-3 font-mono text-xs text-muted">{row.createdAt}</td>
                  <td className="px-4 py-3"><Badge tone="accent">{row.action}</Badge></td>
                  <td className="px-4 py-3">
                    <div className="font-medium">{row.targetName}</div>
                    <div className="text-xs text-muted">{row.targetType} / {row.targetID}</div>
                  </td>
                  <td className="px-4 py-3 text-muted">{row.actor}</td>
                  <td className="max-w-[520px] truncate px-4 py-3 font-mono text-xs text-muted" title={row.metadata}>{row.metadata}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        {visibleRows.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No audit events match the current search.</div>}
      </Panel>
    </div>
  )
}

type AuditEventRow = {
  id: number
  actor: string
  action: string
  targetType: string
  targetID: string
  targetName: string
  metadata: string
  createdAt: string
  searchValues: unknown[]
}

function auditEventRow(event: {
  id: number
  actor: string
  action: string
  target_type: string
  target_id: string
  target_name: string
  metadata: unknown
  created_at: string
}): AuditEventRow {
  const metadata = formatMetadata(event.metadata)
  return {
    id: event.id,
    actor: event.actor,
    action: event.action,
    targetType: event.target_type,
    targetID: event.target_id,
    targetName: event.target_name,
    metadata,
    createdAt: formatTime(event.created_at),
    searchValues: [
      event.actor,
      event.action,
      event.target_type,
      event.target_id,
      event.target_name,
      metadata,
    ],
  }
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
