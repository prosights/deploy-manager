import { useMutation, useQueryClient, useSuspenseQueries } from '@tanstack/react-query'
import { useState } from 'react'
import { PageHeader } from '../components/page-header'
import { ApplicationCreatePanel, ApplicationList, defaultApplicationForm, type ApplicationFormState } from '../features/applications/components'
import { createApplication, type CreateApplicationInput } from '../lib/api'
import { validateDomain } from '../lib/domains'
import { applicationsQuery, environmentsQuery, serversQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { validateHealthCheckURL } from '../lib/urls'
import { useUiStore } from '../store/ui'

export function ApplicationsRoute() {
  const queryClient = useQueryClient()
  const [{ data: applications }, { data: servers }, { data: environments }] = useSuspenseQueries({
    queries: [applicationsQuery, serversQuery, environmentsQuery],
  })
  const searchQuery = useUiStore((state) => state.searchQuery)
  const [form, setForm] = useState(defaultApplicationForm(servers[0]?.id, environments[0]?.id))
  const [formError, setFormError] = useState<string>()
  const visibleApplications = applications.filter((application) => matchesSearch(searchQuery, [
    application.name,
    application.project_name,
    application.environment_name,
    application.environment_kind,
    application.server_name,
    application.repository_url,
    application.branch,
    application.compose_path,
    application.remote_directory,
    application.domain,
    application.health_check_url,
    application.doppler_project,
    application.doppler_config,
    application.status,
    application.current_version,
    application.target_version,
  ]))
  const create = useMutation({
    mutationFn: () => createApplication(applicationInput(form)),
    onSuccess: async () => {
      setForm((state) => defaultApplicationForm(state.server_id, state.environment_id))
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: applicationsQuery.queryKey })
    },
  })

  function submitApplication() {
    setFormError(undefined)
    try {
      validateRequiredSelection(form.environment_id, 'Environment')
      validateRequiredSelection(form.server_id, 'Server')
      validateRemoteDirectory(form.remote_directory)
      validateGitBranch(form.branch)
      validateComposePath(form.compose_path)
      validateRepositoryURL(form.repository_url)
      validateOptionalDomain(form.domain)
      validateHealthCheckURL(form.health_check_url)
      validateDopplerScope(form.doppler_project, form.doppler_config)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Application target is invalid.')
      return
    }
    create.mutate()
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Applications" description="Docker Compose targets mapped to servers, domains, branches, and deployment state." />
      <ApplicationCreatePanel
        form={form}
        servers={servers}
        environments={environments}
        isSaving={create.isPending}
        errorMessage={formError ?? create.error?.message}
        onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
        onSubmit={submitApplication}
      />
      <ApplicationList applications={visibleApplications} />
    </div>
  )
}

function applicationInput(form: ApplicationFormState): CreateApplicationInput {
  return {
    environment_id: form.environment_id.trim(),
    server_id: form.server_id.trim(),
    name: form.name.trim(),
    remote_directory: form.remote_directory.trim(),
    repository_url: optionalTrimmed(form.repository_url),
    branch: form.branch.trim() || 'main',
    compose_path: form.compose_path.trim() || 'docker-compose.yml',
    domain: optionalTrimmed(form.domain)?.toLowerCase(),
    health_check_url: optionalTrimmed(form.health_check_url),
    doppler_project: optionalTrimmed(form.doppler_project),
    doppler_config: optionalTrimmed(form.doppler_config),
  }
}

function optionalTrimmed(value: string): string | undefined {
  const trimmed = value.trim()
  return trimmed ? trimmed : undefined
}

function validateRequiredSelection(value: string, label: string): void {
  if (!value.trim()) {
    throw new Error(`${label} is required.`)
  }
}

function validateRemoteDirectory(value: string): void {
  const remoteDirectory = value.trim()
  if (remoteDirectory.includes('\n') || remoteDirectory.includes('\r') || remoteDirectory.includes('\t')) {
    throw new Error('Remote directory cannot contain control characters.')
  }
  if (remoteDirectory === '/' || !remoteDirectory.startsWith('/')) {
    throw new Error('Remote directory must be an absolute path below root.')
  }
  if (remoteDirectory.includes('//')) {
    throw new Error('Remote directory cannot contain empty path segments.')
  }
  if (remoteDirectory.split('/').includes('..')) {
    throw new Error('Remote directory cannot contain parent directory segments.')
  }
}

function validateGitBranch(value: string): void {
  const branch = value.trim()
  if (!branch) {
    throw new Error('Branch is required.')
  }
  if (branch.startsWith('-')) {
    throw new Error('Branch cannot start with hyphen.')
  }
  if (branch.startsWith('/') || branch.endsWith('/') || branch.includes('//')) {
    throw new Error('Branch cannot contain empty path segments.')
  }
  if (branch.endsWith('.') || branch.includes('..') || branch.includes('@{') || branch.endsWith('.lock')) {
    throw new Error('Branch is not a safe git ref.')
  }
  if (!/^[A-Za-z0-9/._-]+$/.test(branch)) {
    throw new Error('Branch contains unsupported characters.')
  }
}

function validateComposePath(value: string): void {
  const composePath = value.trim()
  if (!composePath) {
    throw new Error('Compose path is required.')
  }
  if (composePath.startsWith('/')) {
    throw new Error('Compose path must be relative to the remote directory.')
  }
  if (composePath.includes('\n') || composePath.includes('\r') || composePath.includes('\t')) {
    throw new Error('Compose path cannot contain control characters.')
  }
  if (composePath.split('/').includes('..')) {
    throw new Error('Compose path cannot contain parent directory segments.')
  }
  if (composePath === '.') {
    throw new Error('Compose path must point to a compose file.')
  }
}

function validateOptionalDomain(value: string): void {
  if (!value.trim()) {
    return
  }
  validateDomain(value)
}

function validateRepositoryURL(value: string): void {
  const repositoryURL = value.trim()
  if (!repositoryURL) {
    return
  }
  if (repositoryURL.includes('\n') || repositoryURL.includes('\r') || repositoryURL.includes('\t')) {
    throw new Error('Repository URL cannot contain control characters.')
  }
  if (/^git@github\.com:[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+\.git$/.test(repositoryURL)) {
    return
  }
  if (/^https:\/\/github\.com\/[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+(\.git)?$/.test(repositoryURL)) {
    return
  }
  throw new Error('Repository URL must be a GitHub owner/repository remote.')
}

function validateDopplerScope(project: string, config: string): void {
  const dopplerProject = project.trim()
  const dopplerConfig = config.trim()
  if (!!dopplerProject !== !!dopplerConfig) {
    throw new Error('Doppler project and config must be provided together.')
  }
  if (hasControlCharacters(dopplerProject)) {
    throw new Error('Doppler project cannot contain control characters.')
  }
  if (hasControlCharacters(dopplerConfig)) {
    throw new Error('Doppler config cannot contain control characters.')
  }
}

function hasControlCharacters(value: string): boolean {
  return value.includes('\n') || value.includes('\r') || value.includes('\t')
}
