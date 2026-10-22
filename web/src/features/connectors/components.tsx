import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, ChevronRight, ExternalLink, GitBranch, Key, RefreshCw, Search, X } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTrigger } from '../../components/ui/dialog'
import { TextInput } from '../../components/ui/text-input'
import { SelectInput } from '../../components/ui/select-input'
import {
  syncGitHubConnectorRepositories,
  upsertContainerRegistry,
  type ConnectorAccount,
  type ContainerRegistry,
  type DopplerIntegrationStatus,
  type GitHubIntegrationStatus,
} from '../../lib/api'
import { connectorsQuery, containerRegistriesQuery, dopplerProjectsQuery, dopplerStatusQuery, githubRepositoriesQuery, githubStatusQuery } from '../../lib/queries'

// --- Integration card data ---

type IntegrationCard = {
  id: string
  category: 'source' | 'secrets' | 'registry' | 'notifications'
  name: string
  description: string
  logo: string
  connected: boolean
  statusLabel: string
}

function buildCards(github: GitHubIntegrationStatus, doppler: DopplerIntegrationStatus, registries: ContainerRegistry[], githubConnected: boolean): IntegrationCard[] {
  const hasRegistry = registries.some((r) => r.enabled)
  const githubReady = github.app_configured && githubConnected
  const githubStatusLabel = githubReady
    ? 'Ready'
    : github.app_configured
      ? 'Install required'
      : 'Server setup required'
  return [
    {
      id: 'github',
      category: 'source',
      name: 'GitHub',
      description: 'Push-to-deploy with GitHub Actions builds',
      logo: '/branding/connectors/github.svg',
      connected: githubReady,
      statusLabel: githubStatusLabel,
    },
    {
      id: 'doppler',
      category: 'secrets',
      name: 'Doppler',
      description: 'Runtime secrets synced at deploy time',
      logo: '/branding/connectors/doppler.svg',
      connected: doppler.ready,
      statusLabel: doppler.ready ? 'Ready on this server' : 'Server setup required',
    },
    {
      id: 'docker-registry',
      category: 'registry',
      name: 'Docker Registry',
      description: 'Where built images are pushed and pulled from',
      logo: '/branding/connectors/docker.svg',
      connected: hasRegistry,
      statusLabel: hasRegistry ? `${registries.filter((r) => r.enabled).length} configured` : 'Not configured',
    },
    {
      id: 'slack',
      category: 'notifications',
      name: 'Slack',
      description: 'Deploy notifications to your team channel',
      logo: '/branding/connectors/slack.svg',
      connected: false,
      statusLabel: 'Not configured',
    },
  ]
}

const categoryLabels: Record<IntegrationCard['category'], string> = {
  source: 'Deploy Sources',
  secrets: 'Secrets & Variables',
  registry: 'Container Registry',
  notifications: 'Notifications',
}

// The enabled GitHub App installation, if any.
function githubConnector(connectors: ConnectorAccount[]) {
  return connectors.find((connector) => connector.provider === 'github' && connector.enabled)
}

// --- Main integration grid ---

export function IntegrationGrid() {
  const { data: githubStatus } = useSuspenseQuery(githubStatusQuery)
  const { data: dopplerStatus } = useSuspenseQuery(dopplerStatusQuery)
  const { data: registries } = useSuspenseQuery(containerRegistriesQuery)
  const { data: githubConnected } = useSuspenseQuery({ ...connectorsQuery, select: (connectors) => Boolean(githubConnector(connectors)) })
  const cards = buildCards(githubStatus, dopplerStatus, registries, githubConnected)

  return (
    <section className="space-y-3">
      <div>
        <h2 className="text-sm font-semibold text-prosights-text">Connectors</h2>
        <p className="mt-1 text-sm text-prosights-muted">Open a connector to see its status, purpose, and next action.</p>
      </div>
      <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
        {cards.map((card) => (
          <Dialog key={card.id}>
            <IntegrationCardView card={card} />
            <IntegrationDialog card={card} />
          </Dialog>
        ))}
      </div>
    </section>
  )
}

function IntegrationCardView({ card }: { card: IntegrationCard }) {
  return (
    <DialogTrigger
      aria-label={`Open ${card.name} integration`}
      className="group flex min-h-28 w-full flex-col justify-between rounded-xl border bg-prosights-surface p-4 text-left transition-[border-color,transform] duration-150 hover:-translate-y-0.5 hover:border-prosights-text/25"
    >
      <span className="flex w-full items-start gap-3">
        <span className="flex size-9 shrink-0 items-center justify-center rounded-lg border bg-white p-1.5">
          <img className="h-full w-full object-contain" src={card.logo} alt="" />
        </span>
        <div className="min-w-0 flex-1">
          <span className="block text-[11px] font-medium uppercase tracking-wide text-prosights-muted">{categoryLabels[card.category]}</span>
          <span className="mt-0.5 block font-medium text-prosights-text">{card.name}</span>
        </div>
        <ChevronRight className="size-4 shrink-0 text-prosights-muted transition-transform group-hover:translate-x-0.5" />
      </span>
      <span className="mt-4 flex w-full items-end justify-between gap-3">
        <span className="min-w-0 text-xs text-prosights-muted">{card.description}</span>
        <Badge tone={card.connected ? 'success' : 'neutral'}>{card.statusLabel}</Badge>
      </span>
    </DialogTrigger>
  )
}

// --- Connector detail dialog ---

function IntegrationDialog({ card }: { card: IntegrationCard }) {
  return (
    <DialogContent size="md">
      <DialogHeader
        title={card.name}
        description={card.description}
        closeLabel={`Close ${card.name} integration`}
        icon={(
          <span className="flex size-10 shrink-0 items-center justify-center rounded-lg border bg-white p-2">
            <img className="h-full w-full object-contain" src={card.logo} alt="" />
          </span>
        )}
        actions={<Badge tone={card.connected ? 'success' : 'neutral'}>{card.statusLabel}</Badge>}
      />
      <DialogBody>
        {card.id === 'github' && <GitHubDetail />}
        {card.id === 'doppler' && <DopplerDetail />}
        {card.id === 'docker-registry' && <RegistryDetail />}
        {card.id === 'slack' && <SlackDetail />}
      </DialogBody>
    </DialogContent>
  )
}

function GitHubDetail() {
  const { data: status } = useSuspenseQuery(githubStatusQuery)
  const { data: repositories } = useSuspenseQuery(githubRepositoriesQuery)
  const { data: connector } = useSuspenseQuery({ ...connectorsQuery, select: githubConnector })
  const sync = useMutation({ mutationFn: syncGitHubConnectorRepositories })
  const isSyncing = sync.isPending
  const connected = Boolean(connector)
  const [repoSearch, setRepoSearch] = useState('')
  const installationID = typeof connector?.config.installation_id === 'string' ? connector.config.installation_id : ''
  const repositoryCount = repositories.length || (Array.isArray(connector?.config.repositories) ? connector.config.repositories.length : 0)
  const normalizedRepoSearch = repoSearch.trim().toLowerCase()
  const visibleRepositories = normalizedRepoSearch
    ? repositories.filter((repository) => `${repository.repository} ${repository.branch}`.toLowerCase().includes(normalizedRepoSearch))
    : repositories
  const items = [
    { label: 'App credentials', ok: status.app_configured },
    { label: 'Installation', ok: connected },
    { label: 'Build dispatch', ok: status.build_dispatch_enabled && connected },
    { label: 'Webhook', ok: status.webhook_configured },
  ]
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-prosights-text">Connection status</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-2">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 rounded-md border bg-prosights-surface px-3 py-2.5">
              {item.ok
                ? <Check className="size-3.5 text-success" />
                : <X className="size-3.5 text-danger" />
              }
              <span className="text-sm text-prosights-text">{item.label}</span>
            </div>
          ))}
        </div>
      </section>
      {connector && (
        <section className="rounded-md border bg-prosights-surface px-4 py-3">
          <div className="flex flex-wrap items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-prosights-text">GitHub App installation {installationID || connector.name}</p>
              <p className="mt-0.5 text-xs text-prosights-muted">{repositoryCount} {repositoryCount === 1 ? 'repository' : 'repositories'} available to Paddock.</p>
            </div>
            <Button variant="ghost" disabled={isSyncing} onClick={() => sync.mutate(connector.id)}>
              <RefreshCw className={`size-3.5 ${isSyncing ? 'animate-spin' : ''}`} />
              {isSyncing ? 'Refreshing...' : 'Refresh repository list'}
            </Button>
          </div>
          {sync.error && <p className="mt-2 text-sm text-danger">{sync.error.message}</p>}
          <details className="mt-3 rounded-md border bg-prosights-canvas">
            <summary className="cursor-pointer list-none px-3 py-2 text-sm font-medium text-prosights-text marker:content-none">
              <span className="flex items-center justify-between gap-3">
                <span>Available repositories</span>
                <ChevronRight className="size-4 text-prosights-muted" />
              </span>
            </summary>
            <div className="border-t p-3">
              <label className="relative block">
                <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-prosights-muted" />
                <input
                  value={repoSearch}
                  onChange={(event) => setRepoSearch(event.target.value)}
                  placeholder="Search repositories"
                  className="h-9 w-full rounded-md border bg-prosights-surface px-9 text-sm text-prosights-text outline-none placeholder:text-prosights-muted/70 focus-visible:ring-2 focus-visible:ring-prosights-text/15"
                />
              </label>
              <div className="mt-3 max-h-72 overflow-y-auto rounded-md border bg-prosights-surface">
                {visibleRepositories.length > 0 ? visibleRepositories.map((repository) => (
                  <a
                    key={`${repository.connector_id}:${repository.repository}:${repository.branch}`}
                    href={repository.web_url}
                    target="_blank"
                    rel="noopener noreferrer"
                    className="flex items-center justify-between gap-3 border-b px-3 py-2 last:border-b-0 hover:bg-prosights-surface-muted"
                  >
                    <span className="min-w-0">
                      <span className="block truncate text-sm font-medium text-prosights-text">{repository.repository}</span>
                      <span className="mt-0.5 flex items-center gap-1 text-xs text-prosights-muted"><GitBranch className="size-3" />{repository.branch}</span>
                    </span>
                    <ExternalLink className="size-3.5 shrink-0 text-prosights-muted" />
                  </a>
                )) : (
                  <div className="px-3 py-4 text-sm text-prosights-muted">{repoSearch ? 'No repositories match your search.' : 'No repositories synced yet.'}</div>
                )}
              </div>
            </div>
          </details>
        </section>
      )}
      {!connector && status.app_configured && (
        <section className="rounded-md border bg-prosights-surface px-4 py-3">
          <div>
            <p className="text-sm font-medium text-prosights-text">GitHub App is configured, but no installation is connected.</p>
            <p className="mt-0.5 text-xs text-prosights-muted">Install the app to grant repository access.</p>
          </div>
        </section>
      )}
      <section className="rounded-md border bg-prosights-surface px-4 py-3">
        <h3 className="text-sm font-semibold text-prosights-text">How push-to-deploy works</h3>
        <ol className="mt-2 space-y-1.5 text-sm text-prosights-muted">
          <li><span className="font-medium text-prosights-text">1.</span> GitHub sends a signed push event to <code className="font-mono text-xs text-prosights-text">/api/webhooks/github</code>.</li>
          <li><span className="font-medium text-prosights-text">2.</span> Paddock matches the repository, branch, changed path, and services with auto deploy enabled.</li>
          <li><span className="font-medium text-prosights-text">3.</span> GitHub Actions builds the image; its completion callback queues the deployment.</li>
        </ol>
      </section>
      {(status.missing?.length ?? 0) > 0 && (
        <div className="rounded-md border bg-prosights-surface px-4 py-3">
          <p className="text-sm font-medium text-prosights-text">Required server configuration</p>
          <p className="mt-1 font-mono text-xs text-prosights-muted">{status.missing.join(', ')}</p>
        </div>
      )}
      {!status.app_configured && !status.install_url && (
        <div className="rounded-md border px-4 py-3">
          <p className="text-sm font-medium text-prosights-text">GitHub App install link is not ready.</p>
          <p className="mt-1 text-sm text-prosights-muted">
            Set <code className="rounded bg-prosights-surface-muted px-1 font-mono text-xs">GITHUB_APP_SLUG</code> on the Paddock server to enable the one-click install button.
            Repository sync and build dispatch also need the app ID and private key.
          </p>
        </div>
      )}
      {status.app_configured && !connected && status.install_url && (
        <a
          href={status.install_url}
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-2 rounded-md bg-prosights-text px-4 py-2 text-sm font-medium text-prosights-surface hover:bg-prosights-text/80"
        >
          Install GitHub App
          <ExternalLink className="size-3.5" />
        </a>
      )}
    </div>
  )
}

function DopplerDetail() {
  const { data: status } = useSuspenseQuery(dopplerStatusQuery)
  const dopplerProjects = useQuery({ ...dopplerProjectsQuery, enabled: status.ready })
  const projects = dopplerProjects.data ?? []
  const isLoadingProjects = dopplerProjects.isFetching
  const projectsError = dopplerProjects.error?.message
  const [projectSearch, setProjectSearch] = useState('')
  const normalizedProjectSearch = projectSearch.trim().toLowerCase()
  const visibleProjects = normalizedProjectSearch ? projects.filter((project) => project.toLowerCase().includes(normalizedProjectSearch)) : projects
  const items = [
    { label: 'Connector configured', ok: status.connector_configured },
    { label: 'CLI available', ok: status.cli_available },
    { label: 'Deploy-time sync', ok: status.ready },
  ]
  return (
    <div className="space-y-5">
      <section>
        <h3 className="text-sm font-semibold text-prosights-text">Connection status</h3>
        <div className="mt-2 grid gap-2 sm:grid-cols-3">
          {items.map((item) => (
            <div key={item.label} className="flex items-center gap-2 rounded-md border bg-prosights-surface px-3 py-2.5">
              {item.ok
                ? <Check className="size-3.5 text-success" />
                : <X className="size-3.5 text-danger" />
              }
              <span className="text-sm text-prosights-text">{item.label}</span>
            </div>
          ))}
        </div>
      </section>
      <section className="rounded-md border bg-prosights-surface px-4 py-3">
        <h3 className="text-sm font-semibold text-prosights-text">Connected Doppler account</h3>
        <p className="mt-1 text-sm text-prosights-muted">The server authenticates to Doppler. Each Compose service chooses its own Doppler project and config in that service’s Variables tab. Secrets are downloaded only when a deployment runs and are never stored in Paddock.</p>
        <p className="mt-2 text-xs text-prosights-muted">{status.message}</p>
      </section>
      {(status.missing?.length ?? 0) > 0 && (
        <div className="rounded-md border border-warning/30 bg-warning/5 px-4 py-3">
          <p className="text-sm font-medium text-warning">Missing server-side configuration</p>
          <p className="mt-1 font-mono text-xs text-prosights-muted">{status.missing.join(', ')}</p>
        </div>
      )}
      {status.ready && (
        <section className="rounded-md border bg-prosights-surface px-4 py-3">
          <div className="flex items-center justify-between gap-3">
            <div>
              <p className="text-sm font-medium text-prosights-text">Available Doppler projects</p>
              <p className="mt-0.5 text-xs text-prosights-muted">{isLoadingProjects ? 'Loading projects…' : projectsError ? 'Project list could not be loaded.' : `${projects.length} ${projects.length === 1 ? 'project' : 'projects'} visible to this connector.`}</p>
            </div>
          </div>
          <label className="relative mt-3 block">
            <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-prosights-muted" />
            <input
              value={projectSearch}
              onChange={(event) => setProjectSearch(event.target.value)}
              placeholder="Search Doppler projects"
              className="h-9 w-full rounded-md border bg-prosights-canvas px-9 text-sm text-prosights-text outline-none placeholder:text-prosights-muted/70 focus-visible:ring-2 focus-visible:ring-prosights-text/15"
            />
          </label>
          <div className="mt-3 max-h-56 overflow-y-auto rounded-md border bg-prosights-canvas">
            {projectsError ? (
              <div className="px-3 py-4 text-sm text-danger">{projectsError}</div>
            ) : visibleProjects.length > 0 ? visibleProjects.map((project) => (
              <div key={project} className="border-b px-3 py-2 text-sm font-medium text-prosights-text last:border-b-0">{project}</div>
            )) : (
              <div className="px-3 py-4 text-sm text-prosights-muted">{isLoadingProjects ? 'Loading projects…' : projectSearch ? 'No projects match your search.' : 'No Doppler projects returned.'}</div>
            )}
          </div>
        </section>
      )}
    </div>
  )
}

const providerDefaultHosts: Record<ContainerRegistry['provider'], string> = {
  ghcr: 'ghcr.io',
  ecr: '',
  gcp_artifact_registry: 'us-docker.pkg.dev',
  docker_hub: 'docker.io',
  custom: '',
}

function RegistryDetail() {
  const { data: registries } = useSuspenseQuery(containerRegistriesQuery)
  const [name, setName] = useState('')
  const [provider, setProvider] = useState<ContainerRegistry['provider']>('ghcr')
  const [host, setHost] = useState('ghcr.io')
  const [namespace, setNamespace] = useState('')
  const [repository, setRepository] = useState('')
  const save = useMutation({
    mutationFn: () => {
      if (!name.trim() || !host.trim() || !repository.trim()) throw new Error('Name, host, and repository are required.')
      return upsertContainerRegistry({ name: name.trim(), provider, registry_host: host.trim(), namespace: namespace.trim(), repository: repository.trim(), enabled: true })
    },
    onSuccess: () => {
      setName('')
      setRepository('')
      setNamespace('')
    },
  })

  return (
    <div className="space-y-4">
      {registries.length > 0 && (
        <div className="space-y-2">
          {registries.map((r) => (
            <div key={r.id} className="flex items-center justify-between rounded-md border px-3 py-2">
              <div className="flex items-center gap-2">
                <Key className="size-3.5 text-prosights-muted" />
                <span className="text-sm font-medium text-prosights-text">{r.name}</span>
                <span className="font-mono text-xs text-prosights-muted">{r.registry_host}/{r.namespace || r.repository}</span>
              </div>
              <Badge tone={r.enabled ? 'success' : 'neutral'}>{r.enabled ? 'Active' : 'Disabled'}</Badge>
            </div>
          ))}
        </div>
      )}
      <form
        onSubmit={(event) => {
          event.preventDefault()
          save.mutate()
        }}
        className="space-y-3 rounded-md border bg-prosights-canvas p-4">
        <p className="text-sm font-medium text-prosights-text">Add registry</p>
        <div className="grid gap-3 sm:grid-cols-2">
          <TextInput label="Name" value={name} onChange={setName} placeholder="Production GHCR" />
          <SelectInput label="Provider" value={provider} onChange={(value) => {
            setProvider(value as ContainerRegistry['provider'])
            setHost(providerDefaultHosts[value as ContainerRegistry['provider']])
          }}>
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
        {save.error && <p className="text-sm text-danger">{save.error.message}</p>}
        <Button variant="primary" disabled={save.isPending || !name.trim() || !repository.trim()}>
          {save.isPending ? 'Saving...' : 'Add registry'}
        </Button>
      </form>
    </div>
  )
}

function SlackDetail() {
  return (
    <div className="space-y-4">
      <div className="rounded-md border bg-prosights-surface px-4 py-3">
        <p className="text-sm font-medium text-prosights-text">Deployment notifications live on the Notifications page.</p>
        <p className="mt-1 text-sm text-prosights-muted">Add the server-side Slack destination there, then choose which deployment events should be delivered.</p>
      </div>
      <div className="flex flex-wrap gap-2">
        <Button asChild variant="ghost"><Link to="/notifications">Open notifications</Link></Button>
        <a
          href="https://api.slack.com/messaging/webhooks"
          target="_blank"
          rel="noopener noreferrer"
          className="inline-flex items-center gap-1.5 px-2 text-sm font-medium text-prosights-muted hover:text-prosights-text"
        >
          Slack webhook docs
          <ExternalLink className="size-3" />
        </a>
      </div>
    </div>
  )
}
