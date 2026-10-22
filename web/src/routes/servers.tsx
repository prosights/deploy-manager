import { useSuspenseQuery } from '@tanstack/react-query'
import { Plus, Search, Server as ServerIcon } from 'lucide-react'
import { useState } from 'react'
import { Button } from '../components/ui/button'
import { Dialog, DialogBody, DialogContent, DialogHeader, DialogTrigger } from '../components/ui/dialog'
import { Tabs } from '../components/ui/tabs'
import { ApplicationTerminal, ServerCreatePanel, ServerDevUsersPanel, ServerList, ServerLogsPanel, type ServerTab } from '../features/servers/components'
import type { Server } from '../lib/api'
import { serversQuery } from '../lib/queries'
import { matchesSearch } from '../lib/search'

const serverTabs = [
  { id: 'logs', label: 'Logs' },
  { id: 'configure', label: 'Configure' },
  { id: 'console', label: 'Console' },
] as const

export function ServersRoute() {
  // Rows run their own health checks; polling the list picks up the status
  // and resource usage those checks record.
  const { data: servers } = useSuspenseQuery({ ...serversQuery, refetchInterval: 30_000 })
  const [searchQuery, setSearchQuery] = useState('')
  const [opened, setOpened] = useState<{ serverID: string, tab: ServerTab }>()
  const openedServer = servers.find((server) => server.id === opened?.serverID)
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
        <RegisterServerDialog />
      </div>
      <ServerList servers={visibleServers} onOpen={(serverID, tab) => setOpened({ serverID, tab })} />
      {opened && openedServer && (
        <ServerDrawer key={opened.serverID} server={openedServer} initialTab={opened.tab} onClose={() => setOpened(undefined)} />
      )}
    </div>
  )
}

function RegisterServerDialog() {
  const [open, setOpen] = useState(false)
  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button type="button" variant="primary" className="ml-auto">
          <Plus className="size-4" aria-hidden="true" />
          Register server
        </Button>
      </DialogTrigger>
      <DialogContent size="xl" className="overflow-auto">
        <DialogHeader
          title="Register server"
          description="Connect a machine that Paddock can reach over SSH."
          closeLabel="Close register server"
        />
        <ServerCreatePanel onCreated={() => setOpen(false)} />
      </DialogContent>
    </Dialog>
  )
}

function ServerDrawer({ server, initialTab, onClose }: { server: Server, initialTab: ServerTab, onClose: () => void }) {
  const [tab, setTab] = useState(initialTab)
  return (
    <Dialog open onOpenChange={(open) => { if (!open) onClose() }}>
      <DialogContent layout="drawer">
        <DialogHeader
          title={server.name}
          description={<span className="font-mono">{server.ssh_user}@{server.hostname}:{server.ssh_port}</span>}
          closeLabel="Close server"
          icon={<ServerIcon className="size-6 shrink-0 text-prosights-text" aria-hidden="true" />}
        >
          <Tabs tabs={serverTabs} active={tab} label="Server sections" onSelect={setTab} />
        </DialogHeader>
        {tab === 'logs' && (
          <DialogBody className="flex flex-col">
            <ServerLogsPanel server={server} />
          </DialogBody>
        )}
        {tab === 'configure' && (
          <DialogBody>
            <ServerDevUsersPanel server={server} />
          </DialogBody>
        )}
        {tab === 'console' && (
          <DialogBody className="flex flex-col gap-4">
            <div>
              <h2 className="text-[14px] font-semibold text-prosights-text">Server console</h2>
              <p className="mt-1 text-[12px] text-prosights-muted">Interactive shell on {server.name}.</p>
            </div>
            <ApplicationTerminal server={server} active />
          </DialogBody>
        )}
      </DialogContent>
    </Dialog>
  )
}
