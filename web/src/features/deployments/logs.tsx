import { useQuery } from '@tanstack/react-query'
import { Radio, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Panel } from '../../components/ui/panel'
import type { DeploymentLog } from '../../lib/api'
import { withAccessToken } from '../../lib/api'
import { deploymentLogsQuery } from '../../lib/queries'

type DeploymentSummary = {
  id: string
  application_name?: string
  server_name?: string
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
      {deployment && (
        <>
          <div className="flex flex-wrap items-center justify-between gap-3 border-b px-4 py-3">
            <div>
              <div className="flex items-center gap-2 text-sm font-medium">
                <ScrollText className="size-4 text-accent" />
                {deployment.application_name ?? deployment.id.slice(0, 8)}
              </div>
              <div className="mt-1 text-xs text-muted">{deployment.server_name ?? 'server'} / {deployment.id}</div>
            </div>
            <Badge tone={live ? 'accent' : 'neutral'}>
              <Radio className="mr-1 size-3" />
              {live ? 'live stream' : 'disconnected'}
            </Badge>
          </div>
          <div className="max-h-[420px] overflow-auto bg-background p-4 font-mono text-xs leading-6">
            {logs.length === 0 && <div className="text-muted">No logs have been written yet.</div>}
            {logs.map((entry, index) => (
              <div key={`${entry.id ?? 'live'}-${index}`} className={entry.stream === 'stderr' ? 'text-danger' : entry.stream === 'system' ? 'text-accent' : 'text-muted'}>
                <span className="mr-2 text-muted/70">{entry.stream}</span>
                <span className="whitespace-pre-wrap">{entry.message}</span>
              </div>
            ))}
          </div>
        </>
      )}
    </Panel>
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
