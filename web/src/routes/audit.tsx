import { useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { Panel } from '../components/ui/panel'
import { auditEventsQuery } from '../lib/queries'
import { formatTimestamp } from '../lib/format'

const pageSize = 10

export function AuditRoute() {
  const { data: events } = useSuspenseQuery(auditEventsQuery)
  const [page, setPage] = useState(1)
  const pageCount = Math.max(1, Math.ceil(events.length / pageSize))
  const currentPage = Math.min(page, pageCount)
  const pageEvents = events.slice((currentPage - 1) * pageSize, currentPage * pageSize)
  const firstRow = (currentPage - 1) * pageSize + 1
  const lastRow = Math.min(currentPage * pageSize, events.length)

  return (
    <div className="space-y-5">
      <PageHeader title="Audit trail" description="Control-plane changes across servers, applications, deployments, connectors, and proxy routes." />
      <Panel>
        <div className="overflow-x-auto">
          <table className="w-full text-left text-sm">
            <thead className="text-xs text-prosights-muted">
              <tr>
                <th className="px-4 py-3 font-medium">Time</th>
                <th className="px-4 py-3 font-medium">Action</th>
                <th className="px-4 py-3 font-medium">Target</th>
                <th className="px-4 py-3 font-medium">Actor</th>
                <th className="px-4 py-3 font-medium">Metadata</th>
              </tr>
            </thead>
            <tbody>
              {pageEvents.map((event) => {
                const metadata = formatMetadata(event.metadata)
                return (
                  <tr key={event.id} className="border-t">
                    <td className="px-4 py-3 font-mono text-xs text-prosights-muted">{formatTimestamp(event.created_at, 'n/a')}</td>
                    <td className="px-4 py-3"><Badge tone="accent">{event.action}</Badge></td>
                    <td className="px-4 py-3">
                      <div className="font-medium">{event.target_name}</div>
                      <div className="text-xs text-prosights-muted">{event.target_type} / {event.target_id}</div>
                    </td>
                    <td className="px-4 py-3 text-prosights-muted">{event.actor}</td>
                    <td className="max-w-[520px] truncate px-4 py-3 font-mono text-xs text-prosights-muted" title={metadata}>{metadata}</td>
                  </tr>
                )
              })}
            </tbody>
          </table>
        </div>
        {events.length === 0 && <div className="border-t px-4 py-6 text-sm text-prosights-muted">No audit events match the current search.</div>}
        {pageCount > 1 && (
          <nav aria-label="Audit pages" className="flex flex-wrap items-center justify-between gap-3 border-t px-4 py-3">
            <span className="text-xs tabular-nums text-prosights-muted">Showing {firstRow}–{lastRow} of {events.length}</span>
            <div className="flex items-center gap-2">
              <Button type="button" disabled={currentPage === 1} onClick={() => setPage(currentPage - 1)}>Previous</Button>
              <span className="min-w-16 text-center text-xs tabular-nums text-prosights-muted">{currentPage} of {pageCount}</span>
              <Button type="button" disabled={currentPage === pageCount} onClick={() => setPage(currentPage + 1)}>Next</Button>
            </div>
          </nav>
        )}
      </Panel>
    </div>
  )
}

// The API returns metadata as an object; anything else renders as {}.
function formatMetadata(value: unknown): string {
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

function formatMetadataValue(value: unknown): string {
  if (value === null || value === undefined) {
    return 'null'
  }
  if (typeof value === 'object') {
    return JSON.stringify(value)
  }
  return String(value)
}
