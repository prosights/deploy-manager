import { useRouter, type ErrorComponentProps } from '@tanstack/react-router'
import { useQueryClient } from '@tanstack/react-query'
import { AlertTriangle, RotateCcw } from 'lucide-react'
import { Button } from './ui/button'
import { Panel } from './ui/panel'

export function AppError({ error, reset }: ErrorComponentProps) {
  const queryClient = useQueryClient()
  const router = useRouter()

  // Drop the failed queries, then re-run the route loaders and re-render.
  async function retry() {
    queryClient.resetQueries()
    await router.invalidate()
    reset()
  }

  return (
    <main className="min-h-screen bg-prosights-canvas p-6 text-prosights-text">
      <div className="mx-auto flex min-h-[calc(100vh-3rem)] max-w-2xl items-center">
        <Panel className="w-full">
          <div className="space-y-5 p-5">
            <div className="flex items-start gap-3">
              <div className="rounded-md border border-danger/30 bg-danger/10 p-2 text-danger">
                <AlertTriangle className="size-5" />
              </div>
              <div className="min-w-0 space-y-1">
                <h1 className="text-base font-semibold text-prosights-text">Paddock could not load</h1>
                <p className="text-sm text-prosights-muted">
                  The API request failed or returned data the app could not use.
                </p>
              </div>
            </div>
            <pre className="max-h-40 overflow-auto rounded-md border bg-prosights-surface-muted p-3 text-xs text-prosights-muted">
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
