import type { ReactNode } from 'react'
import type { ProxyRoute } from '../../lib/api'
import { cn } from '../../lib/cn'
import { proxyRouteURL } from './helpers'

export function ServiceRouteLinks({ routes, fallbackDomain, emptyLabel = 'No domain', showServiceLabel = true, stacked = false }: { routes: ProxyRoute[], fallbackDomain?: string | null, emptyLabel?: string, showServiceLabel?: boolean, stacked?: boolean }) {
  if (routes.length === 0) {
    return fallbackDomain
      ? <a href={`https://${fallbackDomain}`} target="_blank" rel="noreferrer" className="break-all hover:text-prosights-text hover:underline">https://{fallbackDomain}</a>
      : <span>{emptyLabel}</span>
  }
  return (
    <span className={cn('min-w-0 gap-x-3 gap-y-1', stacked ? 'grid' : 'inline-flex flex-wrap')}>
      {routes.map((route) => (
        <span key={route.id} className="inline-flex min-w-0 items-center gap-1">
          {showServiceLabel && route.compose_service && <span className="font-mono text-[10px] text-prosights-subtle">{route.compose_service}</span>}
          <a href={proxyRouteURL(route)} target="_blank" rel="noreferrer" className="break-all hover:text-prosights-text hover:underline">{proxyRouteURL(route)}</a>
        </span>
      ))}
    </span>
  )
}

export function SettingsSection({ title, description, children }: { title: string, description: string, children: ReactNode }) {
  return (
    <section className="rounded-prosights-lg border border-prosights-border bg-prosights-surface">
      <div className="border-b border-prosights-border px-4 py-3"><h2 className="text-[13px] font-semibold text-prosights-text">{title}</h2><p className="mt-0.5 text-[11px] text-prosights-muted">{description}</p></div>
      <div className="p-4">{children}</div>
    </section>
  )
}

export function DetailItem({ label, value }: { label: string, value: string }) {
  return <div><dt className="text-prosights-muted">{label}</dt><dd className="mt-1 break-all font-mono text-prosights-text">{value}</dd></div>
}
