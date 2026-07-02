import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { PageHeader } from '../components/page-header'
import { ConnectorForm, ConnectorGuides, ConnectorSyncGrid, defaultConnectorForm } from '../features/connectors/components'
import { syncConnector, upsertConnector, type UpsertConnectorInput } from '../lib/api'
import { connectorsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { hasSecretConfigKey, hasSecretConfigValue } from '../lib/secret-keys'
import { useUiStore } from '../store/ui'

export function ConnectorsRoute() {
  const queryClient = useQueryClient()
  const { data: connectors } = useSuspenseQuery(connectorsQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const [form, setForm] = useState(defaultConnectorForm)
  const [formError, setFormError] = useState<string>()
  const inventoryConnectors = connectors.filter((connector) => connector.provider !== 'slack' && connector.provider !== 'resend')
  const visibleConnectors = inventoryConnectors.filter((connector) => matchesSearch(searchQuery, [
    connector.name,
    connector.provider,
    connector.enabled ? 'enabled' : 'disabled',
    connector.last_sync_status,
    connector.last_sync_message,
  ]))
  const save = useMutation({
    mutationFn: (input: UpsertConnectorInput) => upsertConnector(input),
    onSuccess: async () => {
      setForm(defaultConnectorForm())
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: connectorsQuery.queryKey })
    },
  })
  const sync = useMutation({
    mutationFn: (connectorID: string) => syncConnector(connectorID),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: connectorsQuery.queryKey })
    },
  })

  function submit() {
    setFormError(undefined)
    let input: UpsertConnectorInput
    try {
      input = connectorInput(form)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Connector metadata must be valid JSON.')
      return
    }
    save.mutate(input)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Connectors" description="Connect deploy sources, secrets, and cloud inventory without storing provider secrets here." />
      <ConnectorForm
        form={form}
        isSaving={save.isPending}
        errorMessage={formError ?? save.error?.message}
        onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
        onSubmit={submit}
      />
      <ConnectorGuides />
      <ConnectorSyncGrid
        connectors={visibleConnectors}
        isSyncing={sync.isPending}
        onSync={(connectorID) => sync.mutate(connectorID)}
      />
    </div>
  )
}

function connectorInput(form: ReturnType<typeof defaultConnectorForm>): UpsertConnectorInput {
  const provider = form.provider.trim().toLowerCase()
  const name = form.name.trim()
  if (!provider || !name) {
    throw new Error('Provider and name are required.')
  }
  if (hasControlCharacters(name)) {
    throw new Error('Connector name cannot contain control characters.')
  }
  return {
    provider,
    name,
    enabled: form.enabled,
    config: parseConnectorConfig(form.config),
  }
}

function parseConnectorConfig(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value.trim() || '{}') as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Connector metadata must be a JSON object.')
  }
  if (hasSecretConfigKey(parsed)) {
    throw new Error('Connector metadata cannot contain secrets, tokens, passwords, private keys, or API keys.')
  }
  if (hasSecretConfigValue(parsed)) {
    throw new Error('Connector metadata cannot contain raw secret material.')
  }
  return pruneConnectorConfig(parsed as Record<string, unknown>)
}

function pruneConnectorConfig(value: Record<string, unknown>): Record<string, unknown> {
  return Object.fromEntries(Object.entries(value).flatMap(([key, child]) => {
    const pruned = pruneConnectorValue(child)
    return pruned === undefined ? [] : [[key, pruned]]
  }))
}

function pruneConnectorValue(value: unknown): unknown {
  if (value === null || value === undefined) {
    return undefined
  }
  if (typeof value === 'string') {
    const trimmed = value.trim()
    return trimmed ? trimmed : undefined
  }
  if (Array.isArray(value)) {
    const pruned = value.map(pruneConnectorValue).filter((item) => item !== undefined)
    return pruned.length ? pruned : undefined
  }
  if (typeof value === 'object') {
    const pruned = pruneConnectorConfig(value as Record<string, unknown>)
    return Object.keys(pruned).length ? pruned : undefined
  }
  return value
}

function hasControlCharacters(value: string): boolean {
  return value.includes('\n') || value.includes('\r') || value.includes('\t')
}
