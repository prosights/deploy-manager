import { useSuspenseQueries } from '@tanstack/react-query'
import { OverviewDashboard } from '../features/overview/components'
import { applicationsQuery, connectorsQuery, credentialsQuery, deploymentsQuery, serversQuery } from '../lib/queries'

export function OverviewRoute() {
  const [
    { data: servers },
    { data: applications },
    { data: deployments },
    { data: credentials },
    { data: connectors },
  ] = useSuspenseQueries({
    queries: [serversQuery, applicationsQuery, deploymentsQuery, credentialsQuery, connectorsQuery],
  })
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
