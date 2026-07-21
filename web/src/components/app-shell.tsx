import { Link, Outlet, useLocation } from '@tanstack/react-router'
import { Bell, Cable, Ellipsis, FileClock, FolderKanban, Monitor, Moon, PanelLeftClose, PanelLeftOpen, Rocket, Server, Sun } from 'lucide-react'
import { useQuery, useSuspenseQueries } from '@tanstack/react-query'
import { Suspense, useEffect, useState } from 'react'
import { appVersionQuery, projectsQuery } from '../lib/queries'
import { nextTheme, useUiStore } from '../store/ui'
import { Button } from './ui/button'
import {
  DropdownMenu,
  DropdownMenuContent,
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

const nav: Array<{ to: string, label: string, icon: typeof FolderKanban }> = [
  { to: '/projects', label: 'Projects', icon: FolderKanban },
  { to: '/deployments', label: 'Deployments', icon: Rocket },
  { to: '/servers', label: 'Servers', icon: Server },
  { to: '/notifications', label: 'Notifications', icon: Bell },
  { to: '/connectors', label: 'Connectors', icon: Cable },
  { to: '/audit', label: 'Audit', icon: FileClock },
]

const userName = import.meta.env.VITE_USER_NAME || 'Operator'
const userEmail = import.meta.env.VITE_USER_EMAIL || 'user@prosights.co'

export function AppShell() {
  const [projectsResult] = useSuspenseQueries({
    queries: [projectsQuery],
  })
  const { data: appVersion } = useQuery(appVersionQuery)
  const projects = projectsResult.data
  const location = useLocation()
  const collapsed = useUiStore((state) => state.sidebarCollapsed)
  const toggleSidebar = useUiStore((state) => state.toggleSidebar)
  const theme = useUiStore((state) => state.theme)
  const setTheme = useUiStore((state) => state.setTheme)
  const projectID = projectIDFromPath(location.pathname)
  const isProjectPage = location.pathname.startsWith('/projects/')
  const activeProject = projects.find((project) => project.id === projectID)
  const title = pageTitle(location.pathname, activeProject?.name)

  return (
    <SidebarProvider
      open={!collapsed}
      onOpenChange={(open) => {
        if (open === collapsed) toggleSidebar()
      }}
      className="text-prosights-text"
    >
      <Sidebar collapsible="icon" className="border-prosights-border bg-prosights-surface">
        <SidebarHeader className="h-[60px] justify-center border-b border-prosights-border px-3 py-0">
          <div className="flex h-9 items-center gap-2 rounded-prosights-md px-1.5 group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0">
            <Link to="/projects" className="flex min-w-0 flex-1 items-center gap-2 text-left group-data-[collapsible=icon]:hidden">
              <div className="flex size-7 shrink-0 items-center justify-center">
                <img className="logo-mark max-h-7 max-w-7 object-contain" src="/branding/prosights/prosights-co-logo.png" alt="" />
              </div>
              <span className="truncate text-[16px] font-semibold text-prosights-text">Deploy</span>
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
          <div
            className="flex min-w-0 items-center justify-between gap-2 px-1.5 text-[11px] text-prosights-muted group-data-[collapsible=icon]:hidden"
            title={`${versionLabel(appVersion?.version)} · ${appVersion?.commit_sha || 'development build'}`}
          >
            <span className="font-medium uppercase tracking-[0.08em] text-prosights-subtle">Build</span>
            <span className="truncate font-mono">{versionLabel(appVersion?.version)} · {appVersion?.commit_sha?.slice(0, 7) || 'development'}</span>
          </div>
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
                    <span className="mt-0.5 w-fit rounded-full border border-prosights-border bg-prosights-surface px-1.5 py-0.5 text-[10px] font-medium leading-none text-prosights-muted">
                      User
                    </span>
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
                </DropdownMenuContent>
              </DropdownMenu>
            </SidebarMenuItem>
          </SidebarMenu>
        </SidebarFooter>
        <SidebarRail />
      </Sidebar>

      <SidebarInset className="flex h-svh min-w-0 flex-col overflow-hidden bg-prosights-canvas">
        {!isProjectPage && (
          <header className="sticky top-0 z-40 flex h-[60px] shrink-0 items-center justify-between gap-3 border-b border-prosights-border bg-prosights-surface px-4 sm:px-6">
            <div className="flex min-w-0 flex-1 items-center gap-3 overflow-hidden">
              <SidebarTrigger className="md:hidden [&>svg]:size-4" />
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
        )}
        <div className="min-h-0 flex-1 overflow-auto">
          <div className={isProjectPage ? 'h-full min-h-[640px]' : 'mx-auto w-full max-w-[1760px] p-5'}>
            <Suspense fallback={<DeferredFallback />}>
              <Outlet />
            </Suspense>
          </div>
        </div>
      </SidebarInset>
    </SidebarProvider>
  )
}

function versionLabel(version?: string): string {
  if (!version || version === 'dev') return 'Local'
  return version.startsWith('v') ? version : `v${version}`
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
