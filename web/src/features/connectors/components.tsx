import { Check, Cloud, Copy, Radio, RefreshCw } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { PanelError } from '../../components/ui/error-message'
import { Panel } from '../../components/ui/panel'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import type { ConnectorAccount } from '../../lib/api'

export type ConnectorFormState = {
  provider: string
  name: string
  enabled: boolean
  config: string
}

type ConnectorProvider = 'github' | 'doppler' | 'gcs' | 's3'

type ProviderCard = {
  provider: ConnectorProvider
  title: string
  description: string
  status: string
  env: string[]
  configHint: string
  logo?: string
}

const providerCards: ProviderCard[] = [
  {
    provider: 'github',
    title: 'GitHub',
    description: 'Connect repositories for deploy webhooks, deploy keys, and credential inventory.',
    status: 'Deploy source',
    env: ['GITHUB_WEBHOOK_SECRET'],
    configHint: 'Repo and branch only. Secrets stay in GitHub or env.',
    logo: '/branding/connectors/github.svg',
  },
  {
    provider: 'doppler',
    title: 'Doppler',
    description: 'Resolve runtime env vars during deploy without storing secret values here.',
    status: 'Secrets runtime',
    env: ['DOPPLER_PROJECT', 'DOPPLER_CONFIG', 'DOPPLER_TOKEN'],
    configHint: 'Project/config mapping only. Token stays in env.',
    logo: '/branding/connectors/doppler.svg',
  },
  {
    provider: 'gcs',
    title: 'Google Cloud Storage',
    description: 'Track Google Cloud project and GCS bucket access for deploy assets.',
    status: 'Cloud inventory',
    env: ['GOOGLE_APPLICATION_CREDENTIALS'],
    configHint: 'Project and bucket metadata. Service account JSON stays outside.',
  },
  {
    provider: 's3',
    title: 'Amazon S3',
    description: 'Track AWS bucket access and object storage credential inventory.',
    status: 'Storage inventory',
    env: ['AWS_PROFILE'],
    configHint: 'Region and bucket metadata. Keys stay in AWS or env.',
  },
]

export function defaultConnectorForm(): ConnectorFormState {
  return {
    provider: 'github',
    name: 'GitHub',
    enabled: true,
    config: configTemplate('github'),
  }
}

function configTemplate(provider: string): string {
  switch (provider) {
    case 'github':
      return JSON.stringify({ repositories: [{ repository: '', branch: 'main', credential_name: '', external_ref: '' }] }, null, 2)
    case 'doppler':
      return JSON.stringify({ project: '', config: '', applications: [] }, null, 2)
    case 's3':
      return JSON.stringify({ buckets: [{ credential_name: '', external_ref: '', bucket: '', permissions: [] }] }, null, 2)
    case 'gcs':
      return JSON.stringify({ project_id: '', buckets: [{ credential_name: '', external_ref: '', bucket: '', permissions: [] }] }, null, 2)
    default:
      return '{}'
  }
}

function connectorProvider(value: string): ConnectorProvider {
  if (['github', 'doppler', 'gcs', 's3'].includes(value)) {
    return value as ConnectorProvider
  }
  return 'github'
}

function ProviderIcon({ provider }: { provider: ConnectorProvider }) {
  const card = providerCards.find((item) => item.provider === provider)
  if (!card?.logo) {
    return (
      <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-background">
        <Cloud className="size-4 text-muted" />
      </span>
    )
  }
  return (
    <span className="flex size-6 shrink-0 items-center justify-center rounded-md border bg-white">
      <img className="max-h-4 max-w-4 object-contain" src={card.logo} alt="" />
    </span>
  )
}

function parseMetadata(value: string): Record<string, unknown> {
  try {
    const parsed = JSON.parse(value || '{}') as unknown
    if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
      return parsed as Record<string, unknown>
    }
  } catch {
    // Keep the typed fields resilient while Advanced JSON is being edited.
  }
  return {}
}

function firstRecord(value: unknown): Record<string, unknown> {
  if (!Array.isArray(value)) {
    return {}
  }
  const first = value[0]
  return first && !Array.isArray(first) && typeof first === 'object' ? first as Record<string, unknown> : {}
}

function firstString(value: unknown): string {
  if (!Array.isArray(value)) {
    return ''
  }
  return stringValue(value[0])
}

function stringValue(value: unknown): string {
  return typeof value === 'string' ? value : ''
}

type ConnectorFormProps = {
  form: ConnectorFormState
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ConnectorFormState>) => void
  onSubmit: () => void
}

export function ConnectorForm({ form, isSaving, errorMessage, onChange, onSubmit }: ConnectorFormProps) {
  const provider = connectorProvider(form.provider)
  const selected = providerCards.find((card) => card.provider === provider) ?? providerCards[0]

  return (
    <Panel title="Add integration">
      <div className="grid gap-3 border-b p-4 md:grid-cols-2 xl:grid-cols-3">
        {providerCards.map((card) => (
          <button
            key={card.provider}
            type="button"
            className={`rounded-md border bg-background p-3 text-left transition-colors hover:bg-panel ${card.provider === provider ? 'border-accent bg-accent/10' : ''}`}
            onClick={() => onChange({ provider: card.provider, name: card.title, config: configTemplate(card.provider) })}
          >
            <div className="flex items-start justify-between gap-3">
              <div className="flex items-center gap-2">
                <ProviderIcon provider={card.provider} />
                <div className="font-medium text-ink">{card.title}</div>
              </div>
              <Badge tone={card.provider === provider ? 'accent' : 'neutral'}>{card.status}</Badge>
            </div>
            <p className="mt-2 text-sm leading-5 text-muted">{card.description}</p>
          </button>
        ))}
      </div>
      <form
        className="grid gap-4 p-4 lg:grid-cols-[1fr_240px]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="space-y-4">
          <div className="grid gap-3 md:grid-cols-[1fr_140px]">
            <TextInput label="Connection name" value={form.name} onChange={(name) => onChange({ name })} placeholder={selected.title} required />
            <SelectInput label="Status" value={form.enabled ? 'true' : 'false'} onChange={(value) => onChange({ enabled: value === 'true' })}>
              <option value="true">Enabled</option>
              <option value="false">Disabled</option>
            </SelectInput>
          </div>
          <ProviderFields provider={provider} config={form.config} onChange={(config) => onChange({ config })} />
          <details className="rounded-md border bg-background">
            <summary className="cursor-pointer px-3 py-2 text-sm font-medium text-ink">Advanced metadata</summary>
            <label className="block space-y-1 border-t p-3 text-xs text-muted">
              <span>Metadata JSON</span>
              <textarea
                aria-label="Metadata JSON"
                className="min-h-24 w-full resize-y rounded-md border bg-surface px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
                value={form.config}
                onChange={(event) => onChange({ config: event.target.value })}
                placeholder='{"default_branch":"main"}'
              />
            </label>
          </details>
          <Button variant="primary" disabled={isSaving || !form.provider || !form.name}>
            {isSaving ? 'Saving...' : 'Save integration'}
          </Button>
        </div>
        <div className="rounded-md border bg-background p-4">
          <div className="flex items-center gap-2">
            <ProviderIcon provider={provider} />
            <div className="font-medium text-ink">{selected.title}</div>
          </div>
          <p className="mt-3 text-sm leading-6 text-muted">{selected.configHint}</p>
          <div className="mt-4 text-xs font-medium text-muted">Secret source</div>
          <div className="mt-2 flex flex-wrap gap-2">
            {selected.env.map((variable) => (
              <span key={variable} className="rounded-md bg-panel px-2 py-1 font-mono text-xs text-muted">{variable}</span>
            ))}
          </div>
          <div className="mt-4 rounded-md bg-panel px-3 py-2 text-xs leading-5 text-muted">
            This app stores connector metadata only. Tokens, webhooks, API keys, and private keys stay in environment variables or provider systems.
          </div>
        </div>
      </form>
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

function ProviderFields({ provider, config, onChange }: { provider: ConnectorProvider, config: string, onChange: (config: string) => void }) {
  const metadata = parseMetadata(config)
  function update(next: Record<string, unknown>) {
    onChange(JSON.stringify(next, null, 2))
  }

  if (provider === 'github') {
    const repository = firstRecord(metadata.repositories)?.repository
    const branch = stringValue(firstRecord(metadata.repositories)?.branch) || 'main'
    return (
      <div className="grid gap-3 md:grid-cols-2">
        <TextInput label="Repository" value={stringValue(repository)} onChange={(value) => update({ repositories: [{ ...firstRecord(metadata.repositories), repository: value, branch }] })} placeholder="prosights/recreate" />
        <TextInput label="Branch" value={branch} onChange={(value) => update({ repositories: [{ ...firstRecord(metadata.repositories), repository: stringValue(repository), branch: value }] })} placeholder="main" />
      </div>
    )
  }
  if (provider === 'doppler') {
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <TextInput label="Doppler project" value={stringValue(metadata.project)} onChange={(value) => update({ ...metadata, project: value })} placeholder="recreate" />
        <TextInput label="Config" value={stringValue(metadata.config)} onChange={(value) => update({ ...metadata, config: value })} placeholder="prd" />
        <TextInput label="App scope" value={firstString(metadata.applications)} onChange={(value) => update({ ...metadata, applications: value ? [value] : [] })} placeholder="production" />
      </div>
    )
  }
  if (provider === 'gcs') {
    const bucket = firstRecord(metadata.buckets)
    return (
      <div className="grid gap-3 md:grid-cols-3">
        <TextInput label="GCP project" value={stringValue(metadata.project_id)} onChange={(value) => update({ ...metadata, project_id: value })} placeholder="prosights-platform" />
        <TextInput label="Bucket" value={stringValue(bucket.bucket)} onChange={(value) => update({ ...metadata, buckets: [{ ...bucket, bucket: value }] })} placeholder="deploy-artifacts" />
        <TextInput label="Credential ref" value={stringValue(bucket.external_ref)} onChange={(value) => update({ ...metadata, buckets: [{ ...bucket, external_ref: value }] })} placeholder="gcp-service-account" />
      </div>
    )
  }
  const bucket = firstRecord(metadata.buckets)
  return (
    <div className="grid gap-3 md:grid-cols-3">
      <TextInput label="Region" value={stringValue(metadata.region)} onChange={(value) => update({ ...metadata, region: value })} placeholder="us-east-1" />
      <TextInput label="Bucket" value={stringValue(bucket.bucket)} onChange={(value) => update({ ...metadata, buckets: [{ ...bucket, bucket: value }] })} placeholder="deploy-artifacts" />
      <TextInput label="Credential ref" value={stringValue(bucket.external_ref)} onChange={(value) => update({ ...metadata, buckets: [{ ...bucket, external_ref: value }] })} placeholder="aws-role" />
    </div>
  )
}

export function ConnectorGuides() {
  return (
    <>
      <Panel title="GitHub deploy webhooks">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ProviderIcon provider="github" />
              <div className="font-medium">Push-triggered deployments</div>
              <Badge tone="accent">/api/webhooks/github</Badge>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted">
              GitHub push events queue deployments for applications whose repository URL and branch match the payload. The webhook secret is supplied by <span className="font-mono text-ink">GITHUB_WEBHOOK_SECRET</span>; this app does not store it.
            </p>
            <p className="max-w-2xl text-sm leading-6 text-muted">
              Registered GitHub connectors can sync repository credential references, permissions, and deployment usage into the credential inventory from metadata.
            </p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="flex items-center justify-between gap-3">
              <div>
                <div className="text-xs uppercase text-muted">Webhook URL</div>
                <div className="mt-1 font-mono text-sm text-ink">/api/webhooks/github</div>
              </div>
              <div className="flex items-center gap-2">
                <CopyButton text="/api/webhooks/github" />
                <Button variant="ghost" type="button">
                  <Radio className="size-4" />
                  Active
                </Button>
              </div>
            </div>
            <div className="mt-3 text-xs text-muted">Events: push, ping. Signature: X-Hub-Signature-256. Config key: repositories.</div>
          </div>
        </div>
      </Panel>
      <Panel title="Doppler runtime sync">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ProviderIcon provider="doppler" />
              <div className="font-medium">Runtime environment files</div>
              <Badge tone="accent">deploy-time sync</Badge>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted">
              When Doppler is configured, deployments download runtime variables and write a locked-down <span className="font-mono text-ink">.env</span> file on the target server before Compose starts. Deploy Manager does not persist those values.
            </p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs uppercase text-muted">Environment</div>
            <div className="mt-3 flex flex-wrap gap-2">
              {['DOPPLER_PROJECT', 'DOPPLER_CONFIG', 'DOPPLER_TOKEN'].map((variable) => (
                <span key={variable} className="rounded-md bg-panel px-2 py-1 font-mono text-xs text-muted">{variable}</span>
              ))}
            </div>
            <div className="mt-3 text-xs text-muted">Requires the Doppler CLI on the Go server host. Inventory metadata keys: project, config, applications.</div>
          </div>
        </div>
      </Panel>
      <Panel title="Object storage inventory">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <ProviderIcon provider="s3" />
              <ProviderIcon provider="gcs" />
              <div className="font-medium">S3 and GCS bucket access</div>
              <Badge tone="accent">/api/object-storage/inventory</Badge>
            </div>
            <p className="max-w-2xl text-sm leading-6 text-muted">
              Storage connectors report bucket permissions and application usage into the credential inventory. Registered S3 and GCS connectors can sync bucket metadata from their connector config; provider keys and tokens stay in their source systems.
            </p>
          </div>
          <div className="rounded-md border bg-background p-3">
            <div className="text-xs uppercase text-muted">Supported providers</div>
            <div className="mt-3 flex flex-wrap gap-2">
              <Badge tone="neutral">s3</Badge>
              <Badge tone="neutral">gcs</Badge>
            </div>
            <div className="mt-3 text-xs text-muted">Config key: buckets. Reports: credential reference, bucket, permissions, usages.</div>
          </div>
        </div>
      </Panel>
    </>
  )
}

export function ConnectorSyncGrid({
  connectors,
  isSyncing,
  onSync,
}: {
  connectors: ConnectorAccount[]
  isSyncing: boolean
  onSync: (connectorID: string) => void
}) {
  return (
    <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
      {connectors.map((connector) => (
        <Panel key={connector.id}>
          <div className="space-y-3 p-4">
            <div className="flex items-start justify-between gap-3">
              <div className="flex min-w-0 items-center gap-3">
                <ProviderIcon provider={connectorProvider(connector.provider)} />
                <div className="min-w-0">
                  <div className="font-medium">{connector.name}</div>
                  <div className="text-sm text-muted">{connector.provider}</div>
                </div>
              </div>
              <div className="flex flex-col items-end gap-2">
                <Badge tone={connector.enabled ? 'success' : 'neutral'}>{connector.enabled ? 'enabled' : 'disabled'}</Badge>
                {connector.last_sync_status && <Badge tone={connector.last_sync_status === 'ok' ? 'success' : 'danger'}>{connector.last_sync_status}</Badge>}
              </div>
            </div>
            <div className="text-sm text-muted">{connector.last_sync_message ?? 'No sync has run yet.'}</div>
            <div className="flex items-center justify-between gap-3">
              <div className="text-xs text-muted">
                {connector.last_synced_at ? `Last sync ${new Date(connector.last_synced_at).toLocaleString()}` : 'Not synced yet'}
              </div>
              <Button variant="ghost" disabled={!connector.enabled || isSyncing} onClick={() => onSync(connector.id)}>
                <RefreshCw className="size-4" />
                Sync
              </Button>
            </div>
          </div>
        </Panel>
      ))}
      {connectors.length === 0 && <div className="rounded-md border bg-panel px-4 py-6 text-sm text-muted">No connectors found.</div>}
    </div>
  )
}

function CopyButton({ text }: { text: string }) {
  const [copied, setCopied] = useState(false)

  return (
    <Button
      variant="ghost"
      type="button"
      className="size-9 p-0"
      onClick={() => {
        navigator.clipboard.writeText(text)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
      }}
      aria-label="Copy to clipboard"
    >
      {copied ? <Check className="size-4 text-success" /> : <Copy className="size-4" />}
    </Button>
  )
}
