import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { PageHeader } from '../components/page-header'
import { ConnectorAccountsPanel, ConnectedRepos, IntegrationGrid, RecentBuilds } from '../features/connectors/components'
import {
  dispatchGitHubBuild,
  syncGitHubConnectorRepositories,
  upsertConnector,
  upsertContainerRegistry,
  type ConnectorAccount,
  type GitHubRepository,
  type UpsertConnectorInput,
  type UpsertContainerRegistryInput,
} from '../lib/api'
import { buildRunsQuery, connectorsQuery, containerRegistriesQuery, dopplerStatusQuery, githubRepositoriesQuery, githubStatusQuery } from '../lib/queries'
import { useUiStore } from '../store/ui'

export function ConnectorsRoute() {
  const queryClient = useQueryClient()
  const { data: githubStatus } = useSuspenseQuery(githubStatusQuery)
  const { data: dopplerStatus } = useSuspenseQuery(dopplerStatusQuery)
  const { data: githubRepositories } = useSuspenseQuery(githubRepositoriesQuery)
  const { data: buildRuns } = useSuspenseQuery(buildRunsQuery)
  const { data: registries } = useSuspenseQuery(containerRegistriesQuery)
  const { data: connectors } = useSuspenseQuery(connectorsQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)

  const syncRepos = useMutation({
    mutationFn: (connectorID: string) => syncGitHubConnectorRepositories(connectorID),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectorsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: githubRepositoriesQuery.queryKey }),
      ])
    },
  })
  const dispatchBuild = useMutation({
    mutationFn: (repository: GitHubRepository) => dispatchGitHubBuild(repository.connector_id, {
      repository: repository.repository,
      application_id: repository.application_id || undefined,
      branch: repository.branch,
    }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: buildRunsQuery.queryKey })
    },
  })
  const saveRegistry = useMutation({
    mutationFn: (input: UpsertContainerRegistryInput) => upsertContainerRegistry(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: containerRegistriesQuery.queryKey })
    },
  })
  const saveConnector = useMutation({
    mutationFn: (input: UpsertConnectorInput) => upsertConnector(input),
    onSuccess: async (connector: ConnectorAccount) => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectorsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: githubRepositoriesQuery.queryKey }),
        connector.provider === 'github' ? queryClient.invalidateQueries({ queryKey: githubStatusQuery.queryKey }) : Promise.resolve(),
        connector.provider === 'doppler' ? queryClient.invalidateQueries({ queryKey: dopplerStatusQuery.queryKey }) : Promise.resolve(),
      ])
      if (connector.provider === 'github' && connector.enabled && githubStatus.repository_sync_enabled) {
        syncRepos.mutate(connector.id)
      }
    },
  })

  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrations"
        description="One-click connections to your deploy sources, secrets, and cloud services."
      />
      <IntegrationGrid
        githubStatus={githubStatus}
        dopplerStatus={dopplerStatus}
        registries={registries}
        onSaveRegistry={(input) => saveRegistry.mutate(input)}
        isSavingRegistry={saveRegistry.isPending}
      />
      <ConnectorAccountsPanel
        connectors={connectors}
        githubStatus={githubStatus}
        isSaving={saveConnector.isPending}
        isSyncing={syncRepos.isPending}
        errorMessage={saveConnector.error?.message ?? syncRepos.error?.message}
        onSave={(input) => saveConnector.mutate(input)}
        onSync={(connectorID) => syncRepos.mutate(connectorID)}
      />
      <ConnectedRepos
        repositories={githubRepositories}
        searchQuery={searchQuery}
        isSyncing={syncRepos.isPending}
        isDispatching={dispatchBuild.isPending}
        onSync={(connectorID) => syncRepos.mutate(connectorID)}
        onBuild={(repository) => dispatchBuild.mutate(repository)}
      />
      <RecentBuilds builds={buildRuns} />
      {dispatchBuild.error && <div className="text-sm text-danger">{dispatchBuild.error.message}</div>}
      {syncRepos.error && <div className="text-sm text-danger">{syncRepos.error.message}</div>}
      {saveRegistry.error && <div className="text-sm text-danger">{saveRegistry.error.message}</div>}
      {saveConnector.error && <div className="text-sm text-danger">{saveConnector.error.message}</div>}
    </div>
  )
}
