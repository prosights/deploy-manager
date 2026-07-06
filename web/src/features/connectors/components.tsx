import { Check, ChevronRight, ExternalLink, GitBranch, Hammer, Key, RefreshCw, Rocket, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Panel } from '../../components/ui/panel'
import { TextInput } from '../../components/ui/text-input'
import { SelectInput } from '../../components/ui/select-input'
import type { BuildRun, ContainerRegistry, DopplerIntegrationStatus, GitHubIntegrationStatus, GitHubRepository, UpsertContainerRegistryInput } from '../../lib/api'
import { matchesSearch } from '../../lib/search'
import { statusTone } from '../status'

// --- Integration card data ---

type IntegrationCard = {
  id: string
  category: 'source' | 'secrets' | 'registry' | 'notifications'
  name: string
  description: string
  logo: string
  connected: boolean
  statusLabel: string
  actionLabel?: string
  actionHref?: string
  configurable: boolean
  missing?: string[]
}

function buildCards(github: GitHubIntegrationStatus, doppler: DopplerIntegrationStatus, registries: ContainerRegistry[]): IntegrationCard[] {
  const hasRegistry = registries.some((r) => r.enabled)
  return [
    {
      id: 'github',
      category: 'source',
      name: 'GitHub',
      description: 'Push-to-deploy with GitHub Actions builds',
      logo: '/branding/connectors/github.svg',
      connected: github.app_configured && github.build_dispatch_enabled,
      statusLabel: github.app_configured ? 'Connected' : 'Not connected',
      actionLabel: github.app_configured ? undefined : 'Connect',
      actionHref: github.install_url || undefined,
      configurable: true,
      missing: github.missing,
    },
    {
      id: 'doppler',
      category: 'secrets',
      name: 'Doppler',
      description: 'Runtime secrets synced at deploy time',
      logo: '/branding/connectors/doppler.svg',
      connected: doppler.ready,
      statusLabel: doppler.ready ? 'Ready' : 'Not configured',
      configurable: true,
      missing: doppler.missing,
    },
    {
      id: 'docker-registry',
      category: 'registry',
      name: 'Docker Registry',
      description: 'Where built images are pushed and pulled from',
      logo: '/branding/connectors/docker.svg',
      connected: hasRegistry,
      statusLabel: hasRegistry ? `${registries.filter((r) => r.enabled).length} configured` : 'Not configured',
      configurable: true,
    },
    {
      id: 'slack',
      category: 'notifications',
      name: 'Slack',
      description: 'Deploy notifications to your team channel',
      logo: '/branding/connectors/slack.svg',
      connected: false,
      statusLabel: 'Not configured',
      configurable: true,
    },
  ]
}

const categoryLabels: Record<string, string> = {
  source: 'Deploy Sources',
  secrets: 'Secrets & Variables',
  registry: 'Container Registry',
  notifications: 'Notifications',
}

// --- Main integration grid ---

type IntegrationGridProps = {
  githubStatus: GitHubIntegrationStatus
  dopplerStatus: DopplerIntegrationStatus
  registries: ContainerRegistry[]
  onSaveRegistry: (input: UpsertContainerRegistryInput) => void
  isSavingRegistry: boolean
}

export function IntegrationGrid({ githubStatus, dopplerStatus, registries, onSaveRegistry, isSavingRegistry }: IntegrationGridProps) {
  const cards = buildCards(githubStatus, dopplerStatus, registries)
  const [expanded, setExpanded] = useState<string | null>(null)
  const categories = ['source', 'secrets', 'registry', 'notifications'] as const

  return (
    <div className="space-y-6">
      {categories.map((category) => {
        const items = cards.filter((c) => c.category === category)
        if (items.length === 0) return null
        return (
          <div key={category}>
            <h3 className="mb-3 text-xs font-semibold uppercase tracking-wider text-muted">{categoryLabels[category]}</h3>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
              {items.map((item) => (
                <IntegrationCardView
                  key={item.id}
                  card={item}
                  isExpanded={expanded === item.id}
                  onToggle={() => setExpanded(expanded === item.id ? null : item.id)}
                />
              ))}
            </div>
            {items.some((item) => item.id === expanded) && (
              <IntegrationDetail
                card={items.find((item) => item.id === expanded)!}
                githubStatus={githubStatus}
                dopplerStatus={dopplerStatus}
                registries={registries}
                onSaveRegistry={onSaveRegistry}
                isSavingRegistry={isSavingRegistry}
                onClose={() => setExpanded(null)}
              />
            )}
          </div>
        )
      })}
    </div>
  )
}

function IntegrationCardView({ card, isExpanded, onToggle }: { card: IntegrationCard; isExpanded: boolean; onToggle: () => void }) {
  return (
    <button
      type="button"
      onClick={card.actionHref ? undefined : onToggle}
      className={`group relative flex w-full items-center gap-3 rounded-xl border p-4 text-left transition-all ${
        isExpanded ? 'border-accent bg-accent/5 shadow-sm' : 'bg-surface hover:border-accent/30 hover:shadow-sm'
      } ${card.actionHref ? '' : 'cursor-pointer'}`}
    >
      <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-white p-1.5">
        <img className="h-full w-full object-contain" src={card.logo} alt="" />
      </span>
      <div className="min-w-0 flex-1">
        <div className="flex items-center gap-2">
          <span className="font-medium text-ink">{card.name}</span>
          {card.connected && <Check className="size-3.5 text-success" />}
        </div>
        <p className="truncate text-xs text-muted">{card.description}</p>
      </div>
      {card.actionHref ? (
        <a
          href={card.actionHref}
          target="_blank"
          rel="noopener noreferrer"
          onClick={(e) => e.stopPropagation()}
          className="shrink-0 inline-flex items-center gap-1 rounded-md bg-ink px-3 py-1.5 text-xs font-medium text-surface hover:bg-ink/80"
        >
          {card.actionLabel}
          <ExternalLink className="size-3" />
        </a>
      ) : (
        <ChevronRight className={`size-4 shrink-0 text-muted transition-transform ${isExpanded ? 'rotate-90' : ''}`} />
      )}
    </button>
  )
}

// --- Expanded detail panels ---

function IntegrationDetail({ card, githubStatus, dopplerStatus, registries, onSaveRegistry, isSavingRegistry, onClose }: {
  card: IntegrationCard
  githubStatus: GitHubIntegrationStatus
  dopplerStatus: DopplerIntegrationStatus
  registries: ContainerRegistry[]
  onSaveRegistry: (input: UpsertContainerRegistryInput) => void
  isSavingRegistry: boolean
  onClose: () => void
}) {
  return (
    <div className="mt-3 rounded-xl border bg-surface p-5">
      <div className="mb-4 flex items-center justify-between">
        <h4 className="font-semibold text-ink">{card.name} Configuration</h4>
        <button type="button" onClick={onClose} className="rounded-md p-1 text-muted hover:bg-panel hover:text-ink">
          <X className="size-4" />
        </button>
      </div>
      {card.id === 'github' && <GitHubDetail status={githubStatus} />}
      {card.id === 'doppler' && <DopplerDetail status={dopplerStatus} />}
      {card.id === 'docker-registry' && <RegistryDetail registries={registries} onSave={onSaveRegistry} isSaving={isSavingRegistry} />}
      {card.id === 'slack' && <SlackDetail />}
    </div>
  )
}

function GitHubDetail({ status }: { status: GitHubIntegrationStatus }) {
  const items = [
    { label: 'GitHub App', ok: status.app_configured },
    { label: 'Repository sync', ok: status.repository_sync_enabled },
    { label: 'Build dispatch', ok: status.build_dispatch_enabled },
    { label: 'Webhook', ok: status.webhook_configured },
  ]
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 rounded-md border px-3 py-2">
            {item.ok
              ? <Check className="size-3.5 text-success" />
              : <X className="size-3.5 text-danger" />
            }
            <span className="text-sm text-ink">{item.label}</span>
          </div>
        ))}
      </div>
      {status.missing.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm font-medium text-warning">Missing configuration</p>
          <p className="mt-1 font-mono text-xs text-muted">{status.missing.join(', ')}</p>
        </div>
      )}
      {!status.app_configured && !status.install_url && (
        <div className="rounded-md border px-4 py-3">
          <p className="text-sm font-medium text-ink">GitHub App install link is not ready.</p>
          <p className="mt-1 text-sm text-muted">
            Set <code className="rounded bg-panel px-1 font-mono text-xs">GITHUB_APP_SLUG</code> on the Deploy Manager server to enable the one-click install button.
            Repository sync and build dispatch also need the app ID and private key.
          </p>
        </div>
      )}
      {!status.app_configured && status.install_url && (
        <a
          href={status.install_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-ink px-4 py-2 text-sm font-medium text-surface hover:bg-ink/80"
        >
          Install GitHub App
          <ExternalLink className="size-3.5" />
        </a>
      )}
      {status.app_configured && (
        <p className="text-sm text-muted">GitHub App is connected. Push events will trigger builds automatically for connected repositories.</p>
      )}
    </div>
  )
}

function DopplerDetail({ status }: { status: DopplerIntegrationStatus }) {
  const items = [
    { label: 'Connector configured', ok: status.connector_configured },
    { label: 'CLI available', ok: status.cli_available },
    { label: 'Deploy-time sync', ok: status.ready },
  ]
  return (
    <div className="space-y-4">
      <div className="grid gap-2 sm:grid-cols-3">
        {items.map((item) => (
          <div key={item.label} className="flex items-center gap-2 rounded-md border px-3 py-2">
            {item.ok
              ? <Check className="size-3.5 text-success" />
              : <X className="size-3.5 text-danger" />
            }
            <span className="text-sm text-ink">{item.label}</span>
          </div>
        ))}
      </div>
      {status.missing.length > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm font-medium text-warning">Missing server-side configuration</p>
          <p className="mt-1 font-mono text-xs text-muted">{status.missing.join(', ')}</p>
        </div>
      )}
      {status.ready && (
        <p className="text-sm text-muted">Doppler secrets are synced to applications at deploy time. Configure per-app project/config in the application settings.</p>
      )}
    </div>
  )
}

function RegistryDetail({ registries, onSave, isSaving }: { registries: ContainerRegistry[]; onSave: (input: UpsertContainerRegistryInput) => void; isSaving: boolean }) {
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ContainerRegistry['provider']>('ghcr')
  const [host, setHost] = useState('ghcr.io')
  const [namespace, setNamespace] = useState('')
  const [repository, setRepository] = useState('')

  const providerDefaults: Record<string, string> = {
    ghcr: 'ghcr.io',
    ecr: '',
    gcp_artifact_registry: 'us-docker.pkg.dev',
    docker_hub: 'docker.io',
    custom: '',
  }

  function handleSubmit(e: React.FormEvent) {
    e.preventDefault()
    if (!name.trim() || !host.trim() || !repository.trim()) return
    onSave({ name: name.trim(), provider, registry_host: host.trim(), namespace: namespace.trim(), repository: repository.trim(), enabled: true })
    setName('')
    setRepository('')
    setNamespace('')
  }

  return (
    <div className="space-y-4">
      {registries.length > 0 && (
        <div className="space-y-2">
          {registries.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Key className="size-3.5 text-muted" />
                <span className="text-sm font-medium text-ink">{r.name}</span>
                <span className="font-mono text-xs text-muted">{r.registry_host}/{r.namespace || r.repository}</span>
              </div>
              <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Active' : 'Disabled'}</Badge>
            </div>
          ))}
        </div>
      )}
      <form onSubmit={handleSubmit} className="space-y-3 rounded-md border bg-background p-4">
        <p className="text-sm font-medium text-ink">Add registry</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Name" value={name} onChange={setName} placeholder="Production GHCR" />
          <SelectInput label="Provider" value={provider} onChange={(v) => { setProvider(v as ContainerRegistry['provider']); setHost(providerDefaults[v] || '') }}>
            <option value="ghcr">GitHub Container Registry</option>
            <option value="ecr">AWS ECR</option>
            <option value="gcp_artifact_registry">GCP Artifact Registry</option>
            <option value="docker_hub">Docker Hub</option>
            <option value="custom">Custom</option>
          </SelectInput>
        </div>
        <div className="grid gap-3 sm:grid-cols-3">
          <TextInput label="Host" value={host} onChange={setHost} placeholder="ghcr.io" />
          <TextInput label="Namespace" value={namespace} onChange={setNamespace} placeholder="your-org" />
          <TextInput label="Repository" value={repository} onChange={setRepository} placeholder="your-app" />
        </div>
        <Button variant="primary" disabled={isSaving || !name.trim() || !repository.trim()}>
          {isSaving ? 'Saving...' : 'Add registry'}
        </Button>
      </form>
    </div>
  )
}

function SlackDetail() {
  return (
    <div className="space-y-3">
      <p className="text-sm text-muted">
        Set <span className="font-mono text-ink">SLACK_WEBHOOK_URL</span> on the server to receive deployment notifications in your Slack channel.
      </p>
      <a
        href="https://api.slack.com/messaging/webhooks"
        target="_blank"
        rel="noopener noreferrer"
        className="inline-flex items-center gap-1.5 text-sm font-medium text-accent hover:underline"
      >
        Create a Slack webhook
        <ExternalLink className="size-3" />
      </a>
    </div>
  )
}

// --- Connected repos ---

type ConnectedReposProps = {
  repositories: GitHubRepository[]
  searchQuery: string
  isSyncing: boolean
  isDispatching: boolean
  onSync: (connectorID: string) => void
  onBuild: (repository: GitHubRepository) => void
}

export function ConnectedRepos({ repositories, searchQuery, isSyncing, isDispatching, onSync, onBuild }: ConnectedReposProps) {
  const visible = repositories.filter((repo) => matchesSearch(searchQuery, [
    repo.repository,
    repo.branch,
    repo.connector_name,
  ]))

  if (visible.length === 0 && !searchQuery) return null

  const firstConnectorID = visible[0]?.connector_id

  return (
    <Panel
      title="GitHub repository access"
      action={firstConnectorID && (
        <Button variant="ghost" disabled={isSyncing} onClick={() => onSync(firstConnectorID)}>
          <RefreshCw className={`size-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
          Sync from GitHub
        </Button>
      )}
    >
      <div className="flex items-center justify-between border-b px-4 py-3">
        <div>
          <p className="text-sm text-ink">Repositories granted to the Deploy Manager GitHub App.</p>
          <p className="mt-0.5 text-xs text-muted">Use these to create services or dispatch a GitHub Actions build for a repo and branch.</p>
        </div>
        <span className="shrink-0 text-xs text-muted">{visible.length} {visible.length === 1 ? 'repository' : 'repositories'}</span>
      </div>
      <div className="grid grid-cols-[minmax(0,1fr)_150px] border-b px-4 py-2 text-xs font-medium text-muted">
        <span>Repository</span>
        <span className="text-right">Action</span>
      </div>
      <div className="divide-y">
        {visible.map((repo) => (
          <div key={`${repo.connector_id}-${repo.repository}-${repo.branch}`} className="grid grid-cols-[minmax(0,1fr)_150px] items-center gap-4 px-4 py-3">
            <div className="min-w-0">
              <div className="flex items-center gap-2">
                <span className="truncate text-sm font-medium text-ink">{repo.repository}</span>
                <Badge tone="neutral">
                  <GitBranch className="mr-0.5 size-3" />
                  {repo.branch}
                </Badge>
              </div>
              {repo.image_ref ? (
                <p className="mt-0.5 truncate font-mono text-xs text-muted">{repo.image_ref}</p>
              ) : (
                <p className="mt-0.5 text-xs text-muted">No image recorded yet</p>
              )}
            </div>
            <div className="flex justify-end">
              <Button variant="ghost" disabled={isDispatching} onClick={() => onBuild(repo)}>
                <Rocket className="size-3.5" />
                Dispatch build
              </Button>
            </div>
          </div>
        ))}
      </div>
      {visible.length === 0 && searchQuery && (
        <p className="px-4 py-6 text-sm text-muted">No repositories match your search.</p>
      )}
    </Panel>
  )
}

// --- Recent builds ---

type RecentBuildsProps = {
  builds: BuildRun[]
}

export function RecentBuilds({ builds }: RecentBuildsProps) {
  if (builds.length === 0) return null

  return (
    <Panel title="Recent builds">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-2.5 font-medium">Repository</th>
              <th className="px-4 py-2.5 font-medium">Branch</th>
              <th className="px-4 py-2.5 font-medium">Status</th>
              <th className="px-4 py-2.5 font-medium">Image</th>
              <th className="px-4 py-2.5 font-medium">Time</th>
            </tr>
          </thead>
          <tbody>
            {builds.slice(0, 20).map((build) => (
              <tr key={build.id} className="border-t">
                <td className="px-4 py-2.5 font-medium text-ink">{build.repository}</td>
                <td className="px-4 py-2.5">
                  <Badge tone="neutral">
                    <GitBranch className="mr-0.5 size-3" />
                    {build.branch}
                  </Badge>
                </td>
                <td className="px-4 py-2.5">
                  <Badge tone={statusTone(build.status)}>
                    {build.status === 'dispatched' && <Hammer className="mr-0.5 size-3" />}
                    {build.status}
                  </Badge>
                </td>
                <td className="max-w-48 truncate px-4 py-2.5 font-mono text-xs text-muted">
                  {build.image_ref ?? '—'}
                </td>
                <td className="whitespace-nowrap px-4 py-2.5 text-xs text-muted">
                  {build.started_at ? new Date(build.started_at).toLocaleString() : '—'}
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </Panel>
  )
}
