import { ArrowLeft, MapPinned } from 'lucide-react'
import { Panel } from './ui/panel'

export function AppNotFound() {
  return (
    <div className="mx-auto max-w-2xl">
      <Panel>
        <div className="space-y-5 p-5">
          <div className="flex items-start gap-3">
            <div className="rounded-md border border-accent/30 bg-accent/10 p-2 text-accent">
              <MapPinned className="size-5" />
            </div>
            <div className="min-w-0 space-y-1">
              <h1 className="text-base font-semibold text-ink">Route not found</h1>
              <p className="text-sm text-muted">
                This page is not part of the deployment manager.
              </p>
            </div>
          </div>
          <a
            className="inline-flex h-9 items-center justify-center gap-2 rounded-md border bg-panel px-3 text-sm font-medium text-ink transition-colors hover:bg-surface focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-accent"
            href="/projects"
          >
            <ArrowLeft className="size-4" />
            Projects
          </a>
        </div>
      </Panel>
    </div>
  )
}
