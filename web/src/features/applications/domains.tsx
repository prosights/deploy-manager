import { useMutation, useSuspenseQuery } from '@tanstack/react-query'
import { Globe2, Plus, RefreshCw, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { InlineError } from '../../components/ui/error-message'
import { TextInput } from '../../components/ui/text-input'
import { applyProxyRoute, createProxyRoute, deleteProxyRoute, type Application } from '../../lib/api'
import { optionalTrimmed } from '../../lib/format'
import { proxyRoutesQuery, serversQuery } from '../../lib/queries'
import { statusTone } from '../status'
import { forApplication } from './helpers'
import { SettingsSection } from './parts'

export function ApplicationDomains({ application }: { application: Application }) {
  const { data: routes } = useSuspenseQuery({ ...proxyRoutesQuery, select: forApplication(application.id) })
  const { data: server } = useSuspenseQuery({ ...serversQuery, select: (servers) => servers.find((item) => item.id === application.server_id) })
  const [addingDomain, setAddingDomain] = useState(false)
  const [domain, setDomain] = useState('')
  const [upstreamURL, setUpstreamURL] = useState('')
  const [blueUpstreamURL, setBlueUpstreamURL] = useState('')
  const [greenUpstreamURL, setGreenUpstreamURL] = useState('')
  const [tlsEnabled, setTLSEnabled] = useState(true)
  const apply = useMutation({ mutationFn: applyProxyRoute })
  const remove = useMutation({ mutationFn: deleteProxyRoute })
  const create = useMutation({
    mutationFn: () => {
      validateProxyEndpoint(domain, upstreamURL, blueUpstreamURL, greenUpstreamURL)
      return createProxyRoute({
        application_id: application.id,
        domain: domain.trim().toLowerCase(),
        upstream_url: upstreamURL.trim(),
        blue_upstream_url: optionalTrimmed(blueUpstreamURL),
        green_upstream_url: optionalTrimmed(greenUpstreamURL),
        tls_enabled: tlsEnabled,
      })
    },
    onSuccess: () => {
      setAddingDomain(false)
      setDomain('')
    },
  })

  function openDomainForm() {
    setAddingDomain(true)
    setDomain('')
    setUpstreamURL('')
    setBlueUpstreamURL('')
    setGreenUpstreamURL('')
    setTLSEnabled(server?.hostname !== 'playground')
    create.reset()
  }

  if (server?.proxy_type === 'none') {
    return (
      <SettingsSection title="Networking" description="Domains require Caddy or Traefik on this server.">
        <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-6 text-center text-[12px] text-prosights-muted">Enable a supported proxy on {application.server_name} before adding a public or internal domain.</div>
      </SettingsSection>
    )
  }

  return (
    <SettingsSection title="Networking" description="Route a domain to ports published by this compose stack.">
      <div className="space-y-3">
        {routes.map((route) => (
          <div key={route.id} className="rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center">
              <div className="flex min-w-0 flex-1 items-center gap-3">
                <div className="flex size-8 shrink-0 items-center justify-center rounded-prosights-md bg-prosights-surface text-prosights-muted"><Globe2 className="size-4" /></div>
                <div className="min-w-0"><a href={`${route.tls_enabled ? 'https' : 'http'}://${route.domain}`} target="_blank" rel="noreferrer" className="block truncate text-[13px] font-medium text-prosights-text hover:underline">{route.domain}</a><div className="mt-0.5 truncate font-mono text-[11px] text-prosights-muted">{route.upstream_url}</div></div>
              </div>
              <Badge tone={statusTone(route.status)}>{route.status}</Badge>
              {/* Routes owned by a Compose service are applied by the next deployment. */}
              {route.status !== 'applied' && !(route.application_id && route.compose_service) && <Button disabled={apply.isPending} onClick={() => apply.mutate(route.id)}><RefreshCw className={apply.isPending ? 'size-4 animate-spin' : 'size-4'} /> Apply</Button>}
              <Button size="icon" aria-label={`Delete domain ${route.domain}`} disabled={remove.isPending} onClick={() => { if (window.confirm(`Delete domain ${route.domain}?`)) remove.mutate(route.id) }}><Trash2 className="size-4" /></Button>
            </div>
            {(route.blue_upstream_url || route.green_upstream_url) && <div className="mt-3 grid gap-2 sm:grid-cols-2">{route.blue_upstream_url && <ReadOnlyEndpoint label="Blue target" value={route.blue_upstream_url} />}{route.green_upstream_url && <ReadOnlyEndpoint label="Green target" value={route.green_upstream_url} />}</div>}
          </div>
        ))}
        {routes.length === 0 && <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-6 text-center text-[12px] text-prosights-muted">No domains yet. Add one only for a container that accepts HTTP traffic.</div>}

        {addingDomain
          ? (
              <form className="grid gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface p-3 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); create.mutate() }}>
                <TextInput label="Domain" value={domain} onChange={setDomain} placeholder="api.example.com" required />
                <TextInput label="Upstream" value={upstreamURL} onChange={setUpstreamURL} placeholder="http://127.0.0.1:3101" required />
                <TextInput label="Blue upstream" value={blueUpstreamURL} onChange={setBlueUpstreamURL} placeholder="http://127.0.0.1:3101" />
                <TextInput label="Green upstream" value={greenUpstreamURL} onChange={setGreenUpstreamURL} placeholder="http://127.0.0.1:3102" />
                <label className="flex items-center justify-between gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5 text-[12px]"><span className="text-prosights-text">HTTPS / TLS</span><input type="checkbox" className="size-4 accent-black" checked={tlsEnabled} onChange={(event) => setTLSEnabled(event.target.checked)} /></label>
                <p className="sm:col-span-2 text-[11px] text-prosights-muted">Use the host ports published by Docker Compose. Blue and green targets are used during zero-downtime deployments.</p>
                {create.error && <div className="sm:col-span-2"><InlineError message={create.error.message} /></div>}
                <div className="flex justify-end gap-2 sm:col-span-2"><Button type="button" onClick={() => setAddingDomain(false)}>Cancel</Button><Button type="submit" variant="primary" disabled={create.isPending}>{create.isPending ? 'Adding…' : 'Add domain'}</Button></div>
              </form>
            )
          : <Button type="button" onClick={openDomainForm}><Plus className="size-4" /> Add domain</Button>}
      </div>
      {(apply.error || remove.error) && <div className="mt-3"><InlineError message={apply.error?.message ?? remove.error?.message ?? 'Domain action failed.'} /></div>}
    </SettingsSection>
  )
}

function ReadOnlyEndpoint({ label, value }: { label: string, value: string }) {
  return <div className="rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5"><div className="text-[11px] text-prosights-muted">{label}</div><div className="mt-1 truncate font-mono text-[12px] text-prosights-text">{value}</div></div>
}

function validateProxyEndpoint(domain: string, upstreamURL: string, blueUpstreamURL: string, greenUpstreamURL: string): void {
  const hostname = domain.trim().toLowerCase()
  if (!/^(?=.{1,253}$)(?:[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?\.)+[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?$/.test(hostname)) throw new Error('Enter a hostname without a protocol or path.')
  for (const [label, value] of [['Upstream', upstreamURL], ['Blue upstream', blueUpstreamURL], ['Green upstream', greenUpstreamURL]] as const) {
    if (!value.trim()) {
      if (label === 'Upstream') throw new Error('Upstream is required.')
      continue
    }
    let parsed: URL
    try {
      parsed = new URL(value.trim())
    } catch {
      throw new Error(`${label} must be an absolute HTTP URL.`)
    }
    if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.host || parsed.username || parsed.password) throw new Error(`${label} must be an absolute HTTP URL without credentials.`)
  }
}
