import type { ErrorComponentProps } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './ui/button'
import { Panel } from './ui/panel'

export function AppError({ error, reset }: ErrorComponentProps) {
  const queryClient = useQueryClient()

  function retry() {
    queryClient.resetQueries()
    reset()
  }

  return (
    <main className="min-h-screen bg-background p-6 text-ink">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-2xl items-center">
        <Panel className="w-full">
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-danger">
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h1 className="text-base font-semibold text-ink">Deploy Manager could not load</h1>
                <p className="text-sm text-muted">
                  The API request failed or returned data the app could not use.
                </p>
              </div>
            </div>
            <pre className="max-h-40 overflow-auto rounded-md border bg-panel p-3 text-xs text-muted">
              {errorMessage(error)}
            </pre>
            <Button variant="primary" onClick={retry}>
              <RotateCcw className="size-4" />
              Retry
            </Button>
          </div>
        </Panel>
      </div>
    </main>
  )
}

function errorMessage(error: unknown): string {
  if (error instanceof Error && error.message.trim() !== '') {
    return error.message
  }
  return 'Unknown error'
}
