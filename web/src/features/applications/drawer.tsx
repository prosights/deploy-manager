import { useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { ArrowLeft, Github } from 'lucide-react'
import { Badge } from '../../components/ui/badge'
import { Dialog, DialogContent, DialogHeader } from '../../components/ui/dialog'
import { Tabs } from '../../components/ui/tabs'
import type { Application, Deployment } from '../../lib/api'
import { cn } from '../../lib/cn'
import { formatFullTime } from '../../lib/format'
import { applicationsQuery, deploymentSlotsQuery, deploymentsQuery, proxyRoutesQuery, serversQuery } from '../../lib/queries'
import { deploymentTabs, serviceTabs, type DeploymentTab, type DrawerSearch, type ServiceTab } from '../../lib/route-search'
import { ApplicationTerminal, applicationTerminalDirectory } from '../servers/components'
import { statusTone } from '../status'
import { DeploymentDetail } from './deployment-detail'
import { DeploymentActionsMenu, DeploymentsTab } from './deployments-tab'
import { activeDeploymentID, forApplication } from './helpers'
import { MetricsTab } from './metrics-tab'
import { ServiceRouteLinks } from './parts'
import { SettingsTab } from './settings-tab'
import { VariablesTab } from './variables-tab'

export { ServiceRouteLinks, SettingsSection } from './parts'

const serviceTabLabels: Record<ServiceTab, string> = {
  'deployments': 'Deployments',
  'variables': 'Variables',
  'metrics': 'Metrics',
  'console': 'Console',
  'settings': 'Settings',
}
const deploymentTabLabels: Record<DeploymentTab, string> = {
  'details': 'Details',
  'build-logs': 'Build Logs',
  'deploy-logs': 'Deploy Logs',
}
const serviceTabItems = serviceTabs.map((id) => ({ id, label: serviceTabLabels[id] }))
const deploymentTabItems = deploymentTabs.map((id) => ({ id, label: deploymentTabLabels[id] }))

// The service drawer. The URL search says which service, deployment, and tab
// are open; every change goes back through `onNavigate`.
export function ApplicationDrawer({
  search,
  onNavigate,
}: {
  search: DrawerSearch & { service: string }
  onNavigate: (next: DrawerSearch) => void
}) {
  const serviceID = search.service
  const { data: application } = useSuspenseQuery({ ...applicationsQuery, select: (applications) => applications.find((item) => item.id === serviceID) })
  const { data: deployments } = useSuspenseQuery({ ...deploymentsQuery, select: forApplication(serviceID) })
  const { data: routes } = useSuspenseQuery({ ...proxyRoutesQuery, select: forApplication(serviceID) })
  if (!application) return null

  const deployment = deployments.find((item) => item.id === search.deployment)
  const serviceTab = !deployment && isServiceTab(search.view) ? search.view : 'deployments'
  const deploymentTab = deployment && isDeploymentTab(search.view) ? search.view : 'details'

  function openDeployment(deploymentID: string, view: DeploymentTab = 'details') {
    onNavigate({ service: serviceID, deployment: deploymentID, view: view === 'details' ? undefined : view })
  }

  function selectServiceTab(tab: ServiceTab) {
    onNavigate({ service: serviceID, deployment: undefined, view: tab === 'deployments' ? undefined : tab })
  }

  function backToService() {
    onNavigate({ service: serviceID, deployment: undefined, view: undefined })
  }

  function close() {
    onNavigate({ service: undefined, deployment: undefined, view: undefined })
  }

  return (
    <Dialog open onOpenChange={(open) => { if (!open) close() }}>
      <DialogContent layout="drawer">
        {deployment
          ? (
              <DialogHeader
                icon={<Github className="size-6 shrink-0 text-prosights-text" aria-hidden="true" />}
                title={<DeploymentTitle application={application} deployment={deployment} deployments={deployments} onBack={backToService} />}
                description={<ServiceRouteLinks routes={routes} fallbackDomain={application.domain} emptyLabel={`${application.environment_name} / ${application.server_name}`} />}
                closeLabel="Close deployment"
                actions={(
                  <>
                    <DeploymentActionsMenu applicationID={application.id} deployment={deployment} />
                    <span className="hidden text-[11px] text-prosights-muted sm:inline">{formatFullTime(deployment.created_at)}</span>
                    <button
                      type="button"
                      className="inline-flex size-8 shrink-0 cursor-pointer items-center justify-center rounded-prosights-md bg-transparent text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text"
                      aria-label="Back to service"
                      onClick={backToService}
                    >
                      <ArrowLeft className="size-4" aria-hidden="true" />
                    </button>
                  </>
                )}
              >
                <Tabs
                  tabs={deploymentTabItems}
                  active={deploymentTab}
                  label="Deployment sections"
                  onSelect={(tab) => openDeployment(deployment.id, tab)}
                />
              </DialogHeader>
            )
          : (
              <DialogHeader
                icon={<Github className="size-6 shrink-0 text-prosights-text" aria-hidden="true" />}
                title={application.name}
                description={<ServiceRouteLinks routes={routes} fallbackDomain={application.domain} emptyLabel={`${application.environment_name} / ${application.server_name}`} />}
                closeLabel="Close service"
              >
                <Tabs tabs={serviceTabItems} active={serviceTab} label="Service sections" onSelect={selectServiceTab} />
              </DialogHeader>
            )}
        <div key={deployment?.id ?? 'service'} className={cn('min-h-0 flex-1 overflow-auto bg-prosights-canvas duration-150 motion-reduce:animate-none', deployment ? 'animate-in fade-in-0 slide-in-from-right-1' : 'animate-in fade-in-0 slide-in-from-left-1')}>
          {deployment
            ? <DeploymentDetail application={application} deployment={deployment} tab={deploymentTab} onSelectTab={(tab) => openDeployment(deployment.id, tab)} />
            : <ServiceTabContent application={application} tab={serviceTab} onOpenDeployment={openDeployment} onSelectTab={selectServiceTab} onDeleted={close} />}
        </div>
      </DialogContent>
    </Dialog>
  )
}

function DeploymentTitle({ application, deployment, deployments, onBack }: { application: Application, deployment: Deployment, deployments: Deployment[], onBack: () => void }) {
  const { data: slots = [] } = useQuery(deploymentSlotsQuery(application.id))
  const active = deployment.id === activeDeploymentID(slots, deployments)
  return (
    <span className="flex min-w-0 items-center gap-2">
      <button type="button" className="truncate bg-transparent text-[17px] font-semibold text-prosights-text hover:underline" onClick={onBack}>{application.name}</button>
      <span className="text-prosights-subtle">/</span>
      <span className="font-mono text-[15px] font-semibold text-prosights-text">{deployment.id.slice(0, 8)}</span>
      <Badge tone={active ? 'success' : statusTone(deployment.status)}>{active ? 'Active' : deployment.status}</Badge>
    </span>
  )
}

function ServiceTabContent({
  application,
  tab,
  onOpenDeployment,
  onSelectTab,
  onDeleted,
}: {
  application: Application
  tab: ServiceTab
  onOpenDeployment: (deploymentID: string, view?: DeploymentTab) => void
  onSelectTab: (tab: ServiceTab) => void
  onDeleted: () => void
}) {
  if (tab === 'variables') return <VariablesTab application={application} />
  if (tab === 'metrics') return <MetricsTab application={application} />
  if (tab === 'console') return <ConsoleTab application={application} />
  if (tab === 'settings') return <SettingsTab application={application} onDeleted={onDeleted} />
  return <DeploymentsTab application={application} onOpenDeployment={onOpenDeployment} onOpenSettings={() => onSelectTab('settings')} />
}

function ConsoleTab({ application }: { application: Application }) {
  const { data: server } = useSuspenseQuery({ ...serversQuery, select: (servers) => servers.find((item) => item.id === application.server_id) })
  return (
    <div className="space-y-4 p-6">
      <div>
        <h2 className="text-[14px] font-semibold text-prosights-text">Service console</h2>
        <p className="mt-1 text-[12px] text-prosights-muted">Interactive shell in <span className="font-mono">{applicationTerminalDirectory(application)}</span> on {application.server_name}.</p>
      </div>
      <ApplicationTerminal server={server} application={application} />
    </div>
  )
}

function isServiceTab(value: string | undefined): value is ServiceTab {
  return serviceTabs.some((tab) => tab === value)
}

function isDeploymentTab(value: string | undefined): value is DeploymentTab {
  return deploymentTabs.some((tab) => tab === value)
}
