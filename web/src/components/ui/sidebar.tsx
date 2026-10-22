import * as DialogPrimitive from '@radix-ui/react-dialog'
import { Slot } from '@radix-ui/react-slot'
import * as TooltipPrimitive from '@radix-ui/react-tooltip'
import { PanelLeftIcon } from 'lucide-react'
import { createContext, use, useEffect, useState, type CSSProperties, type ReactNode } from 'react'
import { useIsMobile } from '../../hooks/use-mobile'
import { cn } from '../../lib/cn'
import { Button } from './button'

// The app's left navigation: a fixed column on desktop that collapses to icons,
// and a slide-in sheet on mobile. Cmd/Ctrl+B toggles it.

type SidebarContextValue = {
  state: 'expanded' | 'collapsed'
  isMobile: boolean
  openMobile: boolean
  setOpenMobile: (open: boolean) => void
  toggleSidebar: () => void
}

const SidebarContext = createContext<SidebarContextValue | null>(null)

export function useSidebar() {
  const context = use(SidebarContext)
  if (!context) throw new Error('useSidebar must be used within a SidebarProvider.')
  return context
}

export function SidebarProvider({ className, children }: { className?: string, children: ReactNode }) {
  const isMobile = useIsMobile()
  const [open, setOpen] = useState(true)
  const [openMobile, setOpenMobile] = useState(false)

  function toggleSidebar() {
    if (isMobile) setOpenMobile((value) => !value)
    else setOpen((value) => !value)
  }

  useEffect(() => {
    function onKeyDown(event: KeyboardEvent) {
      if (event.key !== 'b' || !(event.metaKey || event.ctrlKey)) return
      event.preventDefault()
      if (isMobile) setOpenMobile((value) => !value)
      else setOpen((value) => !value)
    }
    window.addEventListener('keydown', onKeyDown)
    return () => window.removeEventListener('keydown', onKeyDown)
  }, [isMobile])

  return (
    <SidebarContext.Provider value={{ state: open ? 'expanded' : 'collapsed', isMobile, openMobile, setOpenMobile, toggleSidebar }}>
      <TooltipPrimitive.Provider delayDuration={0}>
        <div
          style={{ '--sidebar-width': '16rem', '--sidebar-width-icon': '3rem' } as CSSProperties}
          className={cn('group/sidebar-wrapper flex min-h-svh w-full', className)}
        >
          {children}
        </div>
      </TooltipPrimitive.Provider>
    </SidebarContext.Provider>
  )
}

export function Sidebar({ children }: { children: ReactNode }) {
  const { isMobile, state, openMobile, setOpenMobile } = useSidebar()

  if (isMobile) {
    return (
      <DialogPrimitive.Root open={openMobile} onOpenChange={setOpenMobile}>
        <DialogPrimitive.Portal>
          <DialogPrimitive.Overlay className="fixed inset-0 z-50 bg-black/50 data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:fade-out-0 data-[state=open]:fade-in-0" />
          <DialogPrimitive.Content
            className="fixed inset-y-0 left-0 z-50 flex h-full w-(--sidebar-width) flex-col gap-4 border-r bg-sidebar p-0 text-sidebar-foreground shadow-lg transition ease-in-out data-[state=closed]:animate-out data-[state=open]:animate-in data-[state=closed]:duration-300 data-[state=open]:duration-500 data-[state=closed]:slide-out-to-left data-[state=open]:slide-in-from-left sm:max-w-sm"
            style={{ '--sidebar-width': '18rem' } as CSSProperties}
          >
            <div className="sr-only">
              <DialogPrimitive.Title>Sidebar</DialogPrimitive.Title>
              <DialogPrimitive.Description>Displays the mobile sidebar.</DialogPrimitive.Description>
            </div>
            <div className="flex h-full w-full flex-col">{children}</div>
          </DialogPrimitive.Content>
        </DialogPrimitive.Portal>
      </DialogPrimitive.Root>
    )
  }

  // `group` + data-collapsible drive the group-data-[collapsible=icon]
  // classes in the sidebar's children.
  return (
    <div
      className="group hidden text-sidebar-foreground md:block"
      data-state={state}
      data-collapsible={state === 'collapsed' ? 'icon' : ''}
    >
      <div className="relative w-(--sidebar-width) bg-transparent transition-[width] duration-200 ease-linear group-data-[collapsible=icon]:w-(--sidebar-width-icon)" />
      <div className="fixed inset-y-0 left-0 z-10 hidden h-svh w-(--sidebar-width) transition-[left,right,width] duration-200 ease-linear group-data-[collapsible=icon]:w-(--sidebar-width-icon) md:flex">
        <div className="flex h-full w-full flex-col bg-sidebar">
          {children}
        </div>
      </div>
    </div>
  )
}

export function SidebarTrigger({ className }: { className?: string }) {
  const { toggleSidebar } = useSidebar()
  return (
    <Button variant="ghost" size="icon" className={cn('size-7', className)} onClick={toggleSidebar}>
      <PanelLeftIcon />
      <span className="sr-only">Toggle Sidebar</span>
    </Button>
  )
}

export function SidebarRail() {
  const { toggleSidebar } = useSidebar()
  return (
    <button
      aria-label="Toggle Sidebar"
      tabIndex={-1}
      onClick={toggleSidebar}
      title="Toggle Sidebar"
      className="absolute inset-y-0 -right-4 z-20 hidden w-4 -translate-x-1/2 cursor-w-resize transition-all after:absolute after:inset-y-0 after:left-1/2 after:w-[2px] hover:after:bg-sidebar-border group-data-[collapsible=icon]:cursor-e-resize sm:flex"
    />
  )
}

export function SidebarInset({ className, children }: { className?: string, children: ReactNode }) {
  return <main className={cn('relative flex w-full flex-1 flex-col bg-prosights-canvas', className)}>{children}</main>
}

export function SidebarHeader({ className, children }: { className?: string, children: ReactNode }) {
  return <div className={cn('flex flex-col gap-2 p-2', className)}>{children}</div>
}

export function SidebarFooter({ className, children }: { className?: string, children: ReactNode }) {
  return <div className={cn('flex flex-col gap-2 p-2', className)}>{children}</div>
}

export function SidebarContent({ children }: { children: ReactNode }) {
  return <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-auto group-data-[collapsible=icon]:overflow-hidden">{children}</div>
}

export function SidebarGroup({ className, children }: { className?: string, children: ReactNode }) {
  return <div className={cn('relative flex w-full min-w-0 flex-col p-2', className)}>{children}</div>
}

export function SidebarGroupLabel({ className, children }: { className?: string, children: ReactNode }) {
  return (
    <div
      className={cn(
        'flex h-8 shrink-0 items-center rounded-md px-2 text-xs font-medium text-sidebar-foreground/70 outline-hidden ring-sidebar-ring transition-[margin,opacity] duration-200 ease-linear focus-visible:ring-2',
        'group-data-[collapsible=icon]:-mt-8 group-data-[collapsible=icon]:opacity-0',
        className,
      )}
    >
      {children}
    </div>
  )
}

export function SidebarGroupContent({ children }: { children: ReactNode }) {
  return <div className="w-full text-sm">{children}</div>
}

export function SidebarMenu({ className, children }: { className?: string, children: ReactNode }) {
  return <ul className={cn('flex w-full min-w-0 flex-col gap-1', className)}>{children}</ul>
}

export function SidebarMenuItem({ children }: { children: ReactNode }) {
  return <li className="group/menu-item relative">{children}</li>
}

// Wraps its single child (a link) and shows `tooltip` beside it while the
// sidebar is collapsed to icons.
export function SidebarMenuButton({
  isActive = false,
  tooltip,
  className,
  children,
}: { isActive?: boolean, tooltip: string, className?: string, children: ReactNode }) {
  const { isMobile, state } = useSidebar()
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>
        <Slot
          data-slot="sidebar-menu-button"
          data-active={isActive}
          className={cn(
            'peer/menu-button flex h-8 w-full items-center gap-2 overflow-hidden rounded-md p-2 text-left text-sm outline-hidden ring-sidebar-ring transition-[width,height,padding] hover:bg-sidebar-accent hover:text-sidebar-accent-foreground focus-visible:ring-2 active:bg-sidebar-accent active:text-sidebar-accent-foreground disabled:pointer-events-none disabled:opacity-50 aria-disabled:pointer-events-none aria-disabled:opacity-50 data-[active=true]:bg-sidebar-accent data-[active=true]:font-medium data-[active=true]:text-sidebar-accent-foreground group-data-[collapsible=icon]:size-8! group-data-[collapsible=icon]:p-2! [&>span:last-child]:truncate [&>svg]:size-4 [&>svg]:shrink-0',
            className,
          )}
        >
          {children}
        </Slot>
      </TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content
          side="right"
          align="center"
          hidden={state !== 'collapsed' || isMobile}
          className="z-50 w-fit origin-(--radix-tooltip-content-transform-origin) rounded-md bg-prosights-text px-3 py-1.5 text-xs text-prosights-canvas"
        >
          {tooltip}
          <TooltipPrimitive.Arrow className="z-50 size-2.5 translate-y-[calc(-50%_-_2px)] rotate-45 rounded-[2px] bg-prosights-text fill-prosights-text" />
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  )
}
