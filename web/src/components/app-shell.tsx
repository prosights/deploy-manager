import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { Boxes, Cable, ChevronLeft, FileClock, FolderKanban, Gauge, GitBranch, KeyRound, Moon, Rocket, Route, Search, Server, Settings, Sun } from 'lucide-react'
import { useSuspenseQuery } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { useEffect } from 'react'
import { environmentsQuery, projectsQuery, settingsQuery } from '../lib/queries'
import { useUiStore } from '../store/ui'
import { Button } from './ui/button'
import { cn } from '../lib/cn'

const nav = [
  { to: '/', label: 'Overview', icon: Gauge },
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/applications', label: 'Applications', icon: Boxes },
  { to: '/deployments', label: 'Deployments', icon: Rocket },
  { to: '/credentials', label: 'Credentials', icon: KeyRound },
  { to: '/connectors', label: 'Connectors', icon: Cable },
  { to: '/proxy', label: 'Proxy', icon: Route },
  { to: '/audit', label: 'Audit', icon: FileClock },
  { to: '/settings', label: 'Settings', icon: Settings },
]

export function AppShell() {
  const { data: settings } = useSuspenseQuery(settingsQuery)
  const { data: projects } = useSuspenseQuery(projectsQuery)
  const { data: environments } = useSuspenseQuery(environmentsQuery)
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
  const activeProject = projects[0]
  const activeEnvironments = activeProject ? environments.filter((environment) => environment.project_id === activeProject.id) : []
  const contextLabel = activeProject
    ? `${activeProject.slug} / ${activeEnvironments.length} env${activeEnvironments.length === 1 ? '' : 's'}`
    : 'no projects'

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
                <Link
                  key={item.to}
                  to={item.to}
                  className={cn(
                    'flex h-9 items-center gap-3 rounded-md px-2 text-sm text-muted transition-colors hover:bg-panel hover:text-ink',
                    active && 'bg-accent/15 text-accent-text',
                  )}
                >
                  <Icon className="size-4 shrink-0" aria-hidden="true" />
                  {!collapsed && <span className="truncate">{item.label}</span>}
                </Link>
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
              onClick={() => setTheme(theme === 'dark' ? 'light' : 'dark')}
              aria-label="Toggle theme"
            >
              {theme === 'light'
                ? <Moon className="size-4" />
                : <Sun className="size-4" />
              }
            </Button>
            <span className="text-sm text-muted">All systems auditable</span>
          </div>
        </header>
        <div className="p-5">
          <Outlet />
        </div>
      </main>
    </div>
  )
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
