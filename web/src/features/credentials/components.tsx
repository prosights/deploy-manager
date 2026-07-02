import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { cn } from '../../lib/cn'
import type { Credential, CredentialDetail } from '../../lib/api'
import { statusTone } from '../status'

type CredentialInventoryImportPanelProps = {
  value: string
  isSyncing: boolean
  errorMessage?: string
  successMessage?: string
  onChange: (value: string) => void
  onSubmit: () => void
}

export function CredentialInventoryImportPanel({
  value,
  isSyncing,
  errorMessage,
  successMessage,
  onChange,
  onSubmit,
}: CredentialInventoryImportPanelProps) {
  return (
    <Panel title="Import connector facts">
      <div className="border-b px-4 py-3 text-sm text-muted">
        Use this when a connector exports credential inventory. This imports references, permissions, and usage only.
      </div>
      <form
        className="grid gap-3 p-4 lg:grid-cols-[minmax(0,1fr)_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label className="space-y-1 text-xs text-muted">
          <span>Connector JSON</span>
          <textarea
            className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
            value={value}
            onChange={(event) => onChange(event.target.value)}
            placeholder='{"credentials":[{"name":"GitHub deploy key","provider":"github","external_ref":"repo:org/app","credential_type":"deploy_key","permissions":[],"usages":[]}]}'
          />
        </label>
        <div className="flex items-end">
          <Button variant="primary" disabled={isSyncing || !value.trim()}>
            {isSyncing ? 'Importing...' : 'Import facts'}
          </Button>
        </div>
      </form>
      <div className="border-t px-4 py-3 text-sm text-muted">Do not paste tokens, private keys, passwords, or secret values.</div>
      {successMessage && <div className="border-t px-4 py-3 text-sm text-success">{successMessage}</div>}
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

type CredentialInventorySummaryProps = {
  credentials: Credential[]
}

export function CredentialInventorySummary({ credentials }: CredentialInventorySummaryProps) {
  const permissionCount = credentials.reduce((total, credential) => total + credential.permission_count, 0)
  const usageCount = credentials.reduce((total, credential) => total + credential.usage_count, 0)
  const needsReviewCount = credentials.filter((credential) => ['rotating', 'revoked', 'unknown'].includes(credential.status)).length

  return (
    <Panel title="Inventory coverage">
      <div className="grid gap-3 p-4 md:grid-cols-4">
        <CredentialMetric label="Credentials" value={credentials.length} />
        <CredentialMetric label="Access facts" value={permissionCount} />
        <CredentialMetric label="Usage facts" value={usageCount} />
        <CredentialMetric label="Needs review" value={needsReviewCount} muted={needsReviewCount === 0} />
      </div>
    </Panel>
  )
}

function CredentialMetric({ label, value, muted = false }: { label: string; value: number; muted?: boolean }) {
  return (
    <div className="rounded-md border bg-panel px-4 py-3">
      <div className="text-xs text-muted">{label}</div>
      <div className={cn('mt-1 text-2xl font-semibold', muted ? 'text-muted' : 'text-ink')}>{value}</div>
    </div>
  )
}

type CredentialListProps = {
  credentials: Credential[]
  selectedID?: string
  onInspect: (credentialID: string) => void
}

export function CredentialList({ credentials, selectedID, onInspect }: CredentialListProps) {
  return (
    <Panel title="Credential inventory">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Credential reference</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Access</th>
              <th className="px-4 py-3 font-medium">Usage</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium" />
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr key={credential.id} className={cn('border-t', selectedID === credential.id && 'bg-accent/10')}>
                <td className="px-4 py-3">
                  <div className="font-medium">{credential.name}</div>
                  <div className="text-xs text-muted">{credential.external_ref}</div>
                </td>
                <td className="px-4 py-3 text-muted">{credential.provider}</td>
                <td className="px-4 py-3 text-muted">{credential.credential_type}</td>
                <td className="px-4 py-3 text-muted">{credential.permission_count}</td>
                <td className="px-4 py-3 text-muted">{credential.usage_count}</td>
                <td className="px-4 py-3">
                  <Badge tone={statusTone(credential.status)}>{credential.status}</Badge>
                </td>
                <td className="px-4 py-3">
                  <Button variant="ghost" onClick={() => onInspect(credential.id)}>Inspect access</Button>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {credentials.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No credentials found.</div>}
    </Panel>
  )
}

export function CredentialSelectionHint() {
  return (
    <Panel>
      <div className="px-4 py-6">
        <h2 className="text-sm font-semibold text-ink">Select a credential to inspect blast radius</h2>
        <p className="mt-1 text-sm text-muted">
          The detail view shows what the credential can access and which deployments or connectors currently depend on it.
        </p>
      </div>
    </Panel>
  )
}

type CredentialInventoryPanelsProps = {
  credential: Credential
  detail?: CredentialDetail
}

export function CredentialInventoryPanels({ credential, detail }: CredentialInventoryPanelsProps) {
  const identity = detail?.credential ?? credential

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title="Credential detail">
        <dl className="grid gap-3 p-4 text-sm">
          <div>
            <dt className="text-xs text-muted">Name</dt>
            <dd className="text-ink">{identity.name}</dd>
          </div>
          <div>
            <dt className="text-xs text-muted">Reference</dt>
            <dd className="break-all font-mono text-xs text-ink">{identity.external_ref}</dd>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <div>
              <dt className="text-xs text-muted">Provider</dt>
              <dd className="text-ink">{identity.provider}</dd>
            </div>
            <div>
              <dt className="text-xs text-muted">Type</dt>
              <dd className="text-ink">{identity.credential_type}</dd>
            </div>
          </div>
          <div className="flex items-center gap-2">
            <dt className="text-xs text-muted">Status</dt>
            <dd>
              <Badge tone={statusTone(identity.status)}>{identity.status}</Badge>
            </dd>
          </div>
        </dl>
      </Panel>
      <Panel title="Access">
        <InventoryTable
          empty="No access facts have been reported yet."
          headers={['Resource', 'Permission', 'Source']}
          rows={(detail?.permissions ?? []).map((permission) => [
            `${permission.resource_type} / ${permission.resource_name}`,
            permission.permission,
            permission.source,
          ])}
        />
      </Panel>
      <Panel title="Used by">
        <InventoryTable
          empty="No usage has been reported yet."
          headers={['Target', 'Context']}
          rows={(detail?.usages ?? []).map((usage) => [
            `${usage.used_by_type} / ${usage.used_by_name}`,
            usage.usage_context,
          ])}
        />
      </Panel>
    </div>
  )
}

function InventoryTable({ headers, rows, empty }: { headers: string[]; rows: string[][]; empty: string }) {
  if (rows.length === 0) {
    return <div className="p-4 text-sm text-muted">{empty}</div>
  }

  return (
    <div className="overflow-x-auto">
      <table className="w-full text-left text-sm">
        <thead className="text-xs text-muted">
          <tr>
            {headers.map((header) => (
              <th key={header} className="px-4 py-3 font-medium">{header}</th>
            ))}
          </tr>
        </thead>
        <tbody>
          {rows.map((row) => (
            <tr key={row.join(':')} className="border-t">
              {row.map((value) => (
                <td key={value} className="px-4 py-3 text-muted">{value}</td>
              ))}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  )
}
