import { useQuery } from '@tanstack/react-query'
import { Radio, ScrollText } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Panel } from '../../components/ui/panel'
import type { DeploymentLog } from '../../lib/api'
import { deploymentLogsQuery } from '../../lib/queries'

type DeploymentSummary = {
  id: string
  application_name?: string
  server_name?: string
}

export function useDeploymentLogs(deploymentID: string | undefined) {
  const [streamedLogs, setStreamedLogs] = useState<DeploymentLog[]>([])
  const history = useQuery({
    ...deploymentLogsQuery(deploymentID ?? ''),
    enabled: Boolean(deploymentID),
  })

  useEffect(() => {
    if (!deploymentID) {
      setStreamedLogs([])
      return
    }
    if (typeof EventSource === 'undefined') {
      return
    }

    setStreamedLogs([])
    const events = new EventSource(`/api/deployments/${deploymentID}/events`)
    events.addEventListener('log', (event) => {
      let entry: DeploymentLog
      try {
        entry = JSON.parse(event.data) as DeploymentLog
      } catch {
        return
      }
      setStreamedLogs((state) => [...state.slice(-399), entry])
    })
    return () => events.close()
  }, [deploymentID])

  return useMemo(
    () => mergeLogs(history.data ?? [], streamedLogs),
    [history.data, streamedLogs],
  )
}

export function DeploymentLogsPanel({
  deployment,
  logs,
}: {
  deployment: DeploymentSummary | undefined
  logs: DeploymentLog[]
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
            <Badge tone="accent">
              <Radio className="mr-1 size-3" />
              live stream
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
  const seen = new Set<number>()
  for (const entry of [...history, ...streamed]) {
    if (entry.id) {
      if (seen.has(entry.id)) {
        continue
      }
      seen.add(entry.id)
    }
    logs.push(entry)
  }
  return logs.slice(-500)
}
