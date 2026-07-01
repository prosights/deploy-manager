import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { defaultProxyForm, ProxyRouteForm, ProxyRouteList } from '../features/proxy/components'
import { applyProxyRoute, createProxyRoute } from '../lib/api'
import { validateDomain } from '../lib/domains'
import { applicationsQuery, proxyRoutesQuery, serversQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useUiStore } from '../store/ui'

export function ProxyRoute() {
  const queryClient = useQueryClient()
  const [{ data: routes }, { data: servers }, { data: applications }] = useSuspenseQueries({
    queries: [proxyRoutesQuery, serversQuery, applicationsQuery],
  })
  const searchQuery = useUiStore((state) => state.searchQuery)
  const defaultServerID = servers[0]?.id ?? ''
  const [form, setForm] = useState(defaultProxyForm(defaultServerID))
  const [formError, setFormError] = useState<string>()
  const visibleRoutes = routes.filter((route) => matchesSearch(searchQuery, [
    route.domain,
    route.upstream_url,
    route.status,
    route.server_name,
    route.proxy_type,
    route.application_name,
    route.tls_enabled ? 'tls on' : 'tls off',
  ]))
  const selectedApplication = useMemo(
    () => applications.find((application) => application.id === form.application_id),
    [applications, form.application_id],
  )
  const create = useMutation({
    mutationFn: () => createProxyRoute({
      server_id: form.application_id ? undefined : form.server_id,
      application_id: form.application_id || undefined,
      domain: form.domain.trim().toLowerCase(),
      upstream_url: form.upstream_url.trim(),
      blue_upstream_url: optionalTrimmed(form.blue_upstream_url),
      green_upstream_url: optionalTrimmed(form.green_upstream_url),
      tls_enabled: form.tls_enabled,
    }),
    onSuccess: async () => {
      setForm((state) => ({ ...defaultProxyForm(state.server_id), server_id: state.server_id }))
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey })
    },
  })
  const apply = useMutation({
    mutationFn: (routeID: string) => applyProxyRoute(routeID),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: proxyRoutesQuery.queryKey })
    },
  })

  function selectApplication(applicationID: string) {
    const application = applications.find((item) => item.id === applicationID)
    setForm((state) => ({
      ...state,
      application_id: applicationID,
      server_id: application?.server_id ?? state.server_id,
      domain: applicationID ? application?.domain ?? '' : state.domain,
    }))
  }

  function submitRoute() {
    setFormError(undefined)
    try {
      validateDomain(form.domain)
      validateProxyUpstream(form.upstream_url)
      validateOptionalProxyUpstream(form.blue_upstream_url)
      validateOptionalProxyUpstream(form.green_upstream_url)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Proxy route is invalid.')
      return
    }
    create.mutate()
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Proxy management" description="Caddy and Traefik domain routing for deployment targets." />
      <ProxyRouteForm
        form={form}
        servers={servers}
        applications={applications}
        selectedApplication={selectedApplication}
        defaultServerID={defaultServerID}
        isSaving={create.isPending}
        errorMessage={formError ?? create.error?.message}
        onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
        onSelectApplication={selectApplication}
        onSubmit={submitRoute}
      />
      <ProxyRouteList
        routes={visibleRoutes}
        isApplying={apply.isPending}
        errorMessage={apply.error?.message}
        onApply={(routeID) => apply.mutate(routeID)}
      />
    </div>
  )
}

function validateProxyUpstream(value: string): void {
  if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
    throw new Error('Upstream URL cannot contain control characters.')
  }
  let parsed: URL
  try {
    parsed = new URL(value.trim())
  } catch {
    throw new Error('Upstream URL must be an absolute HTTP URL.')
  }
  if (!parsed.host) {
    throw new Error('Upstream URL must be an absolute HTTP URL.')
  }
  if (parsed.username || parsed.password) {
    throw new Error('Upstream URL cannot include credentials.')
  }
  if ((parsed.pathname && parsed.pathname !== '/') || parsed.search || parsed.hash) {
    throw new Error('Upstream URL must be an origin URL without path, query, or fragment.')
  }
  if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
    throw new Error('Upstream URL must use http or https.')
  }
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function validateOptionalProxyUpstream(value: string): void {
  if (!value.trim()) {
    return
  }
  validateProxyUpstream(value)
}
