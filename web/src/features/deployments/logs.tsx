import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Clipboard, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Panel } from '../../components/ui/panel'
import { cn } from '../../lib/cn'
import type { DeploymentLog } from '../../lib/api'
import { withAccessToken } from '../../lib/api'
import { deploymentLogsQuery } from '../../lib/queries'

type DeploymentSummary = {
  id: string
  application_name?: string
  server_name?: string
  status?: string
  trigger?: string
  strategy?: string
  actor?: string | null
  commit_sha?: string | null
  image_ref?: string | null
  image_digest?: string | null
  created_at?: string
  started_at?: string | null
  finished_at?: string | null
}

export function useDeploymentLogs(deploymentID: string | undefined) {
  const [stream, setStream] = useState<{ deploymentID: string; logs: DeploymentLog[] }>({ deploymentID: '', logs: [] })
  const [liveDeploymentID, setLiveDeploymentID] = useState('')
  const history = useQuery({
    ...deploymentLogsQuery(deploymentID ?? ''),
    enabled: Boolean(deploymentID),
  })

  useEffect(() => {
    if (!deploymentID || typeof EventSource === 'undefined') {
      return
    }

    const events = new EventSource(withAccessToken(`/api/deployments/${deploymentID}/events`))
    events.addEventListener('open', () => setLiveDeploymentID(deploymentID))
    events.addEventListener('error', () => {
      // EventSource auto-reconnects unless the connection is permanently closed.
      // Only mark the stream as not-live once it reaches the CLOSED state.
      if (events.readyState === EventSource.CLOSED) {
        setLiveDeploymentID((current) => current === deploymentID ? '' : current)
      }
    })
    events.addEventListener('log', (event) => {
      let entry: DeploymentLog
      try {
        entry = JSON.parse(event.data) as DeploymentLog
      } catch {
        return
      }
      setStream((current) => {
        const logs = current.deploymentID === deploymentID ? current.logs : []
        return { deploymentID, logs: [...logs.slice(-(maxLogLines - 1)), entry] }
      })
    })
    return () => {
      events.close()
    }
  }, [deploymentID])

  const logs = useMemo(() => {
    const streamedLogs = stream.deploymentID === deploymentID ? stream.logs : []
    return mergeLogs(history.data ?? [], streamedLogs)
  }, [deploymentID, history.data, stream])
  return { logs, live: liveDeploymentID === deploymentID }
}

const maxLogLines = 500

export function DeploymentLogsPanel({
  deployment,
  logs,
  live = false,
}: {
  deployment: DeploymentSummary | undefined
  logs: DeploymentLog[]
  live?: boolean
}) {
  return (
    <Panel title="Deployment logs">
      {!deployment && <div className="p-4 text-sm text-muted">Select a deployment to inspect logs.</div>}
      {deployment && <DeploymentLogStream deployment={deployment} logs={logs} live={live} />}
    </Panel>
  )
}

export function DeploymentLogStream({
  deployment,
  logs,
  live = false,
  className = '',
  showDetails = true,
}: {
  deployment: DeploymentSummary
  logs: DeploymentLog[]
  live?: boolean
  className?: string
  showDetails?: boolean
}) {
  const [query, setQuery] = useState('')
  const displayLogs = useMemo(() => expandLogLines(logs), [logs])
  const filteredLogs = useMemo(() => filterLogs(displayLogs, query), [displayLogs, query])
  const warningCount = displayLogs.filter(isWarningLog).length
  const logText = displayLogs.map((entry) => `${formatLogTime(entry.created_at)} ${entry.message}`).join('\n')

  return (
    <div className={cn('flex min-h-0 flex-col overflow-hidden bg-prosights-surface', className)}>
      <div className="flex items-center gap-2 border-b border-prosights-border bg-prosights-surface p-2">
        <label className="flex h-9 min-w-0 flex-1 items-center gap-2 rounded-prosights-sm border border-prosights-border bg-prosights-canvas px-3 text-xs text-prosights-muted focus-within:border-prosights-subtle">
          <Search className="size-3.5 shrink-0" />
          <input
            aria-label="Filter logs"
            className="min-w-0 flex-1 bg-transparent text-prosights-text outline-none placeholder:text-prosights-subtle"
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder="Filter and search logs"
          />
        </label>
        <button
          type="button"
          aria-label={`Copy ${displayLogs.length} log lines`}
          title="Copy logs"
          className="inline-flex size-9 shrink-0 items-center justify-center rounded-prosights-sm bg-black text-white transition-colors duration-100 hover:bg-black/80"
          onClick={() => void copyText(logText)}
        >
          <Clipboard className="size-3.5" />
        </button>
      </div>
      <div className="grid grid-cols-[152px_minmax(0,1fr)_auto] items-center gap-3 border-b border-prosights-border bg-prosights-surface-muted px-4 py-2 text-[10px] font-semibold uppercase tracking-[0.08em] text-prosights-muted">
        <span>Time</span>
        <span>Data</span>
        <div className="flex items-center gap-3 normal-case tracking-normal">
          {warningCount > 0 && (
            <span className="inline-flex items-center gap-1 text-warning">
              <AlertTriangle className="size-3" />
              {warningCount}
            </span>
          )}
          <span className="inline-flex items-center gap-1.5">
            <span className={cn('size-1.5 rounded-full', live ? 'animate-pulse bg-success' : 'bg-prosights-subtle')} />
            {live ? 'Live' : deploymentDuration(deployment)}
          </span>
        </div>
      </div>
      <div className="min-h-0 flex-1 overflow-auto bg-prosights-canvas py-1 font-mono text-[12px] leading-5">
        {filteredLogs.length === 0 && <div className="px-4 py-5 text-sm text-prosights-muted">{displayLogs.length === 0 ? 'Waiting for logs…' : 'No matching log lines.'}</div>}
        {filteredLogs.map((entry, index) => (
          <LogLine key={`${entry.id ?? 'live'}-${index}`} entry={entry} />
        ))}
      </div>
      {showDetails && (
        <details className="group shrink-0 border-t border-prosights-border bg-prosights-surface text-prosights-muted">
          <summary className="flex h-10 cursor-pointer list-none items-center gap-2 px-4 text-xs font-medium hover:text-prosights-text">
            <ChevronDown className="size-3.5 -rotate-90 transition-transform group-open:rotate-0" />
            Deployment details
          </summary>
          <div className="grid gap-3 border-t border-prosights-border px-4 py-3 text-xs md:grid-cols-3">
            <SummaryItem label="Target" value={`${deployment.application_name ?? 'deployment'} / ${deployment.server_name ?? 'server'}`} />
            <SummaryItem label="Strategy" value={deployment.strategy ?? 'n/a'} />
            <SummaryItem label="Trigger" value={deployment.trigger ?? 'n/a'} />
            <SummaryItem label="Actor" value={deployment.actor ?? 'system'} />
            <SummaryItem label="Commit" value={deployment.commit_sha?.slice(0, 12) ?? 'not pinned'} />
            <SummaryItem label="Image" value={deployment.image_digest?.slice(0, 19) ?? deployment.image_ref ?? 'not pinned'} />
          </div>
        </details>
      )}
    </div>
  )
}

function LogLine({ entry }: { entry: DeploymentLog }) {
  const tone = logTone(entry)
  return (
    <div
      className={cn(
        'grid min-h-8 grid-cols-[152px_minmax(0,1fr)] gap-3 border-l-2 border-transparent px-4 py-1.5',
        tone === 'warning' && 'border-amber-500/70 bg-amber-500/[0.04] text-prosights-text',
        tone === 'danger' && 'border-danger/70 bg-danger/[0.04] text-prosights-text',
        tone === 'system' && 'text-prosights-muted',
        tone === 'neutral' && 'text-prosights-text',
      )}
    >
      <span className="select-none whitespace-nowrap text-[11px] text-prosights-subtle">{formatLogTime(entry.created_at)}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words text-[11.5px]">{entry.message}</span>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-prosights-subtle">{label}</div>
      <div className="mt-1 truncate font-mono text-prosights-text">{value}</div>
    </div>
  )
}

function mergeLogs(history: DeploymentLog[], streamed: DeploymentLog[]) {
  const logs: DeploymentLog[] = []
  const seenIDs = new Set<number>()
  const seenContent = new Set<string>()
  for (const entry of [...history, ...streamed]) {
    if (entry.id) {
      if (seenIDs.has(entry.id)) {
        continue
      }
      seenIDs.add(entry.id)
    } else {
      // Live entries may arrive without an id and can also appear in the final
      // history refetch. De-dupe those by a stable content key.
      const key = `${entry.created_at ?? ''}|${entry.stream}|${entry.message}`
      if (seenContent.has(key)) {
        continue
      }
      seenContent.add(key)
    }
    logs.push(entry)
  }
  return logs.slice(-maxLogLines)
}

export function expandLogLines(logs: DeploymentLog[]): DeploymentLog[] {
  return logs.flatMap((entry) => {
    const lines = entry.message.replaceAll('\r\n', '\n').split('\n')
    return lines.map((message) => ({ ...entry, message }))
  }).slice(-maxLogLines)
}

function filterLogs(logs: DeploymentLog[], query: string): DeploymentLog[] {
  const value = query.trim().toLowerCase()
  if (!value) {
    return logs
  }
  return logs.filter((entry) => entry.message.toLowerCase().includes(value) || entry.stream.includes(value))
}

function isWarningLog(entry: DeploymentLog): boolean {
  return logTone(entry) === 'warning' || logTone(entry) === 'danger'
}

function logTone(entry: DeploymentLog): 'danger' | 'warning' | 'system' | 'neutral' {
  const message = entry.message.toLowerCase()
  if (entry.stream === 'stderr' || message.includes('error') || message.includes('failed')) {
    return 'danger'
  }
  if (message.includes('warn')) {
    return 'warning'
  }
  if (entry.stream === 'system') {
    return 'system'
  }
  return 'neutral'
}

function formatLogTime(value?: string): string {
  const date = value ? new Date(value) : undefined
  if (!date || Number.isNaN(date.getTime())) {
    return '--:--:--.---'
  }
  return [
    pad(date.getHours(), 2),
    pad(date.getMinutes(), 2),
    pad(date.getSeconds(), 2),
  ].join(':') + `.${pad(date.getMilliseconds(), 3)}`
}

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

function deploymentDuration(deployment: DeploymentSummary): string {
  const start = deployment.started_at ?? deployment.created_at
  if (!start) {
    return '0s'
  }
  const startedAt = new Date(start)
  const endedAt = deployment.finished_at ? new Date(deployment.finished_at) : new Date()
  if (Number.isNaN(startedAt.getTime()) || Number.isNaN(endedAt.getTime())) {
    return '0s'
  }
  const seconds = Math.max(0, Math.round((endedAt.getTime() - startedAt.getTime()) / 1000))
  const minutes = Math.floor(seconds / 60)
  const remainder = seconds % 60
  if (minutes === 0) {
    return `${remainder}s`
  }
  return `${minutes}m ${remainder}s`
}

async function copyText(value: string): Promise<void> {
  if (!value || !navigator.clipboard) {
    return
  }
  await navigator.clipboard.writeText(value)
}
