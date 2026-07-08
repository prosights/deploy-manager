import { useQuery } from '@tanstack/react-query'
import { useNavigate } from '@tanstack/react-router'
import { Bell, Cable, FileClock, FolderKanban, Gauge, KeyRound, Package, Rocket, Search, Server, Settings } from 'lucide-react'
import { useEffect, useMemo, useState } from 'react'
import { matchesSearch } from '../lib/search'
import { applicationsQuery, projectsQuery, serversQuery } from '../lib/queries'
import { useUiStore } from '../store/ui'

type PaletteItem = {
  id: string
  group: 'Pages' | 'Projects' | 'Services' | 'Servers'
  label: string
  detail?: string
  icon: typeof Gauge
  run: () => void
}

const pages: Array<{ label: string, to: string, icon: typeof Gauge }> = [
  { label: 'Overview', to: '/', icon: Gauge },
  { label: 'Projects', to: '/projects', icon: FolderKanban },
  { label: 'Deployments', to: '/deployments', icon: Rocket },
  { label: 'Servers', to: '/servers', icon: Server },
  { label: 'Credentials', to: '/credentials', icon: KeyRound },
  { label: 'Notifications', to: '/notifications', icon: Bell },
  { label: 'Connectors', to: '/connectors', icon: Cable },
  { label: 'Audit', to: '/audit', icon: FileClock },
  { label: 'Settings', to: '/settings', icon: Settings },
]

const maxItemsPerGroup = 6

// Cmd/Ctrl+K jump-to-anything. Data comes from the same cached queries the
// pages use, so opening the palette costs nothing after first load.
export function CommandPalette() {
  const open = useUiStore((state) => state.commandPaletteOpen)
  const setOpen = useUiStore((state) => state.setCommandPaletteOpen)

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === 'k') {
        event.preventDefault()
        setOpen(!useUiStore.getState().commandPaletteOpen)
      }
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [setOpen])

  // The dialog mounts fresh on every open, so query and selection state
  // start clean without any reset effects.
  if (!open) return null
  return <PaletteDialog onClose={() => setOpen(false)} />
}

function PaletteDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate()
  const [query, setQuery] = useState('')
  const [activeIndex, setActiveIndex] = useState(0)

  const { data: projects } = useQuery(projectsQuery)
  const { data: applications } = useQuery(applicationsQuery)
  const { data: servers } = useQuery(serversQuery)

  const items = useMemo<PaletteItem[]>(() => {
    const close = onClose
    const pageItems = pages
      .filter((page) => matchesSearch(query, [page.label, page.to]))
      .slice(0, maxItemsPerGroup)
      .map<PaletteItem>((page) => ({
        id: `page:${page.to}`,
        group: 'Pages',
        label: page.label,
        icon: page.icon,
        run: () => {
          close()
          void navigate({ to: page.to })
        },
      }))
    const projectItems = (projects ?? [])
      .filter((project) => matchesSearch(query, [project.name, project.slug, project.repository_full_name]))
      .slice(0, maxItemsPerGroup)
      .map<PaletteItem>((project) => ({
        id: `project:${project.id}`,
        group: 'Projects',
        label: project.name,
        detail: project.repository_full_name ? `${project.repository_full_name}#${project.repository_branch ?? 'main'}` : project.slug,
        icon: FolderKanban,
        run: () => {
          close()
          void navigate({ to: '/projects/$projectId', params: { projectId: project.id } })
        },
      }))
    const serviceItems = (applications ?? [])
      .filter((application) => matchesSearch(query, [application.name, application.project_name, application.environment_name, application.server_name]))
      .slice(0, maxItemsPerGroup)
      .map<PaletteItem>((application) => ({
        id: `service:${application.id}`,
        group: 'Services',
        label: application.name,
        detail: `${application.project_name} / ${application.environment_name} on ${application.server_name}`,
        icon: Package,
        run: () => {
          close()
          void navigate({ to: '/projects/$projectId', params: { projectId: application.project_id }, hash: 'services' })
        },
      }))
    const serverItems = (servers ?? [])
      .filter((server) => matchesSearch(query, [server.name, server.hostname]))
      .slice(0, maxItemsPerGroup)
      .map<PaletteItem>((server) => ({
        id: `server:${server.id}`,
        group: 'Servers',
        label: server.name,
        detail: server.hostname,
        icon: Server,
        run: () => {
          close()
          void navigate({ to: '/servers' })
        },
      }))
    return [...pageItems, ...projectItems, ...serviceItems, ...serverItems]
  }, [query, projects, applications, servers, navigate, onClose])

  const activeItem = items[Math.min(activeIndex, items.length - 1)]
  let lastGroup: PaletteItem['group'] | undefined

  return (
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 p-4 pt-[12vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose()
      }}
    >
      <div role="dialog" aria-modal="true" aria-label="Command palette" className="w-full max-w-xl overflow-hidden rounded-lg border bg-surface shadow-2xl">
        <div className="flex items-center gap-2 border-b px-3">
          <Search className="size-4 shrink-0 text-muted" aria-hidden="true" />
          <input
            autoFocus
            aria-label="Search projects, services, servers, and pages"
            className="h-11 w-full bg-transparent text-sm text-ink outline-none placeholder:text-muted/70"
            placeholder="Jump to a project, service, server, or page..."
            value={query}
            onChange={(event) => {
              setQuery(event.target.value)
              setActiveIndex(0)
            }}
            onKeyDown={(event) => {
              if (event.key === 'Escape') {
                event.preventDefault()
                onClose()
              }
              if (event.key === 'ArrowDown') {
                event.preventDefault()
                setActiveIndex((index) => Math.min(index + 1, items.length - 1))
              }
              if (event.key === 'ArrowUp') {
                event.preventDefault()
                setActiveIndex((index) => Math.max(index - 1, 0))
              }
              if (event.key === 'Enter' && activeItem) {
                event.preventDefault()
                activeItem.run()
              }
            }}
          />
          <kbd className="shrink-0 rounded border bg-background px-1.5 py-0.5 text-[10px] font-medium text-muted">esc</kbd>
        </div>
        <div role="listbox" aria-label="Results" className="max-h-[50vh] overflow-y-auto py-1">
          {items.map((item) => {
            const groupHeading = item.group !== lastGroup ? item.group : undefined
            lastGroup = item.group
            const Icon = item.icon
            const active = item === activeItem
            return (
              <div key={item.id}>
                {groupHeading && <div className="px-3 pb-1 pt-2 text-[10px] font-medium uppercase tracking-wide text-muted">{groupHeading}</div>}
                <button
                  type="button"
                  role="option"
                  aria-selected={active}
                  className={`flex w-full items-center gap-3 px-3 py-2 text-left text-sm ${active ? 'bg-accent/15 text-accent-text' : 'text-ink hover:bg-panel'}`}
                  onMouseEnter={() => setActiveIndex(items.indexOf(item))}
                  onClick={() => item.run()}
                >
                  <Icon className="size-4 shrink-0 text-muted" aria-hidden="true" />
                  <span className="truncate font-medium">{item.label}</span>
                  {item.detail && <span className="min-w-0 truncate text-xs text-muted">{item.detail}</span>}
                </button>
              </div>
            )
          })}
          {items.length === 0 && <div className="px-3 py-6 text-center text-sm text-muted">No matches. Try a project, service, or server name.</div>}
        </div>
      </div>
    </div>
  )
}
