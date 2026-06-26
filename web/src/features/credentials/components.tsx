import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
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
    <Panel title="Import inventory facts">
      <form
        className="grid gap-3 p-4 lg:grid-cols-[1fr_auto]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <label className="space-y-1 text-xs text-muted">
          <span>Connector JSON</span>
          <textarea
            className="min-h-28 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
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
      <div className="border-t px-4 py-3 text-sm text-muted">Import permission and usage facts only. Do not paste tokens, private keys, passwords, or secret values.</div>
      {successMessage && <div className="border-t px-4 py-3 text-sm text-success">{successMessage}</div>}
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

type CredentialListProps = {
  credentials: Credential[]
  onInspect: (credentialID: string) => void
}

export function CredentialList({ credentials, onInspect }: CredentialListProps) {
  return (
    <Panel>
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Credential</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Type</th>
              <th className="px-4 py-3 font-medium">Permissions</th>
              <th className="px-4 py-3 font-medium">Used by</th>
              <th className="px-4 py-3 font-medium">Status</th>
              <th className="px-4 py-3 font-medium">Action</th>
            </tr>
          </thead>
          <tbody>
            {credentials.map((credential) => (
              <tr key={credential.id} className="border-t">
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
                  <Button variant="ghost" onClick={() => onInspect(credential.id)}>Inspect</Button>
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

type CredentialInventoryPanelsProps = {
  credential: Credential
  detail?: CredentialDetail
}

export function CredentialInventoryPanels({ credential, detail }: CredentialInventoryPanelsProps) {
  const identity = detail?.credential ?? credential

  return (
    <div className="grid gap-4 xl:grid-cols-3">
      <Panel title={`Inventory: ${identity.name}`}>
        <dl className="grid gap-3 p-4 text-sm">
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
      <Panel title={`Permissions: ${credential.name}`}>
        <InventoryTable
          empty="No permissions have been reported yet."
          headers={['Resource', 'Permission', 'Source']}
          rows={(detail?.permissions ?? []).map((permission) => [
            `${permission.resource_type} / ${permission.resource_name}`,
            permission.permission,
            permission.source,
          ])}
        />
      </Panel>
      <Panel title={`Used by: ${credential.name}`}>
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
