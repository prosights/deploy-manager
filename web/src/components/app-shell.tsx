import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { ArrowLeft, Bell, Cable, Ellipsis, FileClock, FolderKanban, Gauge, KeyRound, LogOut, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Rocket, Server, Settings, Sun } from 'lucide-react'
import { useSuspenseQueries } from '@tanstack/react-query'
import type { CSSProperties } from 'react'
import { Suspense, useEffect, useState } from 'react'
import type { InstanceSettings } from '../lib/api'
import { projectsQuery, settingsQuery } from '../lib/queries'
import { nextTheme, useUiStore } from '../store/ui'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from './ui/dropdown-menu'
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarInset,
  SidebarMenu,
  SidebarMenuButton,
  SidebarMenuItem,
  SidebarProvider,
  SidebarRail,
  SidebarTrigger,
  useSidebar,
} from './ui/sidebar'

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

const defaultSettings: InstanceSettings = {
  name: 'Deploy Manager',
  short_name: 'Deploy',
  meta_description: 'Internal deployment control plane',
  logo_url: '/branding/prosights/prosights-co-logo.png',
  favicon_url: '/branding/prosights/favicon.png',
  primary_color: '#0980fd',
  docs_url: '#',
}

const userName = import.meta.env.VITE_USER_NAME || 'Operator'
const userEmail = import.meta.env.VITE_USER_EMAIL || 'user@prosights.co'
const logoutURL = import.meta.env.VITE_LOGOUT_URL

export function AppShell() {
  const [settingsResult, projectsResult] = useSuspenseQueries({
    queries: [settingsQuery, projectsQuery],
  })
  const settings: InstanceSettings = settingsResult.data ?? defaultSettings
  const projects = projectsResult.data
  const location = useLocation()
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const safeAccent = ensureVisibleAccent(settings.primary_color || '#0980fd', theme)
  const brandStyle = {
    '--color-accent': safeAccent,
    '--color-accent-fg': accentForeground(safeAccent),
    '--color-accent-text': accentTextColor(safeAccent, theme),
  } as CSSProperties
  const projectID = projectIDFromPath(location.pathname)
  const isProjectPage = location.pathname.startsWith('/projects/')
  const activeProject = projects.find((project) => project.id === projectID)
  const title = pageTitle(location.pathname, activeProject?.name)

  useEffect(() => {
    document.title = settings.name
    setMetaDescription(settings.meta_description)
    setFavicon(settings.favicon_url)
  }, [settings.favicon_url, settings.meta_description, settings.name])

  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => {
        if (open === collapsed) toggleSidebar()
      }}
      className="text-prosights-text"
      style={brandStyle}
    >
      <Sidebar collapsible="icon" className="border-prosights-border bg-prosights-surface">
        <SidebarHeader className="h-[60px] justify-center border-b border-prosights-border px-3 py-0">
          <div className="flex h-9 items-center gap-2 rounded-prosights-md px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Link to="/" className="flex min-w-0 flex-1 items-center gap-2 text-left group-data-[collapsible=icon]:hidden">
              <div className="flex size-7 shrink-0 items-center justify-center">
                {settings.logo_url ? (
                  <img className="logo-mark max-h-7 max-w-7 object-contain" src={settings.logo_url} alt="" />
                ) : (
                  <span className="text-sm font-semibold text-prosights-text">{settings.short_name.slice(0, 1).toUpperCase()}</span>
                )}
              </div>
              <span className="truncate text-[16px] font-semibold text-prosights-text">{settings.short_name}</span>
            </Link>
            <SidebarCollapseToggle />
          </div>
        </SidebarHeader>

        <SidebarContent>
          <SidebarGroup className="px-2 py-1.5 group-data-[collapsible=icon]:pt-3.5">
            <SidebarGroupLabel className="h-6 px-2 text-[10px] font-medium uppercase tracking-[0.12em] text-prosights-subtle">
              Workspace
            </SidebarGroupLabel>
            <SidebarGroupContent>
              <SidebarMenu className="gap-0.5">
            {nav.map((item) => {
              const active = item.to === '/projects'
                ? location.pathname.startsWith('/projects')
                : location.pathname === item.to
              const Icon = item.icon
              return (
                <SidebarMenuItem key={item.to}>
                  <SidebarMenuButton
                    asChild
                    isActive={active}
                    tooltip={item.label}
                    className="group/sidebar-item h-8 rounded-prosights-md px-2 text-[13px] font-medium text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text data-[active=true]:bg-prosights-surface-muted data-[active=true]:text-prosights-text [&>svg]:size-4"
                  >
                    <Link to={item.to}>
                      <Icon className={active ? 'text-prosights-text' : 'text-prosights-muted group-hover/sidebar-item:text-prosights-text'} aria-hidden="true" />
                      <span>{item.label}</span>
                    </Link>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              )
            })}
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        </SidebarContent>

        <SidebarFooter className="border-t border-prosights-border p-3 group-data-[collapsible=icon]:items-center group-data-[collapsible=icon]:px-2">
          <SidebarMenu>
            <SidebarMenuItem>
              <DropdownMenu>
                <DropdownMenuTrigger
                  aria-label={`${userName} account`}
                  className="flex h-12 w-full min-w-0 items-center gap-2 overflow-hidden rounded-prosights-md px-1.5 text-left transition-colors hover:bg-prosights-surface-muted data-[state=open]:bg-prosights-surface-muted data-[state=open]:text-prosights-text group-data-[collapsible=icon]:h-8 group-data-[collapsible=icon]:w-8 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:gap-0 group-data-[collapsible=icon]:p-0"
                >
                  <div className="flex size-8 shrink-0 items-center justify-center rounded-[10px] bg-prosights-surface-muted text-sm font-semibold text-prosights-text">
                    {(userName || userEmail || 'User').charAt(0).toUpperCase()}
                  </div>
                  <div className="grid min-w-0 flex-1 text-left text-sm leading-tight group-data-[collapsible=icon]:hidden">
                    <span className="truncate font-semibold text-prosights-text">{userName}</span>
                  </div>
                  <Ellipsis className="ml-auto size-4 text-prosights-muted group-data-[collapsible=icon]:hidden" />
                </DropdownMenuTrigger>
                <DropdownMenuContent
                  className="w-[--radix-dropdown-menu-trigger-width] min-w-64 overflow-hidden rounded-prosights-xl border-prosights-border bg-prosights-surface p-0 text-prosights-text shadow-prosights-float"
                  side="top"
                  align="start"
                  sideOffset={4}
                >
                  <div className="flex flex-col gap-0.5 px-3.5 py-3">
                    <span className="truncate text-[13px] font-semibold leading-5">{userName}</span>
                    <span className="truncate text-[12px] leading-4 text-prosights-muted">{userEmail}</span>
                  </div>
                  <DropdownMenuSeparator className="my-0 bg-prosights-border" />
                  <div className="p-1">
                    <DropdownMenuItem
                      onClick={handleLogout}
                      className="cursor-pointer justify-between rounded-prosights-md px-2.5 py-2 text-[13px] text-prosights-muted transition-colors focus:bg-prosights-surface-muted focus:text-prosights-text"
                    >
                      <span>Log Out</span>
                      <LogOut className="size-4 text-prosights-muted" />
                    </DropdownMenuItem>
                  </div>
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="flex h-svh min-w-0 flex-col overflow-hidden bg-prosights-canvas">
        <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-prosights-border bg-prosights-surface px-4 sm:px-6">
          <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
            <SidebarTrigger className="md:hidden [&>svg]:size-4" />
            {isProjectPage && (
              <Link
                to="/projects"
                aria-label="Back to projects"
                title="Back to projects"
                className="inline-flex size-[30px] shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted hover:bg-prosights-surface-muted hover:text-prosights-text focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-prosights-ring"
              >
                <ArrowLeft className="size-4" aria-hidden="true" />
                <span className="sr-only">Back to projects</span>
              </Link>
            )}
            <div className="min-w-0">
              <h1 className="truncate text-[18px] font-semibold leading-5 text-prosights-text">{title}</h1>
            </div>
          </div>
          <div className="flex min-w-0 items-center gap-2">
            <Button
              variant="ghost"
              size="icon"
              className="size-8 bg-transparent text-prosights-muted hover:bg-prosights-surface-muted hover:text-prosights-text"
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
          </div>
        </header>
        <div className="min-h-0 flex-1 overflow-auto">
          <div className="mx-auto w-full max-w-[1760px] p-5">
            <Suspense fallback={<DeferredFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function handleLogout() {
  if (logoutURL) {
    window.location.replace(logoutURL)
    return
  }
  window.location.reload()
}

function SidebarCollapseToggle() {
  const { state, toggleSidebar } = useSidebar()
  const isCollapsed = state === 'collapsed'
  const Icon = isCollapsed ? PanelLeftOpen : PanelLeftClose

  return (
    <button
      type="button"
      aria-label={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      title={isCollapsed ? 'Expand sidebar' : 'Collapse sidebar'}
      onClick={toggleSidebar}
      className="inline-flex size-7 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text focus:outline-none focus-visible:ring-2 focus-visible:ring-prosights-ring"
    >
      <Icon className="size-4" />
    </button>
  )
}

function pageTitle(pathname: string, projectName?: string): string {
  if (pathname.startsWith('/projects/')) return projectName || 'Project'
  return nav.find((item) => item.to === pathname)?.label || 'Deploy Manager'
}

function projectIDFromPath(pathname: string): string {
  const match = pathname.match(/^\/projects\/([^/]+)/)
  return match ? decodeURIComponent(match[1]) : ''
}

// Renders nothing for 150ms so fast suspense resolves invisibly.
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
