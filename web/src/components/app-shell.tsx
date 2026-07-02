import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { Bell, Boxes, Cable, ChevronLeft, Container, FileClock, FolderKanban, Gauge, GitBranch, KeyRound, Layers3, Monitor, Moon, Rocket, Route, Search, Server, Settings, Sun } from 'lucide-react'
import { useSuspenseQueries } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Suspense, useEffect, useState } from 'react'
import type { InstanceSettings } from '../lib/api'
import { environmentsQuery, projectsQuery, settingsQuery } from '../lib/queries'
import { nextTheme, useUiStore } from '../store/ui'
import { Button } from './ui/button'
import { cn } from '../lib/cn'

const nav: Array<{ to: string, label: string, icon: typeof Gauge }> = [
  { to: '/', label: 'Overview', icon: Gauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/deployments', label: 'Deployments', icon: Rocket },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/connectors', label: 'Connectors', icon: Cable },
  { to: '/audit', label: 'Audit', icon: FileClock },
  { to: '/settings', label: 'Settings', icon: Settings },
]

const projectNav: Array<{ hash: string, label: string, icon: typeof Gauge }> = [
  { hash: 'overview', label: 'Overview', icon: Layers3 },
  { hash: 'environments', label: 'Environments', icon: GitBranch },
  { hash: 'services', label: 'Services', icon: Boxes },
  { hash: 'targets', label: 'Deploy Targets', icon: Server },
  { hash: 'registry', label: 'Registry', icon: Container },
  { hash: 'routes', label: 'Proxy Routes', icon: Route },
  { hash: 'settings', label: 'Settings', icon: Settings },
]

const defaultSettings: InstanceSettings = {
  name: 'Deploy Manager',
  short_name: 'Deploy',
  meta_description: 'Internal deployment control plane',
  logo_url: '/branding/prosights/prosights-co-logo.png',
  favicon_url: '/branding/prosights/favicon.png',
  primary_color: '#0980fd',
  docs_url: '#',
}

export function AppShell() {
  const [settingsResult, projectsResult, environmentsResult] = useSuspenseQueries({
    queries: [settingsQuery, projectsQuery, environmentsQuery],
  })
  const settings: InstanceSettings = settingsResult.data ?? defaultSettings
  const projects = projectsResult.data
  const environments = environmentsResult.data
  const location = useLocation()
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const searchQuery = useUiStore((state) => state.searchQuery)
  const setSearchQuery = useUiStore((state) => state.setSearchQuery)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const safeAccent = ensureVisibleAccent(settings.primary_color || '#0980fd', theme)
  const brandStyle = {
    '--color-accent': safeAccent,
    '--color-accent-fg': accentForeground(safeAccent),
    '--color-accent-text': accentTextColor(safeAccent, theme),
  } as CSSProperties
  const projectID = projectIDFromSearch(window.location.search)
  const activeProject = location.pathname === '/projects' ? projects.find((project) => project.id === projectID) : undefined
  const activeEnvironments = activeProject ? environments.filter((environment) => environment.project_id === activeProject.id) : []
  const projectSection = activeProject ? projectSectionFromHash(location.hash) : ''
  const contextLabel = activeProject
    ? `${activeProject.slug} / ${activeEnvironments.length} env${activeEnvironments.length === 1 ? '' : 's'}`
    : 'all projects'

  useEffect(() => {
    document.title = settings.name
    setMetaDescription(settings.meta_description)
    setFavicon(settings.favicon_url)
  }, [settings.favicon_url, settings.meta_description, settings.name])

  return (
    <div className="flex min-h-screen bg-background text-ink" style={brandStyle}>
      <aside className={cn('flex border-r bg-surface transition-[width] duration-200', collapsed ? 'w-[72px]' : 'w-64')}>
        <div className="flex w-full flex-col">
          <div className="flex h-14 items-center gap-3 border-b px-4">
            <div className="flex size-8 items-center justify-center">
              {settings.logo_url ? (
                <img className="logo-mark max-h-7 max-w-7 object-contain" src={settings.logo_url} alt="" />
              ) : (
                <span className="text-sm font-semibold text-ink">{settings.short_name.slice(0, 1).toUpperCase()}</span>
              )}
            </div>
            {!collapsed && (
              <div className="min-w-0">
                <div className="truncate text-sm font-semibold">{settings.short_name}</div>
                <div className="truncate text-xs text-muted">Internal deployments</div>
              </div>
            )}
          </div>
          <nav className="flex flex-1 flex-col gap-1 px-3 py-3">
            {nav.map((item) => {
              const active = location.pathname === item.to
              const Icon = item.icon
              return (
                <div key={item.to}>
                  <Link
                    to={item.to}
                    className={cn(
                      'flex h-9 items-center gap-3 rounded-md px-2 text-sm text-muted transition-colors hover:bg-panel hover:text-ink',
                      active && 'bg-accent/15 text-accent-text',
                    )}
                  >
                    <Icon className="size-4 shrink-0" aria-hidden="true" />
                    {!collapsed && <span className="truncate">{item.label}</span>}
                  </Link>
                {item.to === '/projects' && !collapsed && active && activeProject && (
                  <div className="ml-6 mt-1 space-y-1 border-l pl-2">
                    <div className="px-2 py-1 text-xs text-muted">
                      <div className="truncate font-medium text-ink">{activeProject.name}</div>
                      <div className="truncate">{activeEnvironments.length} env{activeEnvironments.length === 1 ? '' : 's'}</div>
                    </div>
                    {projectNav.map((projectItem) => {
                      const ProjectIcon = projectItem.icon
                      return (
                        <a
                          key={projectItem.hash}
                          href={projectSectionHref(activeProject.id, projectItem.hash)}
                          className={cn(
                            'flex h-8 items-center gap-2 rounded-md px-2 text-sm text-muted transition-colors hover:bg-panel hover:text-ink',
                            projectSection === projectItem.hash && 'bg-accent/15 text-accent-text',
                          )}
                        >
                          <ProjectIcon className="size-3.5 shrink-0" aria-hidden="true" />
                          <span className="truncate">{projectItem.label}</span>
                        </a>
                      )
                    })}
                  </div>
                )}
                </div>
              )
            })}
          </nav>
          <div className="border-t p-3">
            <Button variant="ghost" className="w-full justify-start" onClick={toggleSidebar} aria-label="Toggle sidebar">
              <ChevronLeft className={cn('size-4 transition-transform', collapsed && 'rotate-180')} />
              {!collapsed && 'Collapse'}
            </Button>
          </div>
        </div>
      </aside>
      <main className="min-w-0 flex-1">
        <header className="flex h-14 items-center justify-between gap-4 border-b bg-background/95 px-5">
          <div className="flex min-w-0 items-center gap-3">
            <GitBranch className="size-4 text-muted" aria-hidden="true" />
            <div className="truncate text-sm text-muted">{contextLabel}</div>
          </div>
          <label className="hidden h-9 w-full max-w-md items-center gap-2 rounded-md border bg-surface px-3 text-muted focus-within:ring-2 focus-within:ring-accent md:flex">
            <Search className="size-4" aria-hidden="true" />
            <input
              aria-label="Search"
              className="min-w-0 flex-1 bg-transparent text-sm text-ink outline-none placeholder:text-muted/70"
              value={searchQuery}
              onChange={(event) => setSearchQuery(event.target.value)}
              placeholder="Search servers, deployments, credentials"
            />
          </label>
          <div className="flex items-center gap-3">
            <Button
              variant="ghost"
              className="size-9 p-0"
              onClick={() => setTheme(nextTheme(theme))}
              aria-label={`Theme: ${theme}. Click to switch.`}
            >
              {theme === 'light'
                ? <Sun className="size-4" />
                : theme === 'dark'
                  ? <Moon className="size-4" />
                  : <Monitor className="size-4" />
              }
            </Button>
            <span className="text-sm text-muted">All systems auditable</span>
          </div>
        </header>
        <div className="p-5">
          <Suspense fallback={<DeferredFallback />}>
            <Outlet />
          </Suspense>
        </div>
      </main>
    </div>
  )
}

function projectSectionFromHash(hash: string): string {
  const value = hash.replace(/^#/, '')
  return projectNav.some((item) => item.hash === value) ? value : 'overview'
}

function projectIDFromSearch(search: string): string {
  return new URLSearchParams(search).get('project') ?? ''
}

function projectSectionHref(projectID: string, section: string): string {
  return `/projects?project=${encodeURIComponent(projectID)}#${section}`
}

// ponytail: renders nothing for 150ms so fast suspense resolves invisibly
function DeferredFallback() {
  const [show, setShow] = useState(false)
  useEffect(() => {
    const id = setTimeout(() => setShow(true), 150)
    return () => clearTimeout(id)
  }, [])
  if (!show) return null
  return <div className="text-sm text-muted">Loading...</div>
}

function setMetaDescription(content: string) {
  let meta = document.querySelector<HTMLMetaElement>('meta[name="description"]')
  if (!meta) {
    meta = document.createElement('meta')
    meta.name = 'description'
    document.head.append(meta)
  }
  meta.content = content
}

function setFavicon(href: string) {
  if (!href) {
    return
  }
  let link = document.querySelector<HTMLLinkElement>('link[rel="icon"]')
  if (!link) {
    link = document.createElement('link')
    link.rel = 'icon'
    document.head.append(link)
  }
  link.href = href
}

function accentForeground(hex: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return '#ffffff'
  }
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
  return luminance > 0.6 ? '#1a1a1a' : '#ffffff'
}

function accentTextColor(hex: string, theme: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return hex
  }
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
  const isLight = theme === 'light'

  if (isLight && luminance > 0.75) {
    return '#0753ab'
  }
  if (!isLight && luminance < 0.15) {
    return '#45a0ff'
  }
  return hex
}

function ensureVisibleAccent(hex: string, theme: string): string {
  const rgb = hexToRgb(hex)
  if (!rgb) {
    return '#0980fd'
  }
  const luminance = (0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2]) / 255
  const isLight = theme === 'light'

  if (isLight && luminance > 0.85) {
    return darken(rgb, 0.4)
  }
  if (isLight && luminance > 0.7) {
    return darken(rgb, 0.25)
  }
  if (!isLight && luminance < 0.08) {
    return lighten(rgb, 0.4)
  }
  if (!isLight && luminance < 0.2) {
    return lighten(rgb, 0.2)
  }
  return hex
}

function darken(rgb: [number, number, number], amount: number): string {
  const r = Math.round(rgb[0] * (1 - amount))
  const g = Math.round(rgb[1] * (1 - amount))
  const b = Math.round(rgb[2] * (1 - amount))
  return rgbToHex(r, g, b)
}

function lighten(rgb: [number, number, number], amount: number): string {
  const r = Math.round(rgb[0] + (255 - rgb[0]) * amount)
  const g = Math.round(rgb[1] + (255 - rgb[1]) * amount)
  const b = Math.round(rgb[2] + (255 - rgb[2]) * amount)
  return rgbToHex(r, g, b)
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + [r, g, b].map(c => c.toString(16).padStart(2, '0')).join('')
}

function hexToRgb(hex: string): [number, number, number] | null {
  hex = hex.replace(/^#/, '')
  if (hex.length === 3) {
    hex = hex[0] + hex[0] + hex[1] + hex[1] + hex[2] + hex[2]
  }
  if (hex.length !== 6) {
    return null
  }
  const n = parseInt(hex, 16)
  if (isNaN(n)) {
    return null
  }
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255]
}
