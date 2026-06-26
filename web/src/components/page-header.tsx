import type React from 'react'
import { Server as ServerIcon } from 'lucide-react'
import { Button } from './ui/button'

export function PageHeader({
  title,
  description,
  action,
  actionNode,
}: {
  title: string
  description: string
  action?: string
  actionNode?: React.ReactNode
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="text-xl font-semibold">{title}</h1>
        <p className="mt-1 text-sm text-muted">{description}</p>
      </div>
      {actionNode}
      {action && (
        <Button variant="primary">
          <ServerIcon className="size-4" />
          {action}
        </Button>
      )}
    </div>
  )
}
