import { useMutation, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { useState } from 'react'
import { PageHeader } from '../components/page-header'
import { BlockError } from '../components/ui/error-message'
import { defaultServerForm, ServerCreatePanel, ServerList, type ServerCheckResults, type ServerFormState } from '../features/servers/components'
import { checkServer, createServer, type CreateServerInput } from '../lib/api'
import { serversQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'
import { useUiStore } from '../store/ui'

export function ServersRoute() {
  const queryClient = useQueryClient()
  const { data: servers } = useSuspenseQuery(serversQuery)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const [form, setForm] = useState(defaultServerForm())
  const [formError, setFormError] = useState<string>()
  const [checkResults, setCheckResults] = useState<ServerCheckResults>({})
  const visibleServers = servers.filter((server) => matchesSearch(searchQuery, [
    server.name,
    server.hostname,
    server.ssh_user,
    server.ssh_port,
    server.ssh_key_path,
    server.proxy_type,
    server.status,
  ]))
  const create = useMutation({
    mutationFn: () => createServer(serverInput(form)),
    onSuccess: async () => {
      setForm(defaultServerForm())
      setFormError(undefined)
      await queryClient.invalidateQueries({ queryKey: serversQuery.queryKey })
    },
  })
  const check = useMutation({
    mutationFn: (serverID: string) => checkServer(serverID),
    onSuccess: async (result) => {
      setCheckResults((state) => ({
        ...state,
        [result.server.id]: {
          sshOK: result.ssh_ok,
          dockerOK: result.docker_ok,
          docker: result.docker ? `Docker ${result.docker.api_version}` : undefined,
          sshError: result.error,
          dockerError: result.docker_error,
        },
      }))
      await queryClient.invalidateQueries({ queryKey: serversQuery.queryKey })
    },
  })

  function submitServer() {
    setFormError(undefined)
    try {
      parseSSHPort(form.ssh_port)
      validateServerIdentity(form)
    } catch (error) {
      setFormError(error instanceof Error ? error.message : 'Server target is invalid.')
      return
    }
    create.mutate()
  }

  return (
    <div className="space-y-5">
      <PageHeader title="Servers" description="SSH targets, health checks, resource pressure, and proxy mode." />
      <ServerCreatePanel
        form={form}
        isSaving={create.isPending}
        errorMessage={formError ?? create.error?.message}
        onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
        onSubmit={submitServer}
      />
      {check.error && <BlockError message={check.error.message} />}
      <ServerList
        servers={visibleServers}
        checkResults={checkResults}
        isChecking={check.isPending}
        onCheck={(serverID) => check.mutate(serverID)}
      />
    </div>
  )
}

function serverInput(form: ServerFormState): CreateServerInput {
  return {
    name: form.name.trim(),
    hostname: form.hostname.trim(),
    ssh_user: form.ssh_user.trim() || 'root',
    ssh_port: parseSSHPort(form.ssh_port),
    ssh_key_path: form.ssh_key_path.trim(),
    proxy_type: form.proxy_type,
  }
}

function parseSSHPort(value: string): number {
  const port = Number(value.trim())
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('SSH port must be between 1 and 65535.')
  }
  return port
}

function validateServerIdentity(form: ReturnType<typeof defaultServerForm>): void {
  for (const [label, value] of [
    ['Name', form.name],
    ['Hostname', form.hostname],
    ['SSH user', form.ssh_user],
    ['SSH key path', form.ssh_key_path],
  ] as const) {
    if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
      throw new Error(`${label} cannot contain control characters.`)
    }
  }
  validateSSHKeyPath(form.ssh_key_path)
}

function validateSSHKeyPath(value: string): void {
  const sshKeyPath = value.trim()
  if (!sshKeyPath.startsWith('/') && !sshKeyPath.startsWith('~/')) {
    throw new Error('SSH key path must be absolute or home-relative.')
  }
  if (sshKeyPath.includes('//')) {
    throw new Error('SSH key path cannot contain empty path segments.')
  }
  if (sshKeyPath.split('/').includes('..')) {
    throw new Error('SSH key path cannot contain parent directory segments.')
  }
}
