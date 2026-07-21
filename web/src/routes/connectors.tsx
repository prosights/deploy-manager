import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useEffect, useRef } from 'react'
import { PageHeader } from '../components/page-header'
import { IntegrationGrid } from '../features/connectors/components'
import {
  syncGitHubConnectorRepositories,
  upsertContainerRegistry,
  type UpsertContainerRegistryInput,
} from '../lib/api'
import { connectorsQuery, containerRegistriesQuery, dopplerProjectsQuery, dopplerStatusQuery, githubRepositoriesQuery, githubStatusQuery } from '../lib/queries'

export function ConnectorsRoute() {
  const queryClient = useQueryClient()
  const { data: githubStatus } = useSuspenseQuery(githubStatusQuery)
  const { data: dopplerStatus } = useSuspenseQuery(dopplerStatusQuery)
  const { data: githubRepositories } = useSuspenseQuery(githubRepositoriesQuery)
  const dopplerProjects = useQuery({ ...dopplerProjectsQuery, enabled: dopplerStatus.ready })
  const { data: registries } = useSuspenseQuery(containerRegistriesQuery)
  const { data: connectors } = useSuspenseQuery(connectorsQuery)
  const syncedConnectors = useRef(new Set<string>())
  const githubConnector = connectors.find((connector) => connector.provider === 'github' && connector.enabled)

  const syncRepos = useMutation({
    mutationFn: (connectorID: string) => syncGitHubConnectorRepositories(connectorID),
    onSuccess: async () => {
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: connectorsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: githubRepositoriesQuery.queryKey }),
      ])
    },
  })
  const saveRegistry = useMutation({
    mutationFn: (input: UpsertContainerRegistryInput) => upsertContainerRegistry(input),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: containerRegistriesQuery.queryKey })
    },
  })

  useEffect(() => {
    if (!githubStatus.app_configured || !githubConnector || syncedConnectors.current.has(githubConnector.id)) return
    syncedConnectors.current.add(githubConnector.id)
    syncRepos.mutate(githubConnector.id)
  }, [githubStatus.app_configured, githubConnector, syncRepos])

  return (
    <div className="space-y-8">
      <PageHeader
        title="Integrations"
        description="One-click connections to your deploy sources, secrets, and cloud services."
      />
      <IntegrationGrid
        githubStatus={githubStatus}
        githubConnected={Boolean(githubConnector)}
        githubRepositories={githubRepositories}
        dopplerStatus={dopplerStatus}
        dopplerProjects={dopplerProjects.data ?? []}
        isLoadingDopplerProjects={dopplerProjects.isFetching}
        dopplerProjectsError={dopplerProjects.error instanceof Error ? dopplerProjects.error.message : undefined}
        connectors={connectors}
        registries={registries}
        onSaveRegistry={(input) => saveRegistry.mutate(input)}
        onSyncGitHub={(connectorID) => syncRepos.mutate(connectorID)}
        isSavingRegistry={saveRegistry.isPending}
        isSyncingGitHub={syncRepos.isPending}
      />
      {syncRepos.error && <div className="text-sm text-danger">{syncRepos.error.message}</div>}
      {saveRegistry.error && <div className="text-sm text-danger">{saveRegistry.error.message}</div>}
    </div>
  )
}
