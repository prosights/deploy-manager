export function statusTone(status: string): 'success' | 'warning' | 'danger' | 'neutral' | 'accent' {
  switch (status) {
    case 'healthy':
    case 'succeeded':
    case 'active':
    case 'applied':
      return 'success'
    case 'degraded':
    case 'queued':
    case 'running':
    case 'deploying':
    case 'rotating':
    case 'pending':
      return 'warning'
    case 'unreachable':
    case 'failed':
    case 'revoked':
      return 'danger'
    case 'idle':
      return 'accent'
    default:
      return 'neutral'
  }
}

export function percent(value: number | null) {
  if (value === null || Number.isNaN(value)) {
    return 'n/a'
  }
  return `${value.toFixed(0)}%`
}
