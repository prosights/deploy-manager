import { useSuspenseQuery } from '@tanstack/react-query'
import { OverviewDashboard } from '../features/overview/components'
import { applicationsQuery, connectorsQuery, credentialsQuery, deploymentsQuery, serversQuery } from '../lib/queries'

export function OverviewRoute() {
  const { data: servers } = useSuspenseQuery(serversQuery)
  const { data: applications } = useSuspenseQuery(applicationsQuery)
  const { data: deployments } = useSuspenseQuery(deploymentsQuery)
  const { data: credentials } = useSuspenseQuery(credentialsQuery)
  const { data: connectors } = useSuspenseQuery(connectorsQuery)
  const activeDeployment = deployments.find((deployment) => deployment.status === 'running') ?? deployments[0]

  return (
    <OverviewDashboard
      servers={servers}
      activeDeployment={activeDeployment}
      applicationCount={applications.length}
      credentialCount={credentials.length}
      connectors={connectors}
    />
  )
}
