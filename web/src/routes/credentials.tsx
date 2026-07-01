import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { BlockError } from '../components/ui/error-message'
import { CredentialInventoryImportPanel, CredentialInventoryPanels, CredentialList } from '../features/credentials/components'
import { syncCredentialInventory, type CredentialInventoryInput } from '../lib/api'
import { credentialDetailQuery, credentialsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { hasSecretConfigKey, looksLikeSecretMaterial } from '../lib/secret-keys'
import { useUiStore } from '../store/ui'

const maxCredentialInventoryBatchSize = 500
const credentialProviders = ['github', 'doppler', 's3', 'gcs', 'slack', 'resend', 'ssh'] as const
const credentialStatuses = ['active', 'rotating', 'revoked', 'unknown'] as const
type CredentialInventoryItem = CredentialInventoryInput['credentials'][number]

export function CredentialsRoute() {
  const queryClient = useQueryClient()
  const { data: credentials } = useSuspenseQuery(credentialsQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const [selectedID, setSelectedID] = useState('')
  const [inventoryJSON, setInventoryJSON] = useState('')
  const [formError, setFormError] = useState<string>()
  const [successMessage, setSuccessMessage] = useState<string>()
  const visibleCredentials = useMemo(() => credentials.filter((credential) => matchesSearch(searchQuery, [
    credential.name,
    credential.provider,
    credential.external_ref,
    credential.credential_type,
    credential.status,
  ])), [credentials, searchQuery])
  const selectedCredential = useMemo(
    () => visibleCredentials.find((credential) => credential.id === selectedID),
    [selectedID, visibleCredentials],
  )
  const detail = useQuery({
    ...credentialDetailQuery(selectedCredential?.id ?? ''),
    enabled: Boolean(selectedCredential),
  })
  const sync = useMutation({
    mutationFn: (input: CredentialInventoryInput) => syncCredentialInventory(input),
    onSuccess: async (result) => {
      setInventoryJSON('')
      setFormError(undefined)
      setSuccessMessage(`Imported ${result.count} credential records.`)
      await queryClient.invalidateQueries({ queryKey: credentialsQuery.queryKey })
      if (selectedCredential) {
        await queryClient.invalidateQueries({ queryKey: credentialDetailQuery(selectedCredential.id).queryKey })
      }
    },
  })

  function submitInventory() {
    setFormError(undefined)
    setSuccessMessage(undefined)
    let inventory: CredentialInventoryInput
    try {
      inventory = parseCredentialInventory(inventoryJSON)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Inventory JSON is invalid.')
      return
    }
    sync.mutate(inventory)
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Credential inventory" description="Permission and usage visibility for deployment credentials. Secret values stay in their source systems." />
      <CredentialInventoryImportPanel
        value={inventoryJSON}
        isSyncing={sync.isPending}
        errorMessage={formError ?? sync.error?.message}
        successMessage={successMessage}
        onChange={setInventoryJSON}
        onSubmit={submitInventory}
      />
      <CredentialList credentials={visibleCredentials} onInspect={setSelectedID} />
      {!selectedCredential && visibleCredentials.length > 0 && (
        <div className="rounded-md border bg-panel px-4 py-3 text-sm text-muted">
          Select a credential to inspect permissions and usage.
        </div>
      )}
      {selectedCredential && (
        <CredentialInventoryPanels credential={selectedCredential} detail={detail.data} />
      )}
      {detail.error && <BlockError message={detail.error.message} />}
    </div>
  )
}

function parseCredentialInventory(value: string): CredentialInventoryInput {
  const parsed = JSON.parse(value) as unknown
  if (!parsed || Array.isArray(parsed) || typeof parsed !== 'object') {
    throw new Error('Inventory JSON must be an object with a credentials array.')
  }
  const inventory = parsed as CredentialInventoryInput
  if (hasSecretConfigKey(inventory)) {
    throw new Error('Credential inventory cannot contain secrets, tokens, passwords, private keys, or API keys.')
  }
  if (!Array.isArray(inventory.credentials) || inventory.credentials.length === 0) {
    throw new Error('Inventory JSON must include at least one credential.')
  }
  if (inventory.credentials.length > maxCredentialInventoryBatchSize) {
    throw new Error('Credential inventory batch cannot exceed 500 credentials.')
  }
  return {
    credentials: inventory.credentials.map(normalizeCredential),
  }
}

function normalizeCredential(credential: CredentialInventoryItem): CredentialInventoryItem {
  const name = requiredText(credential.name, 'Credential name is required.')
  const provider = normalizeCredentialProvider(credential.provider)
  const externalRef = requiredText(credential.external_ref, 'Credential external_ref is required.')
  const credentialType = requiredText(credential.credential_type, 'Credential type is required.')
  const status = normalizeCredentialStatus(credential.status)
  if (looksLikeSecretMaterial(externalRef)) {
    throw new Error('Credential external_ref must be a reference, not a secret value.')
  }

  return {
    name,
    provider,
    external_ref: externalRef,
    credential_type: credentialType,
    ...(status ? { status } : {}),
    permissions: optionalFactArray(credential.permissions, 'Credential permissions must be an array.').map(normalizePermission),
    usages: optionalFactArray(credential.usages, 'Credential usages must be an array.').map(normalizeUsage),
  }
}

function optionalFactArray<T>(value: T[] | undefined, message: string): T[] {
  if (value === undefined) {
    return []
  }
  if (!Array.isArray(value)) {
    throw new Error(message)
  }
  return value
}

function normalizeCredentialProvider(provider: string): string {
  const normalized = requiredText(provider, 'Credential provider is required.').toLowerCase()
  if (!credentialProviders.includes(normalized as (typeof credentialProviders)[number])) {
    throw new Error('Credential provider must be github, doppler, s3, gcs, slack, resend, or ssh.')
  }
  return normalized
}

function normalizeCredentialStatus(status: string | undefined): string | undefined {
  if (status === undefined) {
    return undefined
  }
  const normalized = status.trim()
  if (normalized === '') {
    return undefined
  }
  if (!credentialStatuses.includes(normalized as (typeof credentialStatuses)[number])) {
    throw new Error('Credential status must be active, rotating, revoked, or unknown.')
  }
  return normalized
}

function normalizePermission(permission: NonNullable<CredentialInventoryItem['permissions']>[number]) {
  return {
    resource_type: requiredText(permission.resource_type, 'Permission resource_type is required.'),
    resource_name: requiredText(permission.resource_name, 'Permission resource_name is required.'),
    permission: requiredText(permission.permission, 'Permission is required.'),
    source: permission.source?.trim() || 'connector',
  }
}

function normalizeUsage(usage: NonNullable<CredentialInventoryItem['usages']>[number]) {
  return {
    used_by_type: requiredText(usage.used_by_type, 'Usage used_by_type is required.'),
    used_by_name: requiredText(usage.used_by_name, 'Usage used_by_name is required.'),
    usage_context: requiredText(usage.usage_context, 'Usage context is required.'),
  }
}

function requiredText(value: unknown, message: string): string {
  if (typeof value !== 'string') {
    throw new Error(message)
  }
  const normalized = value.trim()
  if (normalized === '') {
    throw new Error(message)
  }
  if (/[\r\n\t]/.test(normalized)) {
    throw new Error('Credential inventory fields cannot contain control characters.')
  }
  return normalized
}
