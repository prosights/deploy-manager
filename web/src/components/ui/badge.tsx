import type React from 'react'
import { cn } from '../../lib/cn'

const tones = {
  success: 'bg-success/15 text-success',
  warning: 'bg-warning/15 text-warning',
  danger: 'bg-danger/15 text-danger',
  neutral: 'bg-panel text-muted',
  accent: 'bg-accent/15 text-accent-text',
}

type BadgeProps = {
  children: React.ReactNode
  tone?: keyof typeof tones
  className?: string
}

export function Badge({ children, tone = 'neutral', className }: BadgeProps) {
  return (
    <span className={cn('inline-flex items-center rounded-md px-2 py-0.5 text-xs font-medium', tones[tone], className)}>
      {children}
    </span>
  )
}
