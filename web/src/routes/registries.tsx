import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { Boxes, Check, Container, Link2 } from 'lucide-react'
import { useState } from 'react'
import { PageHeader } from '../components/page-header'
import { Badge } from '../components/ui/badge'
import { Button } from '../components/ui/button'
import { InlineError } from '../components/ui/error-message'
import { Panel } from '../components/ui/panel'
import { SelectInput } from '../components/ui/select-input'
import { TextInput } from '../components/ui/text-input'
import { updateProjectRegistry, upsertContainerRegistry, type ContainerRegistry, type Project, type UpsertContainerRegistryInput } from '../lib/api'
import { containerRegistriesQuery, projectsQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useUiStore } from '../store/ui'

type RegistryForm = {
  name: string
  provider: ContainerRegistry['provider']
  registry_host: string
  namespace: string
  repository: string
  default_image: string
  enabled: boolean
}

const defaultRegistryForm: RegistryForm = {
  name: '',
  provider: 'gcp_artifact_registry',
  registry_host: 'us-east1-docker.pkg.dev',
  namespace: 'prosights-platform',
  repository: '',
  default_image: '',
  enabled: true,
}

export function RegistriesRoute() {
  const queryClient = useQueryClient()
  const [{ data: registries }, { data: projects }] = useSuspenseQueries({
    queries: [containerRegistriesQuery, projectsQuery],
  })
  const searchQuery = useUiStore((state) => state.searchQuery)
  const [form, setForm] = useState<RegistryForm>(defaultRegistryForm)
  const [formError, setFormError] = useState<string>()
  const [assignmentError, setAssignmentError] = useState<string>()
  const visibleRegistries = registries.filter((registry) => matchesSearch(searchQuery, [
    registry.name,
    registry.provider,
    registry.registry_host,
    registry.namespace,
    registry.repository,
    registry.default_image,
    registry.enabled ? 'enabled' : 'disabled',
  ]))

  const saveRegistry = useMutation({
    mutationFn: () => upsertContainerRegistry(registryInput(form)),
    onSuccess: async () => {
      setForm(defaultRegistryForm)
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: containerRegistriesQuery.queryKey })
    },
  })
  const updateProject = useMutation({
    mutationFn: ({ projectID, registryID }: { projectID: string, registryID?: string }) => updateProjectRegistry(projectID, registryID),
    onSuccess: async () => {
      setAssignmentError(undefined)
      await Promise.all([
        queryClient.invalidateQueries({ queryKey: projectsQuery.queryKey }),
        queryClient.invalidateQueries({ queryKey: containerRegistriesQuery.queryKey }),
      ])
    },
  })

  return (
    <div className="space-y-5">
      <PageHeader title="Registries" description="Central Docker registry bases mapped to projects. Auth stays on the remote host or provider." />
      <div className="grid gap-5 xl:grid-cols-[minmax(360px,0.8fr)_1fr]">
        <RegistryFormPanel
          form={form}
          errorMessage={formError ?? saveRegistry.error?.message}
          isSaving={saveRegistry.isPending}
          onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
          onSubmit={() => {
            setFormError(undefined)
            try {
              validateRegistryForm(form)
            } catch (error) {
              setFormError(error instanceof Error ? error.message : 'Registry is invalid.')
              return
            }
            saveRegistry.mutate()
          }}
        />
        <ProjectRegistryPanel
          projects={projects}
          registries={registries}
          isSaving={updateProject.isPending}
          errorMessage={assignmentError ?? updateProject.error?.message}
          onAssign={(projectID, registryID) => {
            setAssignmentError(undefined)
            updateProject.mutate({ projectID, registryID })
          }}
        />
      </div>
      <RegistryList registries={visibleRegistries} />
    </div>
  )
}

function RegistryFormPanel({
  form,
  isSaving,
  errorMessage,
  onChange,
  onSubmit,
}: {
  form: RegistryForm
  isSaving: boolean
  errorMessage?: string
  onChange: (updates: Partial<RegistryForm>) => void
  onSubmit: () => void
}) {
  return (
    <Panel title="Add registry">
      <form
        className="grid gap-3 p-4 md:grid-cols-2"
        onSubmit={(event) => {
          event.preventDefault()
          onSubmit()
        }}
      >
        <TextInput label="Name" value={form.name} onChange={(name) => onChange({ name })} placeholder="workflow experiments" required />
        <SelectInput label="Provider" value={form.provider} onChange={(provider) => onChange({ provider: provider as RegistryForm['provider'] })}>
          <option value="gcp_artifact_registry">GCP Artifact Registry</option>
          <option value="docker_hub">Docker Hub</option>
          <option value="ghcr">GHCR</option>
          <option value="ecr">ECR</option>
          <option value="custom">Custom</option>
        </SelectInput>
        <TextInput label="Host" value={form.registry_host} onChange={(registry_host) => onChange({ registry_host })} placeholder="us-east1-docker.pkg.dev" required />
        <TextInput label="Namespace" value={form.namespace} onChange={(namespace) => onChange({ namespace })} placeholder="prosights-platform" />
        <TextInput label="Repository" value={form.repository} onChange={(repository) => onChange({ repository })} placeholder="experiments" required />
        <TextInput label="Default image" value={form.default_image} onChange={(default_image) => onChange({ default_image })} placeholder="workflows-server" />
        <SelectInput label="Enabled" value={form.enabled ? 'true' : 'false'} onChange={(value) => onChange({ enabled: value === 'true' })}>
          <option value="true">Enabled</option>
          <option value="false">Disabled</option>
        </SelectInput>
        <div className="flex items-end">
          <Button variant="primary" disabled={isSaving || !form.name || !form.registry_host || !form.repository}>
            <Container className="size-4" />
            {isSaving ? 'Saving...' : 'Save registry'}
          </Button>
        </div>
      </form>
      <div className="border-t px-4 py-3 text-sm text-muted">
        Example base: <span className="font-mono text-ink">{registryBasePath(form)}</span>
      </div>
      {errorMessage && <div className="border-t px-4 py-3"><InlineError message={errorMessage} /></div>}
    </Panel>
  )
}

function ProjectRegistryPanel({
  projects,
  registries,
  isSaving,
  errorMessage,
  onAssign,
}: {
  projects: Project[]
  registries: ContainerRegistry[]
  isSaving: boolean
  errorMessage?: string
  onAssign: (projectID: string, registryID?: string) => void
}) {
  const enabledRegistries = registries.filter((registry) => registry.enabled)
  return (
    <Panel title="Project defaults">
      <div className="divide-y">
        {projects.map((project) => (
          <div key={project.id} className="grid gap-3 p-4 md:grid-cols-[1fr_minmax(260px,0.8fr)_auto]">
            <div className="min-w-0">
              <div className="font-medium">{project.name}</div>
              <div className="mt-1 truncate text-sm text-muted">{project.description || project.slug}</div>
            </div>
            <SelectInput
              label="Artifact registry"
              value={project.default_registry_id ?? ''}
              onChange={(registryID) => onAssign(project.id, registryID || undefined)}
              disabled={enabledRegistries.length === 0}
            >
              <option value="">No default</option>
              {enabledRegistries.map((registry) => (
                <option key={registry.id} value={registry.id}>{registry.name}</option>
              ))}
            </SelectInput>
            <div className="flex items-end">
              <Badge tone={project.default_registry_id ? 'success' : 'neutral'}>
                {project.default_registry_name ?? 'manual'}
              </Badge>
            </div>
          </div>
        ))}
        {projects.length === 0 && <div className="p-4 text-sm text-muted">Create a project before assigning an artifact registry.</div>}
      </div>
      {errorMessage && <div className="border-t px-4 py-3"><InlineError message={errorMessage} /></div>}
      {isSaving && <div className="border-t px-4 py-3 text-sm text-muted">Saving project registry...</div>}
    </Panel>
  )
}

function RegistryList({ registries }: { registries: ContainerRegistry[] }) {
  return (
    <Panel title="Registry catalog">
      <div className="overflow-x-auto">
        <table className="w-full text-left text-sm">
          <thead className="text-xs text-muted">
            <tr>
              <th className="px-4 py-3 font-medium">Registry</th>
              <th className="px-4 py-3 font-medium">Provider</th>
              <th className="px-4 py-3 font-medium">Base path</th>
              <th className="px-4 py-3 font-medium">Default image</th>
              <th className="px-4 py-3 font-medium">Status</th>
            </tr>
          </thead>
          <tbody>
            {registries.map((registry) => (
              <tr key={registry.id} className="border-t">
                <td className="px-4 py-3">
                  <div className="flex items-center gap-2 font-medium">
                    <Boxes className="size-4 text-accent" />
                    {registry.name}
                  </div>
                </td>
                <td className="px-4 py-3 text-muted">{registry.provider}</td>
                <td className="px-4 py-3 font-mono text-xs text-muted">{registryBasePath(registry)}</td>
                <td className="px-4 py-3 text-muted">{registry.default_image || 'set per deploy'}</td>
                <td className="px-4 py-3">
                  <Badge tone={registry.enabled ? 'success' : 'neutral'}>
                    {registry.enabled ? <Check className="mr-1 size-3" /> : <Link2 className="mr-1 size-3" />}
                    {registry.enabled ? 'enabled' : 'disabled'}
                  </Badge>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {registries.length === 0 && <div className="border-t px-4 py-6 text-sm text-muted">No registries configured.</div>}
    </Panel>
  )
}

function registryInput(form: RegistryForm): UpsertContainerRegistryInput {
  return {
    name: form.name.trim(),
    provider: form.provider,
    registry_host: form.registry_host.trim(),
    namespace: cleanPathPart(form.namespace),
    repository: cleanPathPart(form.repository),
    default_image: cleanPathPart(form.default_image),
    enabled: form.enabled,
  }
}

function validateRegistryForm(form: RegistryForm): void {
  const input = registryInput(form)
  if (!input.name || !input.registry_host || !input.repository) {
    throw new Error('Name, host, and repository are required.')
  }
  if (/[\s/:]/.test(input.registry_host)) {
    throw new Error('Host must not include scheme, path, or whitespace.')
  }
  for (const value of [input.namespace, input.repository, input.default_image]) {
    if (value && (/[\s]/.test(value) || value.includes('//'))) {
      throw new Error('Namespace, repository, and default image cannot contain whitespace or empty path segments.')
    }
  }
}

function registryBasePath(registry: Pick<ContainerRegistry, 'registry_host' | 'namespace' | 'repository'> | RegistryForm): string {
  return [registry.registry_host.trim(), cleanPathPart(registry.namespace), cleanPathPart(registry.repository)].filter(Boolean).join('/')
}

function cleanPathPart(value: string): string {
  return value.trim().replace(/^\/+|\/+$/g, '')
}
