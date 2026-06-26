import type React from 'react'
import { cn } from '../../lib/cn'

type PanelProps = {
  title?: string
  action?: React.ReactNode
  children: React.ReactNode
  className?: string
}

export function Panel({ title, action, children, className }: PanelProps) {
  return (
    <section className={cn('rounded-lg border bg-surface', className)}>
      {(title || action) && (
        <header className="flex min-h-11 items-center justify-between gap-3 border-b px-4">
          {title ? <h2 className="text-sm font-semibold text-ink">{title}</h2> : <div />}
          {action}
        </header>
      )}
      {children}
    </section>
  )
}
