import { PageHeader } from '../components/page-header'
import { IntegrationGrid } from '../features/connectors/components'

export function ConnectorsRoute() {
  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrations"
        description="One-click connections to your deploy sources, secrets, and cloud services."
      />
      <IntegrationGrid />
    </div>
  )
}
