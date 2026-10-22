import { useSuspenseQuery } from '@tanstack/react-query'
import { Server } from 'lucide-react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTrigger } from '../../components/ui/dialog'
import type { ComposeService } from '../../lib/api'
import { applicationsQuery, proxyRoutesQuery } from '../../lib/queries'
import { ServiceRouteLinks } from '../applications/drawer'
import { activeServiceTargets, applicationComposeServices, composeContainerPorts, routeTargets } from '../applications/helpers'

// Every Compose service in one environment and where it is reachable.
export function ServicePortsDialog({ environmentID }: { environmentID: string }) {
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" className="h-8">
          <Server className="size-4" aria-hidden="true" />
          Service ports
        </Button>
      </DialogTrigger>
      <DialogContent size="xl">
        <DialogHeader
          title="Service ports"
          description="Every Compose service in the selected environment and where it is reachable."
          closeLabel="Close service ports"
        />
        <div className="min-h-0 overflow-auto">
          <ServicePortsTable environmentID={environmentID} />
        </div>
      </DialogContent>
    </Dialog>
  )
}

function ServicePortsTable({ environmentID }: { environmentID: string }) {
  const { data: applications } = useSuspenseQuery({
    ...applicationsQuery,
    select: (items) => items.filter((application) => application.environment_id === environmentID),
  })
  const { data: routes } = useSuspenseQuery(proxyRoutesQuery)
  const rows = applications.flatMap((application) => {
    const composeServices = applicationComposeServices(application)
    const services: ComposeService[] = composeServices.length > 0 ? composeServices : [{ name: 'service' }]
    const applicationRoutes = routes.filter((route) => route.application_id === application.id)
    return services.map((service) => ({
      application,
      service,
      routes: composeServices.length === 0
        ? applicationRoutes
        : applicationRoutes.filter((route) => route.compose_service === service.name || (!route.compose_service && composeServices.length === 1)),
      scanned: composeServices.length > 0,
    }))
  })

  if (rows.length === 0) return <div className="px-5 py-10 text-center text-[12px] text-prosights-muted">No services in this environment.</div>

  return (
    <table className="w-full min-w-[1040px] text-left text-[12px]">
      <thead className="sticky top-0 z-10 border-b border-prosights-border bg-prosights-surface-muted text-[10px] uppercase tracking-wide text-prosights-subtle">
        <tr>
          <th className="px-4 py-2.5 font-medium">Application</th>
          <th className="px-4 py-2.5 font-medium">Compose service</th>
          <th className="px-4 py-2.5 font-medium">Container</th>
          <th className="px-4 py-2.5 font-medium">Blue host</th>
          <th className="px-4 py-2.5 font-medium">Green host</th>
          <th className="px-4 py-2.5 font-medium">Active host</th>
          <th className="px-4 py-2.5 font-medium">Access</th>
        </tr>
      </thead>
      <tbody className="divide-y divide-prosights-border">
        {rows.map((row) => (
          <tr key={`${row.application.id}:${row.service.name}`} className="align-top">
            <td className="px-4 py-3"><span className="font-medium text-prosights-text">{row.application.name}</span><span className="mt-0.5 block text-[10px] text-prosights-muted">{row.application.server_name}</span></td>
            <td className="px-4 py-3 font-mono text-prosights-text">{row.service.name}</td>
            <td className="px-4 py-3 font-mono text-prosights-muted">{row.scanned || row.routes.some((route) => route.container_port) ? composeContainerPorts(row.service, row.routes) : 'not scanned'}</td>
            <td className="px-4 py-3 font-mono text-prosights-muted">{routeTargets(row.routes, 'blue_upstream_url')}</td>
            <td className="px-4 py-3 font-mono text-prosights-muted">{routeTargets(row.routes, 'green_upstream_url')}</td>
            <td className="px-4 py-3 font-mono text-prosights-muted">{activeServiceTargets(row.service, row.routes)}</td>
            <td className="px-4 py-3 text-prosights-muted"><ServiceRouteLinks routes={row.routes} emptyLabel="Private" showServiceLabel={false} stacked /></td>
          </tr>
        ))}
      </tbody>
    </table>
  )
}
