import { useMutation, useQuery, useSuspenseQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { CircleAlert, Container, Plus, RefreshCw, RotateCcw, Settings, Trash2 } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../../components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTrigger } from '../../components/ui/dialog'
import { InlineError } from '../../components/ui/error-message'
import { SelectInput } from '../../components/ui/select-input'
import { Tabs } from '../../components/ui/tabs'
import { TextInput } from '../../components/ui/text-input'
import {
  createEnvironment,
  deleteEnvironment,
  deleteProject,
  redeployProjectConfiguration,
  replaceProjectRuntimeVariables,
  updateProject,
  updateProjectRegistry,
  type Project,
  type ProjectRuntimeVariable,
} from '../../lib/api'
import { slugify } from '../../lib/format'
import { applicationsQuery, containerRegistriesQuery, environmentsQuery, projectVariablesQuery } from '../../lib/queries'
import { SettingsSection } from '../applications/drawer'
import { environmentOrder, normalizeProjectRuntimeVariables } from '../applications/helpers'

const settingsTabs = [
  { id: 'general', label: 'General' },
  { id: 'environments', label: 'Environments' },
  { id: 'variables', label: 'Shared variables' },
  { id: 'deploy', label: 'Deploy defaults' },
] as const

type SettingsTab = typeof settingsTabs[number]['id']

export function ProjectSettingsDialog({ project }: { project: Project }) {
  const [tab, setTab] = useState<SettingsTab>('general')
  return (
    <Dialog>
      <DialogTrigger asChild>
        <Button type="button" size="icon" className="size-8" aria-label="Project settings">
          <Settings className="size-4" aria-hidden="true" />
        </Button>
      </DialogTrigger>
      <DialogContent size="lg" className="h-[min(82svh,760px)]">
        <DialogHeader title="Project settings" description={`Settings shared by every service in ${project.name}.`} closeLabel="Close project settings">
          <Tabs tabs={settingsTabs} active={tab} label="Sections" onSelect={setTab} />
        </DialogHeader>
        <DialogBody>
          {tab === 'general'
            ? <ProjectGeneralSettings project={project} />
            : tab === 'environments'
              ? <ProjectEnvironmentsSettings projectID={project.id} />
              : tab === 'variables'
                ? <ProjectVariablesSettings projectID={project.id} />
                : <ProjectDeployDefaults project={project} />}
        </DialogBody>
      </DialogContent>
    </Dialog>
  )
}

function useProjectApplications(projectID: string) {
  return useSuspenseQuery({
    ...applicationsQuery,
    select: (applications) => applications.filter((application) => application.project_id === projectID),
  }).data
}

function ProjectGeneralSettings({ project }: { project: Project }) {
  const navigate = useNavigate()
  const applications = useProjectApplications(project.id)
  const [name, setName] = useState(project.name)
  const [slug, setSlug] = useState(project.slug)
  const [description, setDescription] = useState(project.description)
  const [deleteConfirmation, setDeleteConfirmation] = useState('')
  const save = useMutation({ mutationFn: () => updateProject(project.id, { name: name.trim(), slug: slugify(slug), description: description.trim() }) })
  const remove = useMutation({ mutationFn: () => deleteProject(project.id), onSuccess: () => navigate({ to: '/projects' }) })
  return (
    <div className="space-y-5">
      <SettingsSection title="General" description="Project identity shown across the workspace.">
        <form className="grid gap-4 sm:grid-cols-2" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
          <TextInput label="Project name" value={name} onChange={setName} required />
          <TextInput label="Slug" value={slug} onChange={setSlug} required />
          <div className="sm:col-span-2"><TextInput label="Description" value={description} onChange={setDescription} /></div>
          <div className="sm:col-span-2 flex justify-end"><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save project'}</Button></div>
        </form>
        {save.error && <div className="mt-3"><InlineError message={save.error.message} /></div>}
      </SettingsSection>
      <section className="overflow-hidden rounded-prosights-lg border border-danger/35 bg-prosights-surface">
        <div className="border-b border-danger/20 bg-danger/[0.06] px-4 py-3">
          <div className="flex items-start gap-2.5">
            <CircleAlert className="mt-0.5 size-4 shrink-0 text-danger" aria-hidden="true" />
            <div>
              <h2 className="text-[13px] font-semibold text-danger">Delete project</h2>
              <p className="mt-0.5 text-[11px] leading-4 text-prosights-muted">This permanently removes the project, its environments, deployment history, domains, and every service below.</p>
            </div>
          </div>
        </div>
        <div className="space-y-4 p-4">
          <div className="overflow-hidden rounded-prosights-md border border-danger/25 bg-danger/[0.04]">
            <div className="flex items-center justify-between gap-3 border-b border-danger/15 px-3 py-2.5">
              <span className="text-[12px] font-semibold text-prosights-text">Services that will be deleted</span>
              <span className="rounded-full bg-danger/15 px-2 py-0.5 text-[11px] font-medium text-danger">{applications.length}</span>
            </div>
            {applications.length > 0
              ? (
                  <ul aria-label="Services that will be deleted" className="max-h-44 divide-y divide-danger/15 overflow-auto">
                    {applications.map((application) => (
                      <li key={application.id} className="flex items-center gap-3 px-3 py-2.5">
                        <div className="flex size-8 shrink-0 items-center justify-center rounded-prosights-md border border-danger/20 bg-danger/[0.07] text-danger"><Container className="size-4" aria-hidden="true" /></div>
                        <div className="min-w-0 flex-1">
                          <div className="truncate text-[12px] font-medium text-prosights-text">{application.name}</div>
                          <div className="mt-0.5 truncate text-[11px] text-prosights-muted">{application.environment_name} · {application.status}</div>
                        </div>
                        {application.domain ? <div className="hidden max-w-64 truncate font-mono text-[10px] text-prosights-muted sm:block">{application.domain}</div> : null}
                      </li>
                    ))}
                  </ul>
                )
              : <p className="px-3 py-3 text-[11px] text-prosights-muted">This project has no services.</p>}
          </div>
          <div className="grid gap-3 sm:grid-cols-[minmax(0,1fr)_auto] sm:items-end">
            <TextInput label={`Type ${project.name} to confirm`} value={deleteConfirmation} onChange={setDeleteConfirmation} placeholder={project.name} />
            <Button className="transition-[background-color,transform] duration-150 active:scale-[0.98] !bg-danger hover:!bg-danger/85" type="button" disabled={deleteConfirmation !== project.name || remove.isPending} onClick={() => remove.mutate()}><Trash2 className="size-4" /> {remove.isPending ? 'Deleting…' : 'Delete project'}</Button>
          </div>
          <p className="text-[11px] font-medium text-danger">This action cannot be undone.</p>
          {remove.error && <InlineError message={remove.error.message} />}
        </div>
      </section>
    </div>
  )
}

function ProjectEnvironmentsSettings({ projectID }: { projectID: string }) {
  const { data: environments } = useSuspenseQuery({
    ...environmentsQuery,
    select: (items) => environmentOrder(items.filter((environment) => environment.project_id === projectID)),
  })
  const applications = useProjectApplications(projectID)
  const [name, setName] = useState('')
  const [confirmDeleteID, setConfirmDeleteID] = useState('')
  const create = useMutation({ mutationFn: () => createEnvironment({ project_id: projectID, name: name.trim(), slug: slugify(name), kind: 'development', is_ephemeral: false }), onSuccess: () => setName('') })
  const remove = useMutation({ mutationFn: (environmentID: string) => deleteEnvironment(environmentID), onSuccess: () => setConfirmDeleteID('') })
  return (
    <SettingsSection title="Environments" description="Production is created automatically. Add another named environment when you need a separate deployment scope.">
      <div className="space-y-3">
        {environments.map((environment) => {
          const serviceCount = applications.filter((application) => application.environment_id === environment.id).length
          const blockedReason = environment.kind === 'production' ? 'Default environment' : serviceCount > 0 ? `Remove ${serviceCount} service${serviceCount === 1 ? '' : 's'} first` : ''
          const serviceLabel = `${serviceCount} service${serviceCount === 1 ? '' : 's'}`
          return (
            <div key={environment.id} className="flex items-center justify-between gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted px-3 py-2.5">
              <div><div className="text-[13px] font-medium text-prosights-text">{environment.name}</div><div className="mt-0.5 text-[11px] text-prosights-muted">{environment.kind === 'production' ? `Default · ${serviceLabel}` : serviceLabel}</div></div>
              {confirmDeleteID === environment.id
                ? <div className="flex items-center gap-2"><span className="text-[11px] text-prosights-muted">Delete?</span><Button type="button" onClick={() => setConfirmDeleteID('')}>Cancel</Button><Button type="button" disabled={remove.isPending} onClick={() => remove.mutate(environment.id)}>{remove.isPending ? 'Deleting…' : 'Confirm'}</Button></div>
                : <Button type="button" aria-label={`Delete environment ${environment.name}`} title={blockedReason || undefined} disabled={remove.isPending || Boolean(blockedReason)} onClick={() => setConfirmDeleteID(environment.id)}><Trash2 className="size-4" /></Button>}
            </div>
          )
        })}
        <form className="grid gap-3 border-t border-prosights-border pt-4 sm:grid-cols-[1fr_auto]" onSubmit={(event) => { event.preventDefault(); if (name.trim()) create.mutate() }}><TextInput label="Environment name" value={name} onChange={setName} placeholder="Staging" /><div className="flex items-end"><Button variant="primary" disabled={!name.trim() || create.isPending}>{create.isPending ? <RefreshCw className="size-4 animate-spin" /> : <Plus className="size-4" />}{create.isPending ? 'Adding…' : 'Add environment'}</Button></div></form>
        {(create.error || remove.error) && <InlineError message={create.error?.message ?? remove.error?.message ?? 'Environment action failed.'} />}
      </div>
    </SettingsSection>
  )
}

function ProjectVariablesSettings({ projectID }: { projectID: string }) {
  const variables = useQuery(projectVariablesQuery(projectID))

  if (variables.isPending) {
    return <SettingsSection title="Shared variables" description="Non-secret values injected into every service in this project."><div className="flex items-center gap-2 text-[12px] text-prosights-muted"><RefreshCw className="size-4 animate-spin" /> Loading variables…</div></SettingsSection>
  }
  if (variables.error) {
    return <SettingsSection title="Shared variables" description="Non-secret values injected into every service in this project."><InlineError message={variables.error.message} /></SettingsSection>
  }
  return <ProjectVariablesForm key={variables.data.configuration_revision} projectID={projectID} initialVariables={variables.data.variables} />
}

function ProjectVariablesForm({ projectID, initialVariables }: { projectID: string, initialVariables: ProjectRuntimeVariable[] }) {
  const applications = useProjectApplications(projectID)
  const [variables, setVariables] = useState(() => initialVariables.map((variable) => ({ key: variable.key, value: variable.value })))
  const staleApplications = applications.filter((application) => application.redeploy_required)
  const save = useMutation({ mutationFn: () => replaceProjectRuntimeVariables(projectID, normalizeProjectRuntimeVariables(variables)) })
  const redeploy = useMutation({ mutationFn: () => redeployProjectConfiguration(projectID) })

  return (
    <div className="space-y-5">
      {staleApplications.length > 0 && (
        <section className="flex flex-col gap-3 rounded-prosights-lg border border-warning/40 bg-warning/5 px-4 py-3 sm:flex-row sm:items-center sm:justify-between">
          <div className="flex items-start gap-2.5"><CircleAlert className="mt-0.5 size-4 shrink-0 text-warning" /><div><div className="text-[12px] font-semibold text-prosights-text">{staleApplications.length} service{staleApplications.length === 1 ? '' : 's'} need redeploying</div><p className="mt-0.5 text-[11px] text-prosights-muted">Queue each stale service with its currently active source or image.</p></div></div>
          <Button type="button" disabled={redeploy.isPending} onClick={() => redeploy.mutate()}>{redeploy.isPending ? <RefreshCw className="size-4 animate-spin" /> : <RotateCcw className="size-4" />}{redeploy.isPending ? 'Queuing…' : 'Redeploy all'}</Button>
        </section>
      )}
      <SettingsSection title="Shared variables" description="Non-secret values injected into every service in this project at deploy time.">
        <form className="space-y-3" onSubmit={(event) => { event.preventDefault(); save.mutate() }}>
          {variables.length > 0
            ? variables.map((variable, index) => (
                <div key={index} className="grid gap-3 rounded-prosights-md border border-prosights-border bg-prosights-surface-muted p-3 sm:grid-cols-[minmax(0,0.7fr)_minmax(0,1fr)_auto] sm:items-end">
                  <TextInput label="Key" value={variable.key} onChange={(key) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, key } : item))} placeholder="PUBLIC_API_URL" />
                  <TextInput label="Value" value={variable.value} onChange={(value) => setVariables((current) => current.map((item, itemIndex) => itemIndex === index ? { ...item, value } : item))} placeholder="https://api.internal" />
                  <Button type="button" size="icon" aria-label={`Remove variable ${variable.key || index + 1}`} onClick={() => setVariables((current) => current.filter((_, itemIndex) => itemIndex !== index))}><Trash2 className="size-4" /></Button>
                </div>
              ))
            : <div className="rounded-prosights-md border border-dashed border-prosights-border px-4 py-6 text-center text-[12px] text-prosights-muted">No shared variables yet.</div>}
          <div className="flex flex-col gap-3 border-t border-prosights-border pt-4 sm:flex-row sm:items-center sm:justify-between">
            <p className="text-[11px] leading-4 text-prosights-muted">Values are stored as plain text. Keep credentials and other secrets in Doppler.</p>
            <div className="flex gap-2"><Button type="button" onClick={() => setVariables((current) => [...current, { key: '', value: '' }])}><Plus className="size-4" /> Add variable</Button><Button variant="primary" disabled={save.isPending}>{save.isPending ? 'Saving…' : 'Save variables'}</Button></div>
          </div>
        </form>
        {(save.error || redeploy.error) && <div className="mt-3"><InlineError message={save.error?.message ?? redeploy.error?.message ?? 'Variable action failed.'} /></div>}
      </SettingsSection>
    </div>
  )
}

function ProjectDeployDefaults({ project }: { project: Project }) {
  const { data: registries } = useSuspenseQuery({ ...containerRegistriesQuery, select: (items) => items.filter((registry) => registry.enabled) })
  const [registryID, setRegistryID] = useState(project.default_registry_id ?? '')
  const save = useMutation({ mutationFn: () => updateProjectRegistry(project.id, registryID || undefined) })
  return (
    <SettingsSection title="Default registry" description="Used when a service does not define its own artifact source.">
      <div className="grid gap-3 sm:grid-cols-[1fr_auto]"><SelectInput label="Container registry" value={registryID} onChange={setRegistryID}><option value="">No default registry</option>{registries.map((registry) => <option key={registry.id} value={registry.id}>{registry.name}</option>)}</SelectInput><div className="flex items-end"><Button variant="primary" disabled={save.isPending} onClick={() => save.mutate()}>Save default</Button></div></div>
      {save.error && <div className="mt-3"><InlineError message={save.error.message} /></div>}
    </SettingsSection>
  )
}
