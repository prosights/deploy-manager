import * as DialogPrimitive from '@radix-ui/react-dialog'
import { useMutation, useQuery, useQueryClient, useSuspenseQuery } from '@tanstack/react-query'
import { Plus, Search, Server as ServerIcon, X } from 'lucide-react'
import type React from 'react'
import { useEffect, useState } from 'react'
import { Button } from '../components/ui/button'
import { BlockError } from '../components/ui/error-message'
import { ApplicationTerminal, canConnectToServer, defaultServerForm, ServerCreatePanel, ServerDevUsersPanel, ServerList, ServerLogsPanel, type ServerCheckResults, type ServerFormState } from '../features/servers/components'
import { addServerDevUser, checkServer, createServer, deleteServerDevUser, listServerDevUsers, runServerCommand, updateServerDevUser, type CreateServerInput, type Server } from '../lib/api'
import { cn } from '../lib/cn'
import { serversQuery, tailscaleDevicesQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'

type ServerTab = 'logs' | 'configure' | 'console'

const serverLogsCommand = 'if command -v journalctl >/dev/null 2>&1; then journalctl --no-pager -n 300 -r -o short-iso 2>&1; else for container in $(docker ps --format "{{.Names}}"); do docker logs --timestamps --tail 100 "$container" 2>&1 | awk -v name="$container" \'{ stamp=$1; $1=""; print stamp " [" name "]" $0 }\'; done | sort -r | head -n 300; fi'

export function ServersRoute() {
  const queryClient = useQueryClient()
  const { data: servers } = useSuspenseQuery(serversQuery)
  const { data: tailscaleDevices } = useQuery(tailscaleDevicesQuery)
  const [searchQuery, setSearchQuery] = useState('')
  const [registerOpen, setRegisterOpen] = useState(false)
  const [selectedServerID, setSelectedServerID] = useState('')
  const [serverTab, setServerTab] = useState<ServerTab>('logs')
  const [form, setForm] = useState(defaultServerForm())
  const [formError, setFormError] = useState<string>()
  const [checkResults, setCheckResults] = useState<ServerCheckResults>({})
  const [checkError, setCheckError] = useState<string>()
  const visibleServers = servers.filter((server) => matchesSearch(searchQuery, [
    server.name,
    server.hostname,
    server.ssh_user,
    server.ssh_port,
    server.ssh_key_path,
    server.connection_mode,
    server.proxy_type,
    server.status,
  ]))
  const checkableServerIDs = servers.filter(canConnectToServer).map((server) => server.id).join('|')
  const create = useMutation({
    mutationFn: () => createServer(serverInput(form)),
    onSuccess: async () => {
      setForm(defaultServerForm())
      setFormError(undefined)
      setRegisterOpen(false)
      await queryClient.invalidateQueries({ queryKey: serversQuery.queryKey })
    },
  })
  const selectedServer = servers.find((server) => server.id === selectedServerID)
  const devUsers = useQuery({
    queryKey: ['servers', selectedServerID, 'dev-users'],
    queryFn: ({ signal }) => listServerDevUsers(selectedServerID, { signal }),
    enabled: Boolean(selectedServer && serverTab === 'configure'),
  })
  const serverLogs = useQuery({
    queryKey: ['servers', selectedServerID, 'logs'],
    queryFn: async () => {
      const response = await runServerCommand(selectedServerID, serverLogsCommand)
      if (response.error) throw new Error(response.error)
      return response.output
    },
    enabled: Boolean(selectedServer && serverTab === 'logs'),
    refetchInterval: serverTab === 'logs' ? 10_000 : false,
  })
  const addDevUser = useMutation({
    mutationFn: (username: string) => addServerDevUser(selectedServerID, username),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers', selectedServerID, 'dev-users'] })
    },
  })
  const updateDevUser = useMutation({
    mutationFn: ({ currentUsername, username }: { currentUsername: string, username: string }) => updateServerDevUser(selectedServerID, currentUsername, username),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers', selectedServerID, 'dev-users'] })
    },
  })
  const deleteDevUser = useMutation({
    mutationFn: (username: string) => deleteServerDevUser(selectedServerID, username),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: ['servers', selectedServerID, 'dev-users'] })
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

  function openServer(serverID: string, tab: ServerTab) {
    setSelectedServerID(serverID)
    setServerTab(tab)
  }

  useEffect(() => {
    let cancelled = false
    const serverIDs = checkableServerIDs ? checkableServerIDs.split('|') : []
    async function refreshServers() {
      if (serverIDs.length === 0) return
      const results = await Promise.allSettled(serverIDs.map((serverID) => checkServer(serverID)))
      if (cancelled) return
      const nextResults: ServerCheckResults = {}
      const failed = results.find((result) => result.status === 'rejected')
      for (const result of results) {
        if (result.status !== 'fulfilled') continue
        nextResults[result.value.server.id] = {
          sshOK: result.value.ssh_ok,
          dockerOK: result.value.docker_ok,
          docker: result.value.docker ? `Docker ${result.value.docker.api_version}` : undefined,
          sshError: result.value.error,
          dockerError: result.value.docker_error,
        }
      }
      setCheckResults((state) => ({ ...state, ...nextResults }))
      setCheckError(failed ? (failed.reason instanceof Error ? failed.reason.message : 'Server refresh failed.') : undefined)
      await queryClient.invalidateQueries({ queryKey: serversQuery.queryKey })
    }
    void refreshServers()
    const interval = window.setInterval(() => void refreshServers(), 30_000)
    return () => {
      cancelled = true
      window.clearInterval(interval)
    }
  }, [checkableServerIDs, queryClient])

  return (
    <div className="space-y-5">
      <div className="flex flex-wrap items-center gap-2">
        <label className="flex h-9 min-w-56 flex-1 items-center gap-2 rounded-prosights-md border border-prosights-border bg-prosights-surface px-3 text-prosights-muted focus-within:ring-2 focus-within:ring-prosights-ring sm:max-w-sm">
          <Search className="size-4 shrink-0" aria-hidden="true" />
          <input
            type="search"
            aria-label="Search servers"
            className="min-w-0 flex-1 bg-transparent text-[13px] text-prosights-text outline-none placeholder:text-prosights-subtle"
            value={searchQuery}
            onChange={(event) => setSearchQuery(event.target.value)}
            placeholder="Search servers"
          />
        </label>
        <Button type="button" variant="primary" className="ml-auto" onClick={() => setRegisterOpen(true)}>
          <Plus className="size-4" aria-hidden="true" />
          Register server
        </Button>
      </div>
      {checkError && <BlockError message={checkError} />}
      <ServerList
        servers={visibleServers}
        checkResults={checkResults}
        onOpen={(serverID) => openServer(serverID, 'logs')}
        onOpenConsole={(serverID) => openServer(serverID, 'console')}
        onConfigure={(serverID) => openServer(serverID, 'configure')}
      />

      <ServerDialog
        open={registerOpen}
        title="Register server"
        description="Connect a machine that Deploy Manager can reach over SSH."
        wide
        onOpenChange={setRegisterOpen}
      >
        <ServerCreatePanel
          embedded
          form={form}
          tailscaleDevices={tailscaleDevices}
          isSaving={create.isPending}
          errorMessage={formError ?? create.error?.message}
          onChange={(updates) => setForm((state) => ({ ...state, ...updates }))}
          onSubmit={submitServer}
        />
      </ServerDialog>

      <ServerDrawer
        server={selectedServer}
        tab={serverTab}
        onTabChange={setServerTab}
        onClose={() => setSelectedServerID('')}
      >
        {serverTab === 'configure' && (
          <div className="p-6">
            <ServerDevUsersPanel
              server={selectedServer}
              users={devUsers.data}
              loading={devUsers.isFetching}
              pending={addDevUser.isPending || updateDevUser.isPending || deleteDevUser.isPending}
              errorMessage={devUsers.error?.message ?? addDevUser.error?.message ?? updateDevUser.error?.message ?? deleteDevUser.error?.message}
              onAdd={(username) => addDevUser.mutate(username)}
              onUpdate={(currentUsername, username) => updateDevUser.mutate({ currentUsername, username })}
              onDelete={(username) => deleteDevUser.mutate(username)}
            />
          </div>
        )}
        {serverTab === 'logs' && (
          <div className="flex h-full min-h-0 flex-col p-6">
            <ServerLogsPanel
              server={selectedServer}
              logs={serverLogs.data}
              loading={serverLogs.isFetching}
              errorMessage={serverLogs.error?.message}
              onRefresh={() => void serverLogs.refetch()}
            />
          </div>
        )}
        {serverTab === 'console' && (
              <div className="flex h-full min-h-0 flex-col gap-4 p-6">
                <div>
                  <h2 className="text-[14px] font-semibold text-prosights-text">Server console</h2>
                  <p className="mt-1 text-[12px] text-prosights-muted">Interactive shell on {selectedServer?.name ?? 'this server'}.</p>
                </div>
                <ApplicationTerminal server={selectedServer} active={serverTab === 'console'} />
              </div>
        )}
      </ServerDrawer>
    </div>
  )
}

function ServerDrawer({
  server,
  tab,
  onTabChange,
  onClose,
  children,
}: {
  server?: Server
  tab: ServerTab
  onTabChange: (tab: ServerTab) => void
  onClose: () => void
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={Boolean(server)} onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/[0.04] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150" />
        <DialogPrimitive.Content className="fixed inset-y-3 right-3 z-50 flex w-[calc(100%-1.5rem)] max-w-[1120px] flex-col overflow-hidden rounded-[12px] border border-prosights-border bg-prosights-surface shadow-[0_24px_80px_rgba(0,0,0,0.20)] outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:slide-out-to-right-2 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:slide-in-from-right-2 data-[state=open]:duration-150 sm:w-[min(68vw,1120px)]">
          <header className="shrink-0 border-b border-prosights-border px-7 pt-6">
            <div className="flex items-start justify-between gap-4">
              <div className="flex min-w-0 items-center gap-3">
                <ServerIcon className="size-6 shrink-0 text-prosights-text" aria-hidden="true" />
                <div className="min-w-0">
                  <DialogPrimitive.Title className="truncate text-[18px] font-semibold text-prosights-text">{server?.name ?? 'Server'}</DialogPrimitive.Title>
                  <DialogPrimitive.Description className="mt-1 truncate font-mono text-[11px] text-prosights-muted">
                    {server ? `${server.ssh_user}@${server.hostname}:${server.ssh_port}` : ''}
                  </DialogPrimitive.Description>
                </div>
              </div>
              <DialogPrimitive.Close className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text" aria-label="Close server">
                <X className="size-4" aria-hidden="true" />
              </DialogPrimitive.Close>
            </div>
            <nav className="mt-4 flex gap-6" aria-label="Server sections">
              {(['logs', 'configure', 'console'] as const).map((item) => (
                <button key={item} type="button" className={cn('relative h-10 bg-transparent px-0 text-[13px] font-medium capitalize transition-colors', tab === item ? 'text-prosights-text' : 'text-prosights-muted hover:text-prosights-text')} aria-current={tab === item ? 'page' : undefined} onClick={() => onTabChange(item)}>
                  {item}
                  {tab === item ? <span className="absolute inset-x-0 bottom-0 h-0.5 rounded-full bg-prosights-text" /> : null}
                </button>
              ))}
            </nav>
          </header>
          <div className="min-h-0 flex-1 overflow-auto bg-prosights-canvas">{children}</div>
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function ServerDialog({
  open,
  title,
  description,
  wide = false,
  onOpenChange,
  children,
}: {
  open: boolean
  title: string
  description: string
  wide?: boolean
  onOpenChange: (open: boolean) => void
  children: React.ReactNode
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/20 backdrop-blur-[1px] data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150" />
        <DialogPrimitive.Content className={cn(
          'fixed left-1/2 top-1/2 z-50 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 overflow-auto rounded-prosights-xl border border-prosights-border bg-prosights-surface shadow-prosights-float outline-none data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150',
          wide ? 'max-w-6xl' : 'max-w-4xl',
        )}>
          <div className="px-6 pb-3 pt-6 pr-14">
            <DialogPrimitive.Title className="text-[17px] font-semibold tracking-[-0.01em] text-prosights-text">{title}</DialogPrimitive.Title>
            <DialogPrimitive.Description className="mt-1 text-[13px] leading-5 text-prosights-muted">{description}</DialogPrimitive.Description>
          </div>
          <DialogPrimitive.Close asChild>
            <button type="button" aria-label={`Close ${title.toLowerCase()}`} className="absolute right-5 top-5 inline-flex size-7 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prosights-ring">
              <X className="size-4" aria-hidden="true" />
            </button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  )
}

function serverInput(form: ServerFormState): CreateServerInput {
  return {
    name: form.name.trim(),
    hostname: form.hostname.trim(),
    ssh_user: form.ssh_user.trim() || 'root',
    ssh_port: parseSSHPort(form.ssh_port),
    ssh_key_path: form.connection_mode === 'tailscale_ssh' ? '' : form.ssh_key_path.trim(),
    connection_mode: form.connection_mode,
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
    ['Connection mode', form.connection_mode],
  ] as const) {
    if (value.includes('\n') || value.includes('\r') || value.includes('\t')) {
      throw new Error(`${label} cannot contain control characters.`)
    }
  }
  if (form.connection_mode === 'tailscale_ssh') {
    return
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
