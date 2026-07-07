import { useQuery } from '@tanstack/react-query'
import { AlertTriangle, ChevronDown, Clipboard, Radio, Search } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
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
  const [streamedLogs, setStreamedLogs] = useState<DeploymentLog[]>([])
  const [live, setLive] = useState(false)
  const history = useQuery({
    ...deploymentLogsQuery(deploymentID ?? ''),
    enabled: Boolean(deploymentID),
  })

  useEffect(() => {
    if (!deploymentID) {
      setStreamedLogs([])
      setLive(false)
      return
    }
    if (typeof EventSource === 'undefined') {
      return
    }

    setStreamedLogs([])
    setLive(true)
    const events = new EventSource(withAccessToken(`/api/deployments/${deploymentID}/events`))
    events.addEventListener('open', () => setLive(true))
    events.addEventListener('error', () => {
      // EventSource auto-reconnects unless the connection is permanently closed.
      // Only mark the stream as not-live once it reaches the CLOSED state.
      if (events.readyState === EventSource.CLOSED) {
        setLive(false)
      }
    })
    events.addEventListener('log', (event) => {
      let entry: DeploymentLog
      try {
        entry = JSON.parse(event.data) as DeploymentLog
      } catch {
        return
      }
      setStreamedLogs((state) => [...state.slice(-(maxLogLines - 1)), entry])
    })
    return () => {
      events.close()
      setLive(false)
    }
  }, [deploymentID])

  const logs = useMemo(
    () => mergeLogs(history.data ?? [], streamedLogs),
    [history.data, streamedLogs],
  )
  return { logs, live }
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
}: {
  deployment: DeploymentSummary
  logs: DeploymentLog[]
  live?: boolean
  className?: string
}) {
  const [query, setQuery] = useState('')
  const filteredLogs = useMemo(() => filterLogs(logs, query), [logs, query])
  const warningCount = logs.filter(isWarningLog).length
  const logText = logs.map((entry) => `${formatLogTime(entry.created_at)} ${entry.message}`).join('\n')

  return (
    <div className={className}>
      <div className="mx-auto max-w-6xl">
        <div className="mb-5">
          <h2 className="text-2xl font-semibold text-ink">Deployment</h2>
          <div className="mt-5 flex items-center gap-3 text-base text-ink">
            <span className={cn('size-4 rounded-full border-2', live ? 'animate-spin border-muted border-t-accent' : 'border-muted')} />
            <span>Deployment {deployment.status ?? 'started'} {relativeDeploymentTime(deployment)}...</span>
          </div>
        </div>

        <section className="overflow-hidden rounded-lg border bg-surface">
          <header className="flex min-h-16 items-center justify-between gap-4 border-b px-4">
            <div className="flex min-w-0 items-center gap-3">
              <ChevronDown className="size-5 text-muted" />
              <div className="truncate text-lg font-medium text-ink">Build Logs</div>
            </div>
            <div className="flex items-center gap-3 text-sm text-muted">
              <span>{deploymentDuration(deployment)}</span>
              <Badge tone={live ? 'accent' : 'neutral'}>
                <Radio className="mr-1 size-3" />
                {live ? 'live stream' : 'disconnected'}
              </Badge>
            </div>
          </header>

          <div className="flex flex-wrap items-center gap-3 border-b bg-panel/60 px-4 py-3">
            <button
              type="button"
              className="inline-flex items-center gap-2 rounded-md text-sm text-muted transition-colors hover:text-ink"
              onClick={() => void copyText(logText)}
            >
              <Clipboard className="size-4" />
              {logs.length} {logs.length === 1 ? 'line' : 'lines'}
            </button>
            <div className="inline-flex items-center gap-2 text-sm text-ink">
              <AlertTriangle className={cn('size-4', warningCount ? 'text-warning' : 'text-muted')} />
              {warningCount}
            </div>
            <label className="ml-auto flex h-9 min-w-64 items-center gap-2 rounded-md border bg-background px-3 text-sm text-muted focus-within:ring-2 focus-within:ring-accent">
              <Search className="size-4" />
              <input
                className="w-full bg-transparent text-ink outline-none placeholder:text-muted/70"
                value={query}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Find in logs"
              />
              <span className="hidden rounded border px-1.5 py-0.5 text-xs text-muted md:inline">⌘F</span>
            </label>
          </div>

          <div className="max-h-[min(56vh,620px)] overflow-auto bg-background py-3 font-mono text-[13px] leading-6">
            {filteredLogs.length === 0 && <div className="px-4 py-5 text-sm text-muted">{logs.length === 0 ? 'No logs have been written yet.' : 'No matching log lines.'}</div>}
            {filteredLogs.map((entry, index) => (
              <LogLine key={`${entry.id ?? 'live'}-${index}`} entry={entry} />
            ))}
          </div>

          <footer className="border-t bg-surface">
            <details className="group">
              <summary className="flex min-h-14 cursor-pointer list-none items-center gap-3 px-4 text-sm font-medium text-muted transition-colors hover:text-ink">
                <ChevronDown className="size-4 -rotate-90 transition-transform group-open:rotate-0" />
                Deployment Summary
              </summary>
              <div className="grid gap-3 border-t px-4 py-4 text-sm md:grid-cols-3">
                <SummaryItem label="Target" value={`${deployment.application_name ?? 'deployment'} / ${deployment.server_name ?? 'server'}`} />
                <SummaryItem label="Strategy" value={deployment.strategy ?? 'n/a'} />
                <SummaryItem label="Trigger" value={deployment.trigger ?? 'n/a'} />
                <SummaryItem label="Actor" value={deployment.actor ?? 'system'} />
                <SummaryItem label="Commit" value={deployment.commit_sha?.slice(0, 12) ?? 'not pinned'} />
                <SummaryItem label="Image" value={deployment.image_digest?.slice(0, 19) ?? deployment.image_ref ?? 'not pinned'} />
              </div>
            </details>
          </footer>
        </section>
      </div>
    </div>
  )
}

function LogLine({ entry }: { entry: DeploymentLog }) {
  const tone = logTone(entry)
  return (
    <div
      className={cn(
        'grid grid-cols-[132px_minmax(0,1fr)] gap-3 px-4',
        tone === 'warning' && 'bg-warning/15 text-warning',
        tone === 'danger' && 'bg-danger/15 text-danger',
        tone === 'system' && 'text-accent',
        tone === 'neutral' && 'text-ink',
      )}
    >
      <span className="select-none text-muted">{formatLogTime(entry.created_at)}</span>
      <span className="min-w-0 whitespace-pre-wrap break-words">{entry.message}</span>
    </div>
  )
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <div className="text-xs text-muted">{label}</div>
      <div className="mt-1 truncate font-mono text-xs text-ink">{value}</div>
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

function relativeDeploymentTime(deployment: DeploymentSummary): string {
  const value = deployment.started_at ?? deployment.created_at
  const date = value ? new Date(value) : undefined
  if (!date || Number.isNaN(date.getTime())) {
    return 'just now'
  }
  const seconds = Math.max(0, Math.round((Date.now() - date.getTime()) / 1000))
  if (seconds < 60) {
    return `${seconds}s ago`
  }
  const minutes = Math.round(seconds / 60)
  if (minutes < 60) {
    return `${minutes}m ago`
  }
  const hours = Math.round(minutes / 60)
  return `${hours}h ago`
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

function pad(value: number, length: number): string {
  return String(value).padStart(length, '0')
}

async function copyText(value: string): Promise<void> {
  if (!value || !navigator.clipboard) {
    return
  }
  await navigator.clipboard.writeText(value)
}
