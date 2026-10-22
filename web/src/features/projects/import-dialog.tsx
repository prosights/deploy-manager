import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { Link } from '@tanstack/react-router'
import { Check, ChevronDown, Container, Github, RefreshCw, Search } from 'lucide-react'
import { useState } from 'react'
import { Badge } from '../../components/ui/badge'
import { Button } from '../../components/ui/button'
import { Dialog, DialogBody, DialogClose, DialogContent, DialogHeader } from '../../components/ui/dialog'
import { DropdownMenu, DropdownMenuContent, DropdownMenuItem, DropdownMenuSeparator, DropdownMenuTrigger } from '../../components/ui/dropdown-menu'
import { InlineError } from '../../components/ui/error-message'
import { SelectInput } from '../../components/ui/select-input'
import { TextInput } from '../../components/ui/text-input'
import { importGitHubRepositoryServices, type GitHubDetectedService, type GitHubRepository } from '../../lib/api'
import { cn } from '../../lib/cn'
import { optionalTrimmed } from '../../lib/format'
import { environmentsQuery, githubBranchesQuery, githubComposeServicesQuery, githubRepositoriesQuery, githubStatusQuery, serversQuery } from '../../lib/queries'
import { validateGitBranch, validateRepositoryRoot } from '../../lib/validation'
import { environmentOrder } from '../applications/helpers'

// The repository, branch, and root a scan ran with.
type ScanRequest = { connectorID: string, repository: string, branch: string, root: string }

export function AddServiceDialog({
  projectID,
  defaultEnvironmentID,
  open,
  onOpenChange,
}: {
  projectID: string
  defaultEnvironmentID: string
  open: boolean
  onOpenChange: (open: boolean) => void
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent size="md">
        <DialogHeader
          title="Add service"
          description="Import from GitHub. Paddock discovers the compose file inside the repo."
          closeLabel="Close add service"
        />
        <DialogBody className="space-y-5 bg-prosights-surface">
          <GitHubServiceImportForm projectID={projectID} defaultEnvironmentID={defaultEnvironmentID} onCreated={() => onOpenChange(false)} />
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function GitHubServiceImportForm({ projectID, defaultEnvironmentID, onCreated }: { projectID: string, defaultEnvironmentID: string, onCreated: () => void }) {
  const { data: githubStatus } = useSuspenseQuery(githubStatusQuery)
  const { data: repositories } = useSuspenseQuery({ ...githubRepositoriesQuery, select: uniqueRepositories })
  const { data: environments } = useSuspenseQuery({
    ...environmentsQuery,
    select: (items) => environmentOrder(items.filter((environment) => environment.project_id === projectID)),
  })
  const { data: servers } = useSuspenseQuery(serversQuery)
  const [repositoryKey, setRepositoryKey] = useState(() => repositories[0] ? githubRepositoryKey(repositories[0]) : '')
  const [branch, setBranch] = useState(() => repositories[0]?.branch ?? 'main')
  const [root, setRoot] = useState('')
  const [environmentID, setEnvironmentID] = useState(defaultEnvironmentID || environments[0]?.id || '')
  const [serverID, setServerID] = useState(servers[0]?.id || '')
  const [scanRequest, setScanRequest] = useState<ScanRequest>()
  // Services the user unticked or re-ticked; everything detected starts selected.
  const [serviceToggles, setServiceToggles] = useState<Record<string, boolean>>({})
  const repository = repositories.find((item) => githubRepositoryKey(item) === repositoryKey)
  const currentRequest: ScanRequest | undefined = repository
    ? { connectorID: repository.connector_id, repository: repository.repository, branch, root: optionalTrimmed(root) ?? '' }
    : undefined
  const scanIsCurrent = Boolean(scanRequest && currentRequest && sameScan(scanRequest, currentRequest))
  const scanInvalid = scanRequest ? scanValidationError(scanRequest) : undefined

  const branches = useQuery({
    ...githubBranchesQuery(repository?.connector_id ?? '', repository?.repository ?? ''),
    enabled: Boolean(repository),
  })
  const scan = useQuery({
    ...githubComposeServicesQuery(scanRequest?.connectorID ?? '', scanRequest?.repository ?? '', scanRequest?.branch ?? '', scanRequest?.root ?? ''),
    enabled: Boolean(scanRequest) && !scanInvalid,
  })
  const scanning = scanIsCurrent && scan.isFetching
  const detected = scanIsCurrent ? scan.data?.services : undefined
  const selectedServices = (detected ?? []).filter((service) => serviceToggles[service.name] ?? true).map((service) => service.name)
  const importLabel = selectedServices.length === 1 ? selectedServices[0] : `${selectedServices.length} services`
  const scanError = scanIsCurrent ? (scanInvalid ?? scan.error?.message) : undefined

  const importServices = useMutation({
    mutationFn: () => {
      if (!repository) throw new Error('Select a connected GitHub repository.')
      if (!environmentID || !serverID || selectedServices.length === 0) throw new Error('Select an environment, server, and at least one service.')
      validateGitBranch(branch)
      validateRepositoryRoot(root)
      return importGitHubRepositoryServices(projectID, {
        connector_id: repository.connector_id,
        repository: repository.repository,
        branch,
        root: optionalTrimmed(root),
        environment_id: environmentID,
        server_id: serverID,
        services: selectedServices,
        detected_services: detected ?? [],
      })
    },
    onSuccess: onCreated,
  })

  function changeRepository(value: string) {
    const selected = repositories.find((item) => githubRepositoryKey(item) === value)
    setRepositoryKey(value)
    setBranch(selected?.branch ?? 'main')
    setRoot('')
  }

  function startScan() {
    if (!currentRequest) return
    setServiceToggles({})
    if (scanIsCurrent) void scan.refetch()
    else setScanRequest(currentRequest)
  }

  return (
    <>
      <div><h2 className="text-[14px] font-semibold text-prosights-text">Import from GitHub</h2><p className="mt-1 text-[11px] text-prosights-muted">Pick a repo, branch, and optional root. Paddock scans for compose files, then you choose what to import.</p></div>

      {!githubStatus.app_configured
        ? (
            <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted p-5 text-center">
              <Github className="mx-auto size-5 text-prosights-muted" />
              <h3 className="mt-3 text-[13px] font-semibold text-prosights-text">Configure the GitHub App</h3>
              <p className="mt-1 text-[11px] leading-5 text-prosights-muted">Repository scanning needs the GitHub App credentials in this Paddock environment.</p>
              <Button asChild className="mt-4"><Link to="/connectors">Open integrations</Link></Button>
            </div>
          )
        : repositories.length === 0
        ? (
            <div className="rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted p-5 text-center">
              <Github className="mx-auto size-5 text-prosights-muted" />
              <h3 className="mt-3 text-[13px] font-semibold text-prosights-text">Connect GitHub first</h3>
              <p className="mt-1 text-[11px] text-prosights-muted">Install or configure the GitHub connector, then return here to import services.</p>
              <Button asChild className="mt-4"><Link to="/connectors">Open connectors</Link></Button>
            </div>
          )
        : (
            <>
              <div className="grid gap-4 sm:grid-cols-2">
                <SearchablePicker label="Repository" value={repositoryKey} options={repositories.map((item) => ({ value: githubRepositoryKey(item), label: item.repository }))} onChange={changeRepository} searchPlaceholder="Search repositories" emptyText="No repositories found" disabled={importServices.isPending} />
                <SearchablePicker label="Branch" value={branch} options={(branches.data?.branches ?? []).map((item) => ({ value: item, label: item }))} onChange={setBranch} searchPlaceholder="Search branches" emptyText="No branches found" loading={branches.isFetching} disabled={!repository || importServices.isPending} />
                <div className="sm:col-span-2"><TextInput label="Root directory (optional)" value={root} disabled={importServices.isPending} onChange={setRoot} placeholder="apps/alleyes" /></div>
                <SelectInput label="Environment" value={environmentID} disabled={importServices.isPending} onChange={setEnvironmentID}>{environments.map((environment) => <option key={environment.id} value={environment.id}>{environment.name}</option>)}</SelectInput>
                <SelectInput label="Server" value={serverID} disabled={importServices.isPending} onChange={setServerID}>{servers.map((server) => <option key={server.id} value={server.id}>{server.name}</option>)}</SelectInput>
                <div className="sm:col-span-2 flex justify-end"><Button type="button" variant="primary" disabled={scanning || importServices.isPending || branches.isFetching || !repository || !branch.trim()} onClick={startScan}>{scanning ? <RefreshCw className="size-4 animate-spin" /> : <Search className="size-4" />}{scanning ? 'Scanning…' : 'Scan repository'}</Button></div>
              </div>

              {scanning && <div className="animate-pulse rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted px-4 py-8 text-center text-[12px] text-prosights-muted">Scanning {repository?.repository}#{branch}{root.trim() ? `/${root.trim()}` : ''} for compose services…</div>}

              {detected && !scanning && (
                <section className="overflow-hidden rounded-prosights-lg border border-prosights-border bg-prosights-surface">
                  <div className="border-b border-prosights-border px-4 py-3"><h3 className="text-[12px] font-semibold text-prosights-text">Deployable services</h3><p className="mt-0.5 text-[11px] text-prosights-muted">Each selected compose target becomes one service with its own deployment history.</p></div>
                  {detected.length > 0
                    ? (
                        <div className="divide-y divide-prosights-border">
                          {detected.map((service) => (
                            <div key={service.name} className="px-4 py-3 transition-colors hover:bg-prosights-surface-muted">
                              <label className="flex cursor-pointer items-center gap-3">
                                <input
                                  type="checkbox"
                                  className="size-4 accent-black"
                                  disabled={importServices.isPending}
                                  checked={selectedServices.includes(service.name)}
                                  onChange={(event) => setServiceToggles({ ...serviceToggles, [service.name]: event.target.checked })}
                                />
                                <span className="flex size-8 items-center justify-center rounded-prosights-md border border-prosights-border bg-prosights-surface-muted text-prosights-muted"><Container className="size-4" /></span>
                                <span className="min-w-0 flex-1"><span className="block truncate text-[12px] font-medium text-prosights-text">{service.name}</span><span className="mt-0.5 block truncate font-mono text-[10px] text-prosights-muted">{service.compose_path}</span></span>
                              </label>
                              <DetectedStackPreview service={service} />
                            </div>
                          ))}
                        </div>
                      )
                    : <div className="px-5 py-10 text-center text-[12px] text-prosights-muted">No compose services found. Add a compose file beside the app, then scan again.</div>}
                </section>
              )}

              {importServices.isPending && (
                <div aria-live="polite" className="rounded-prosights-lg border border-prosights-border bg-prosights-surface-muted px-4 py-3 text-[12px] text-prosights-muted">
                  <div className="flex items-center gap-2 font-medium text-prosights-text">
                    <RefreshCw className="size-4 animate-spin" />
                    Importing {importLabel}
                  </div>
                  <p className="mt-1 leading-5">Creating service configuration from {repository?.repository}#{branch}. This is not deploying yet.</p>
                </div>
              )}

              {(branches.error || scanError || importServices.error) && <InlineError message={branches.error?.message ?? scanError ?? importServices.error?.message ?? 'GitHub import failed.'} />}
              <div className="flex items-center justify-end gap-2 border-t border-prosights-border pt-4">
                <DialogClose asChild><Button type="button" disabled={importServices.isPending}>Cancel</Button></DialogClose>
                <Button type="button" variant="primary" disabled={!detected || scanning || selectedServices.length === 0 || importServices.isPending} onClick={() => importServices.mutate()}>{importServices.isPending ? 'Importing…' : `Import ${selectedServices.length || ''} service${selectedServices.length === 1 ? '' : 's'}`}</Button>
              </div>
            </>
          )}
    </>
  )
}

function SearchablePicker({
  label,
  value,
  options,
  onChange,
  searchPlaceholder,
  emptyText,
  loading = false,
  disabled = false,
}: {
  label: string
  value: string
  options: Array<{ value: string, label: string }>
  onChange: (value: string) => void
  searchPlaceholder: string
  emptyText: string
  loading?: boolean
  disabled?: boolean
}) {
  const [search, setSearch] = useState('')
  const selected = options.find((option) => option.value === value)
  const normalizedSearch = search.trim().toLowerCase()
  const filtered = normalizedSearch ? options.filter((option) => option.label.toLowerCase().includes(normalizedSearch)) : options

  return (
    <div className="text-xs text-prosights-muted">
      <span className="mb-1 block">{label}</span>
      <DropdownMenu onOpenChange={(open) => { if (!open) setSearch('') }}>
        <DropdownMenuTrigger asChild>
          <button type="button" disabled={disabled} aria-label={`${label}: ${selected?.label || value || 'Select'}`} className="flex h-9 w-full items-center justify-between gap-2 rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-left text-[13px] text-prosights-text shadow-xs outline-none transition-colors hover:bg-prosights-surface-muted disabled:cursor-not-allowed disabled:opacity-50">
            <span className="truncate">{selected?.label || value || 'Select'}</span><ChevronDown className="size-4 shrink-0 text-prosights-muted" />
          </button>
        </DropdownMenuTrigger>
        <DropdownMenuContent align="start" className="w-[var(--radix-dropdown-menu-trigger-width)]">
          <div className="p-1" onKeyDown={(event) => event.stopPropagation()}><TextInput label={`Search ${label.toLowerCase()}`} value={search} onChange={setSearch} placeholder={searchPlaceholder} /></div>
          <DropdownMenuSeparator />
          <div className="max-h-56 overflow-y-auto">
            {loading
              ? <div className="flex items-center gap-2 px-2 py-3 text-[12px] text-prosights-muted"><RefreshCw className="size-3.5 animate-spin" /> Loading…</div>
              : filtered.length > 0
                ? filtered.map((option) => <DropdownMenuItem key={option.value} className="cursor-pointer" onSelect={() => onChange(option.value)}>{option.value === value && <Check className="size-4" />}<span className={cn('truncate', option.value !== value && 'pl-6')}>{option.label}</span></DropdownMenuItem>)
                : <div className="px-2 py-3 text-[12px] text-prosights-muted">{emptyText}</div>}
          </div>
        </DropdownMenuContent>
      </DropdownMenu>
    </div>
  )
}

function DetectedStackPreview({ service }: { service: GitHubDetectedService }) {
  const composeServices = service.compose_services ?? []
  if (composeServices.length === 0) {
    return <p className="ml-11 mt-2 text-[10px] text-prosights-muted">Compose file found. Container details will be resolved when imported.</p>
  }
  return (
    <div className="ml-11 mt-2 grid gap-1.5">
      {composeServices.map((item) => (
        <div key={item.name} className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 rounded-prosights-md border border-prosights-border bg-prosights-surface px-2.5 py-2 text-[10px]">
          <span className="font-semibold text-prosights-text">{item.name}</span>
          {item.image && <span className="truncate font-mono text-prosights-muted">{item.image}</span>}
          {(item.ports ?? []).map((port) => <Badge key={`${port.container_port}/${port.protocol ?? 'tcp'}`} tone="neutral">:{port.container_port}/{port.protocol ?? 'tcp'}</Badge>)}
          {(item.depends_on ?? []).length > 0 && <span className="text-prosights-muted">depends on {(item.depends_on ?? []).join(', ')}</span>}
        </div>
      ))}
    </div>
  )
}

function sameScan(a: ScanRequest, b: ScanRequest): boolean {
  return a.connectorID === b.connectorID && a.repository === b.repository && a.branch === b.branch && a.root === b.root
}

function scanValidationError(request: ScanRequest): string | undefined {
  try {
    validateGitBranch(request.branch)
    validateRepositoryRoot(request.root)
    return undefined
  } catch (error) {
    return error instanceof Error ? error.message : 'Scan settings are invalid.'
  }
}

function uniqueRepositories(repositories: GitHubRepository[]): GitHubRepository[] {
  const seen = new Set<string>()
  return repositories.filter((repository) => {
    const key = githubRepositoryKey(repository)
    if (seen.has(key)) return false
    seen.add(key)
    return true
  })
}

function githubRepositoryKey(repository: GitHubRepository): string {
  return `${repository.connector_id}:${repository.repository}`
}
