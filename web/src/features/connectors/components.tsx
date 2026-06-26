import { Check, Cloud, Copy, Github, KeyRound, Mail, MessageSquare, Radio, RefreshCw } from 'lucide-react'
import type React from 'react'
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

export function defaultConnectorForm(): ConnectorFormState {
  return {
    provider: 'github',
    name: '',
    enabled: true,
    config: configTemplate('github'),
  }
}

function configTemplate(provider: string): string {
  switch (provider) {
    case 'github':
      return JSON.stringify({ repositories: [{ repository: 'owner/repo', credential_name: '', external_ref: '' }] }, null, 2)
    case 'doppler':
      return JSON.stringify({ project: '', config: '', applications: [] }, null, 2)
    case 's3':
      return JSON.stringify({ buckets: [{ credential_name: '', external_ref: '', bucket: '', permissions: [] }] }, null, 2)
    case 'gcs':
      return JSON.stringify({ buckets: [{ credential_name: '', external_ref: '', bucket: '', permissions: [] }] }, null, 2)
    case 'slack':
      return JSON.stringify({ channels: ['#deployments'], applications: [] }, null, 2)
    case 'resend':
      return JSON.stringify({ domains: [''], senders: [], applications: [] }, null, 2)
    default:
      return '{}'
  }
}

type ConnectorFormProps = {
  form: ConnectorFormState
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<ConnectorFormState>) => void
  onSubmit: () => void
}

export function ConnectorForm({ form, isSaving, errorMessage, onChange, onSubmit }: ConnectorFormProps) {
  const providerHints: Record<string, string> = {
    github: 'Repository deploy keys and credential references',
    doppler: 'Runtime secrets synced at deploy time via CLI',
    s3: 'AWS S3 bucket access and credential inventory',
    gcs: 'Google Cloud Storage bucket access and credentials',
    slack: 'Deployment notification webhooks to channels',
    resend: 'Deployment email notifications via Resend API',
  }

  return (
    <Panel title="Register connector">
      <form
        className="grid gap-3 p-4 lg:grid-cols-[160px_1fr_130px]"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <SelectInput label="Provider" value={form.provider} onChange={(provider) => onChange({ provider, config: configTemplate(provider) })} required>
          <option value="github">GitHub</option>
          <option value="doppler">Doppler</option>
          <option value="s3">S3</option>
          <option value="gcs">GCS</option>
          <option value="slack">Slack</option>
          <option value="resend">Resend</option>
        </SelectInput>
        <TextInput label="Name" value={form.name} onChange={(name) => onChange({ name })} placeholder="production" required />
        <SelectInput label="Enabled" value={form.enabled ? 'true' : 'false'} onChange={(value) => onChange({ enabled: value === 'true' })}>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </SelectInput>
        <label className="space-y-1 text-xs text-muted lg:col-span-2">
          <span>Metadata JSON</span>
          <textarea
            aria-label="Metadata JSON"
            className="min-h-24 w-full resize-y rounded-md border bg-background px-3 py-2 font-mono text-sm text-ink outline-none placeholder:text-muted/60 focus-visible:ring-2 focus-visible:ring-accent"
            value={form.config}
            onChange={(event) => onChange({ config: event.target.value })}
            placeholder='{"default_branch":"main"}'
          />
          <span className="text-xs text-muted">{providerHints[form.provider] ?? 'Provider integration metadata'}</span>
        </label>
        <div className="flex items-end">
          <Button variant="primary" disabled={isSaving || !form.provider || !form.name}>
            {isSaving ? 'Saving...' : 'Save connector'}
          </Button>
        </div>
      </form>
      <div className="border-t px-4 py-3 text-sm text-muted">Store connector metadata only. Secrets, tokens, and private keys must stay in environment variables or provider systems.</div>
      {errorMessage && <PanelError message={errorMessage} />}
    </Panel>
  )
}

export function ConnectorGuides() {
  return (
    <>
      <Panel title="GitHub deploy webhooks">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <Github className="size-4 text-accent" />
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
      <Panel title="Deployment notifications">
        <div className="grid gap-4 p-4 md:grid-cols-2">
          <NotificationConnector
            icon={<MessageSquare className="size-4 text-accent" />}
            title="Slack"
            status="Env backed + inventory"
            description="Deployment success and failure notifications are posted to the configured Slack incoming webhook. Registered Slack connectors can sync channel permission metadata."
            variables={['SLACK_WEBHOOK_URL']}
            metadata="channels, applications"
          />
          <NotificationConnector
            icon={<Mail className="size-4 text-accent" />}
            title="Resend"
            status="Env backed + inventory"
            description="Deployment success and failure emails are sent through Resend when sender, recipient, and API key are configured. Registered Resend connectors can sync sender permission metadata."
            variables={['RESEND_API_KEY', 'RESEND_FROM_EMAIL', 'RESEND_TO_EMAIL']}
            metadata="domains, senders, applications"
          />
        </div>
      </Panel>
      <Panel title="Doppler runtime sync">
        <div className="grid gap-4 p-4 lg:grid-cols-[1.2fr_1fr]">
          <div className="space-y-3">
            <div className="flex items-center gap-2">
              <KeyRound className="size-4 text-accent" />
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
              <Cloud className="size-4 text-accent" />
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
              <div>
                <div className="font-medium">{connector.name}</div>
                <div className="text-sm text-muted">{connector.provider}</div>
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

function NotificationConnector({
  icon,
  title,
  status,
  description,
  variables,
  metadata,
}: {
  icon: React.ReactNode
  title: string
  status: string
  description: string
  variables: string[]
  metadata: string
}) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-start justify-between gap-3">
        <div className="flex items-center gap-2">
          {icon}
          <div className="font-medium">{title}</div>
        </div>
        <Badge tone="accent">{status}</Badge>
      </div>
      <p className="mt-3 text-sm leading-6 text-muted">{description}</p>
      <div className="mt-3 flex flex-wrap gap-2">
        {variables.map((variable) => (
          <span key={variable} className="rounded-md bg-panel px-2 py-1 font-mono text-xs text-muted">{variable}</span>
        ))}
      </div>
      <div className="mt-3 text-xs text-muted">Config keys: {metadata}.</div>
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
