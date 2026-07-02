import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Bell, CheckCircle2, Send } from 'lucide-react'
import { useMemo, useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
import { TextInput } from '../components/ui/text-input'
import { upsertConnector, type ConnectorAccount, type UpsertConnectorInput } from '../lib/api'
import { connectorsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useUiStore } from '../store/ui'

type NotificationProvider = 'slack' | 'resend'

type DestinationForm = {
  provider: NotificationProvider
  name: string
  enabled: boolean
  channel: string
  scope: string
  domain: string
  sender: string
  recipients: string
}

const notificationProviders: Array<{
  provider: NotificationProvider
  title: string
  description: string
  env: string[]
}> = [
  {
    provider: 'slack',
    title: 'Slack',
    description: 'Post deployment started, succeeded, failed, and rollback events to an operations channel.',
    env: ['SLACK_WEBHOOK_URL'],
  },
  {
    provider: 'resend',
    title: 'Email via Resend',
    description: 'Send production deployment and rollback emails through Resend.',
    env: ['RESEND_API_KEY', 'RESEND_FROM_EMAIL'],
  },
]

export function NotificationsRoute() {
  const queryClient = useQueryClient()
  const { data: connectors } = useSuspenseQuery(connectorsQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const [form, setForm] = useState<DestinationForm>(() => defaultDestinationForm())
  const [formError, setFormError] = useState<string>()
  const destinations = useMemo(
    () => connectors.filter((connector) => connector.provider === 'slack' || connector.provider === 'resend'),
    [connectors],
  )
  const visibleDestinations = destinations.filter((destination) => matchesSearch(searchQuery, [
    destination.name,
    destination.provider,
    destination.enabled ? 'enabled' : 'disabled',
    destinationSummary(destination),
  ]))
  const save = useMutation({
    mutationFn: (input: UpsertConnectorInput) => upsertConnector(input),
    onSuccess: async () => {
      setForm((state) => defaultDestinationForm(state.provider))
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: connectorsQuery.queryKey })
    },
  })

  function submit() {
    setFormError(undefined)
    try {
      save.mutate(destinationInput(form))
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Notification destination is invalid.')
    }
  }

  return (
    <div className="space-y-5">
      <PageHeader
        title="Notifications"
        description="Route deployment events to Slack and email destinations without storing webhook URLs or API keys here."
      />
      <div className="grid gap-5 xl:grid-cols-[1fr_380px]">
        <NotificationDestinationList destinations={visibleDestinations} />
        <NotificationDestinationForm
          form={form}
          isSaving={save.isPending}
          errorMessage={formError ?? save.error?.message}
          onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
          onSubmit={submit}
        />
      </div>
      <NotificationRuntime />
    </div>
  )
}

function NotificationDestinationList({ destinations }: { destinations: ConnectorAccount[] }) {
  return (
    <Panel title="Destinations">
      <div className="divide-y">
        {destinations.map((destination) => (
          <div key={destination.id} className="grid gap-4 p-4 lg:grid-cols-[minmax(220px,1fr)_minmax(220px,1.2fr)_160px]">
            <div className="flex min-w-0 items-start gap-3">
              <NotificationIcon provider={notificationProvider(destination.provider)} />
              <div className="min-w-0">
                <div className="truncate font-medium text-ink">{destination.name}</div>
                <div className="mt-1 text-sm text-muted">{providerLabel(destination.provider)}</div>
              </div>
            </div>
            <div className="min-w-0 text-sm text-muted">
              <div className="truncate text-ink">{destinationSummary(destination) || 'No destination metadata yet'}</div>
              <div className="mt-1 truncate">{destinationScope(destination) || 'All deploy events'}</div>
            </div>
            <div className="flex items-start justify-end gap-2">
              <Badge tone={destination.enabled ? 'success' : 'neutral'}>{destination.enabled ? 'enabled' : 'disabled'}</Badge>
              {destination.last_sync_status && <Badge tone={destination.last_sync_status === 'ok' ? 'success' : 'danger'}>{destination.last_sync_status}</Badge>}
            </div>
          </div>
        ))}
        {destinations.length === 0 && (
          <div className="flex items-start gap-3 px-4 py-8 text-sm text-muted">
            <Bell className="mt-0.5 size-4 shrink-0" />
            <div>
              <div className="font-medium text-ink">No notification destinations yet.</div>
              <div className="mt-1">Add Slack or Resend so deployments have somewhere explicit to report status.</div>
            </div>
          </div>
        )}
      </div>
    </Panel>
  )
}

function NotificationDestinationForm({
  form,
  isSaving,
  errorMessage,
  onChange,
  onSubmit,
}: {
  form: DestinationForm
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<DestinationForm>) => void
  onSubmit: () => void
}) {
  const selectedProvider = notificationProviders.find((provider) => provider.provider === form.provider) ?? notificationProviders[0]
  return (
    <Panel title="Add destination">
      <form
        className="space-y-4 p-4"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <div className="grid gap-2 sm:grid-cols-2">
          {notificationProviders.map((provider) => (
            <button
              key={provider.provider}
              type="button"
              className={`rounded-md border bg-background p-3 text-left transition-colors hover:bg-panel ${form.provider === provider.provider ? 'border-accent bg-accent/10' : ''}`}
              onClick={() => onChange(defaultDestinationForm(provider.provider))}
            >
              <div className="flex items-center gap-2">
                <NotificationIcon provider={provider.provider} />
                <div className="font-medium text-ink">{provider.title}</div>
              </div>
              <p className="mt-2 text-sm leading-5 text-muted">{provider.description}</p>
            </button>
          ))}
        </div>
        <TextInput label="Destination name" value={form.name} onChange={(name) => onChange({ name })} placeholder={selectedProvider.title} required />
        {form.provider === 'slack' ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <TextInput label="Channel" value={form.channel} onChange={(channel) => onChange({ channel })} placeholder="#deployments" required />
            <TextInput label="App or project scope" value={form.scope} onChange={(scope) => onChange({ scope })} placeholder="production" />
          </div>
        ) : (
          <div className="space-y-3">
            <div className="grid gap-3 sm:grid-cols-2">
              <TextInput label="Domain" value={form.domain} onChange={(domain) => onChange({ domain })} placeholder="prosights.co" />
              <TextInput label="Sender" value={form.sender} onChange={(sender) => onChange({ sender })} placeholder="deploy@prosights.co" required />
            </div>
            <TextInput label="Recipients" value={form.recipients} onChange={(recipients) => onChange({ recipients })} placeholder="eng@prosights.co, oncall@prosights.co" required />
            <TextInput label="App or project scope" value={form.scope} onChange={(scope) => onChange({ scope })} placeholder="production" />
          </div>
        )}
        <label className="flex items-center gap-2 text-sm text-ink">
          <input
            className="size-4 rounded border bg-background accent-[var(--color-accent)]"
            type="checkbox"
            checked={form.enabled}
            onChange={(event) => onChange({ enabled: event.target.checked })}
          />
          Enabled
        </label>
        <div className="rounded-md border bg-background p-3 text-xs leading-5 text-muted">
          Secret source: {selectedProvider.env.map((value) => (
            <span key={value} className="mx-1 rounded bg-panel px-1.5 py-0.5 font-mono">{value}</span>
          ))}
        </div>
        <Button variant="primary" disabled={isSaving || !form.name}>
          {isSaving ? 'Saving...' : 'Save destination'}
        </Button>
      </form>
      {errorMessage && <div className="border-t px-4 py-3"><InlineError message={errorMessage} /></div>}
    </Panel>
  )
}

function NotificationRuntime() {
  return (
    <Panel title="Delivery rules">
      <div className="grid gap-4 p-4 lg:grid-cols-3">
        <RuntimeStep
          icon={CheckCircle2}
          title="Deployment events"
          description="Started, succeeded, failed, and rollback events can be routed to every enabled destination."
        />
        <RuntimeStep
          icon={Send}
          title="Provider secrets"
          description="Webhook URLs and API keys stay in Doppler or process env. This page stores routing metadata only."
        />
        <RuntimeStep
          icon={Bell}
          title="Audit trail"
          description="Destination changes are saved through connector accounts, so the control-plane audit remains consistent."
        />
      </div>
    </Panel>
  )
}

function RuntimeStep({ icon: Icon, title, description }: { icon: typeof Bell, title: string, description: string }) {
  return (
    <div className="rounded-md border bg-background p-4">
      <div className="flex items-center gap-2 font-medium text-ink">
        <Icon className="size-4 text-muted" />
        {title}
      </div>
      <p className="mt-2 text-sm leading-6 text-muted">{description}</p>
    </div>
  )
}

function defaultDestinationForm(provider: NotificationProvider = 'slack'): DestinationForm {
  return {
    provider,
    name: provider === 'slack' ? 'Deployments' : 'Production email',
    enabled: true,
    channel: '#deployments',
    scope: '',
    domain: 'prosights.co',
    sender: 'deploy@prosights.co',
    recipients: '',
  }
}

function destinationInput(form: DestinationForm): UpsertConnectorInput {
  const name = form.name.trim()
  if (!name) {
    throw new Error('Destination name is required.')
  }
  if (hasControlCharacters(name)) {
    throw new Error('Destination name cannot contain control characters.')
  }
  if (form.provider === 'slack') {
    const channel = form.channel.trim()
    if (!channel) {
      throw new Error('Slack channel is required.')
    }
    return {
      provider: 'slack',
      name,
      enabled: form.enabled,
      config: {
        channels: [channel],
        applications: optionalList(form.scope),
      },
    }
  }
  const recipients = form.recipients.split(',').map((recipient) => recipient.trim()).filter(Boolean)
  if (!form.sender.trim() || recipients.length === 0) {
    throw new Error('Email sender and at least one recipient are required.')
  }
  return {
    provider: 'resend',
    name,
    enabled: form.enabled,
    config: {
      domains: optionalList(form.domain),
      senders: [form.sender.trim()],
      recipients,
      applications: optionalList(form.scope),
    },
  }
}

function optionalList(value: string): string[] {
  const trimmed = value.trim()
  return trimmed ? [trimmed] : []
}

function destinationSummary(destination: ConnectorAccount): string {
  const config = destination.config ?? {}
  if (destination.provider === 'slack') {
    return firstString(config.channels)
  }
  if (destination.provider === 'resend') {
    const recipients = stringList(config.recipients).join(', ')
    return recipients || firstString(config.senders)
  }
  return ''
}

function destinationScope(destination: ConnectorAccount): string {
  const scope = stringList(destination.config?.applications)
  return scope.length ? `Scope: ${scope.join(', ')}` : ''
}

function providerLabel(provider: string): string {
  return provider === 'resend' ? 'Email through Resend' : 'Slack'
}

function notificationProvider(provider: string): NotificationProvider {
  return provider === 'resend' ? 'resend' : 'slack'
}

function NotificationIcon({ provider }: { provider: NotificationProvider }) {
  if (provider === 'resend') {
    return (
      <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-white">
        <img className="max-h-5 max-w-5 object-contain" src="/branding/connectors/resend.svg" alt="" />
      </span>
    )
  }
  return (
    <span className="flex size-8 shrink-0 items-center justify-center rounded-md border bg-white">
      <img className="max-h-5 max-w-5 object-contain" src="/branding/connectors/slack.svg" alt="" />
    </span>
  )
}

function firstString(value: unknown): string {
  const values = stringList(value)
  return values[0] ?? ''
}

function stringList(value: unknown): string[] {
  if (!Array.isArray(value)) {
    return []
  }
  return value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
}

function hasControlCharacters(value: string): boolean {
  return value.includes('\n') || value.includes('\r') || value.includes('\t')
}
