import { useSuspenseQuery } from '@tanstack/react-query'
import { ArrowRight, Container, Github, MoveDiagonal2, Plus } from 'lucide-react'
import { useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react'
import { Button } from '../../components/ui/button'
import type { Application, ProxyRoute } from '../../lib/api'
import { cn } from '../../lib/cn'
import { applicationsQuery, proxyRoutesQuery } from '../../lib/queries'
import { useLocalStorage } from '../../lib/use-local-storage'
import { applicationComposeServices, proxyRouteURL } from '../applications/helpers'

type NodePosition = { x: number, y: number }
type NodeLayout = NodePosition & { width?: number, height?: number }
type NodeSize = { width: number, height: number }

const architectureGridSize = 22
const architectureNodeWidth = 252
const architectureNodeMinWidth = 220
const architectureNodeMinHeight = 148

// The pannable architecture canvas: one draggable, resizable card per service
// in the environment. Card layouts and the camera offset persist per project.
export function ProjectCanvas({
  projectID,
  environmentID,
  environmentName,
  onOpen,
  onAdd,
}: {
  projectID: string
  environmentID: string
  environmentName?: string
  onOpen: (application: Application) => void
  onAdd: () => void
}) {
  const { data: applications } = useSuspenseQuery({
    ...applicationsQuery,
    select: (items) => items.filter((application) => application.environment_id === environmentID),
  })
  const { data: routes } = useSuspenseQuery(proxyRoutesQuery)
  const [layouts, setLayouts] = useLocalStorage<Record<string, NodeLayout>>(`deploy-manager:architecture:${projectID}`, {}, parseNodeLayouts)
  const [canvasOffset, setCanvasOffset] = useLocalStorage<NodePosition>(`deploy-manager:architecture-camera:${projectID}`, { x: 0, y: 0 }, parseCanvasOffset)
  const [canvasPanning, setCanvasPanning] = useState(false)
  const canvasRef = useRef<HTMLElement>(null)
  const worldRef = useRef<HTMLDivElement>(null)
  const pan = useRef<{ pointerID: number, x: number, y: number, origin: NodePosition, offset: NodePosition } | undefined>(undefined)

  function applyCanvasOffset(offset: NodePosition) {
    if (canvasRef.current) canvasRef.current.style.backgroundPosition = `${offset.x}px ${offset.y}px`
    if (worldRef.current) worldRef.current.style.transform = nodeTransform(offset)
  }

  function startCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    if (event.button !== 0 || pan.current || (event.target instanceof Element && event.target.closest('button, a, input, select, textarea'))) return
    event.currentTarget.setPointerCapture?.(event.pointerId)
    pan.current = { pointerID: event.pointerId, x: event.clientX, y: event.clientY, origin: canvasOffset, offset: canvasOffset }
    setCanvasPanning(true)
  }

  function moveCanvas(event: ReactPointerEvent<HTMLElement>) {
    const current = pan.current
    if (!current || current.pointerID !== event.pointerId) return
    current.offset = { x: current.origin.x + event.clientX - current.x, y: current.origin.y + event.clientY - current.y }
    applyCanvasOffset(current.offset)
  }

  function finishCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    const current = pan.current
    if (!current || current.pointerID !== event.pointerId) return
    pan.current = undefined
    if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
    setCanvasOffset(current.offset)
    setCanvasPanning(false)
  }

  function finishCanvasPanAfterCaptureLoss() {
    const current = pan.current
    if (!current) return
    pan.current = undefined
    setCanvasOffset(current.offset)
    setCanvasPanning(false)
  }

  function cancelCanvasPan(event: ReactPointerEvent<HTMLElement>) {
    const current = pan.current
    if (!current || current.pointerID !== event.pointerId) return
    applyCanvasOffset(current.origin)
    pan.current = undefined
    setCanvasPanning(false)
  }

  return (
    <section
      ref={canvasRef}
      className={cn('architecture-grid relative min-h-0 flex-1 touch-none select-none overflow-hidden', canvasPanning ? 'cursor-grabbing' : 'cursor-grab')}
      style={{ backgroundPosition: `${canvasOffset.x}px ${canvasOffset.y}px` }}
      aria-labelledby="architecture-heading"
      onPointerDown={startCanvasPan}
      onPointerMove={moveCanvas}
      onPointerUp={finishCanvasPan}
      onPointerCancel={cancelCanvasPan}
      onLostPointerCapture={finishCanvasPanAfterCaptureLoss}
    >
      <h1 id="architecture-heading" className="sr-only">Architecture</h1>
      {applications.length > 0
        ? (
            <div ref={worldRef} className="architecture-world absolute inset-0 will-change-transform" style={{ transform: nodeTransform(canvasOffset) }}>
              {applications.map((application, index) => (
                <ArchitectureNode
                  key={application.id}
                  application={application}
                  routes={routes.filter((route) => route.application_id === application.id)}
                  layout={layouts[application.id] ?? defaultNodeLayout(index)}
                  onChange={(next) => setLayouts({ ...layouts, [application.id]: next })}
                  onOpen={() => onOpen(application)}
                />
              ))}
            </div>
          )
        : (
            <div className="absolute inset-0 flex items-center justify-center p-6">
              <div className="flex max-w-md flex-col items-center rounded-prosights-lg border border-prosights-border bg-prosights-surface px-8 py-7 text-center shadow-sm">
                <div className="flex size-10 items-center justify-center rounded-prosights-md border border-prosights-border bg-prosights-surface-muted text-prosights-muted">
                  <Container className="size-5" aria-hidden="true" />
                </div>
                <h2 className="mt-4 text-[15px] font-semibold text-prosights-text">No services in {environmentName ?? 'this environment'}</h2>
                <p className="mt-1 text-[13px] leading-5 text-prosights-muted">Import from GitHub and Paddock will find the compose file for you.</p>
                <Button type="button" variant="primary" className="mt-4" onClick={onAdd}>
                  <Plus className="size-4" aria-hidden="true" /> Add service
                </Button>
              </div>
            </div>
          )}
      {applications.length > 0 && <div className="pointer-events-none absolute bottom-3 left-3 rounded-prosights-md border border-prosights-border bg-prosights-surface/90 px-2.5 py-1.5 text-[10px] text-prosights-muted shadow-sm backdrop-blur-sm">Drag canvas to pan · drag cards to move · drag the corner to resize</div>}
    </section>
  )
}

function ArchitectureNode({
  application,
  routes,
  layout,
  onChange,
  onOpen,
}: {
  application: Application
  routes: ProxyRoute[]
  layout: NodeLayout
  onChange: (layout: NodeLayout) => void
  onOpen: () => void
}) {
  const drag = useRef<{ pointerID: number, x: number, y: number, origin: NodePosition, position: NodePosition, moved: boolean } | undefined>(undefined)
  const resize = useRef<{ pointerID: number, x: number, y: number, origin: NodeSize, size: NodeSize } | undefined>(undefined)
  const cardRef = useRef<HTMLDivElement>(null)
  const suppressClick = useRef(false)

  function resizeWithKeyboard(event: ReactKeyboardEvent<HTMLButtonElement>) {
    event.stopPropagation()
    const width = layout.width ?? architectureNodeWidth
    const height = layout.height ?? cardRef.current?.offsetHeight ?? architectureNodeMinHeight
    let next: NodeSize
    if (event.key === 'ArrowRight') next = { width: width + architectureGridSize, height }
    else if (event.key === 'ArrowLeft') next = { width: Math.max(architectureNodeMinWidth, width - architectureGridSize), height }
    else if (event.key === 'ArrowDown') next = { width, height: height + architectureGridSize }
    else if (event.key === 'ArrowUp') next = { width, height: Math.max(architectureNodeMinHeight, height - architectureGridSize) }
    else return
    event.preventDefault()
    onChange({ ...layout, ...next })
  }

  return (
    <div
      ref={cardRef}
      role="button"
      tabIndex={0}
      aria-label={`Open ${application.name}`}
      className="group absolute flex min-h-[148px] min-w-[220px] touch-none cursor-grab flex-col overflow-hidden rounded-[10px] border border-prosights-border bg-prosights-surface p-4 text-left shadow-[0_1px_2px_rgba(0,0,0,0.04)] transition-[border-color,box-shadow] duration-150 hover:border-prosights-subtle hover:shadow-[0_8px_24px_rgba(0,0,0,0.08)] active:cursor-grabbing active:shadow-[0_12px_32px_rgba(0,0,0,0.10)]"
      style={{ transform: nodeTransform(layout), width: layout.width ?? architectureNodeWidth, height: layout.height }}
      onPointerDown={(event) => {
        event.stopPropagation()
        if (event.button !== 0 || drag.current) return
        event.currentTarget.setPointerCapture?.(event.pointerId)
        const position = { x: layout.x, y: layout.y }
        drag.current = { pointerID: event.pointerId, x: event.clientX, y: event.clientY, origin: position, position, moved: false }
      }}
      onPointerMove={(event) => {
        const current = drag.current
        if (!current || current.pointerID !== event.pointerId) return
        const deltaX = event.clientX - current.x
        const deltaY = event.clientY - current.y
        if (Math.abs(deltaX) + Math.abs(deltaY) > 4) current.moved = true
        current.position = {
          x: snapToGrid(current.origin.x + deltaX),
          y: snapToGrid(current.origin.y + deltaY),
        }
        event.currentTarget.style.transform = nodeTransform(current.position)
      }}
      onPointerUp={(event) => {
        const current = drag.current
        if (!current || current.pointerID !== event.pointerId) return
        suppressClick.current = current.moved
        drag.current = undefined
        if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
        if (current.moved) onChange({ ...layout, ...current.position })
      }}
      onLostPointerCapture={() => {
        const current = drag.current
        if (!current) return
        suppressClick.current = current.moved
        drag.current = undefined
        if (current.moved) onChange({ ...layout, ...current.position })
      }}
      onPointerCancel={(event) => {
        const current = drag.current
        if (!current || current.pointerID !== event.pointerId) return
        event.currentTarget.style.transform = nodeTransform(current.origin)
        drag.current = undefined
      }}
      onClick={() => {
        if (suppressClick.current) {
          suppressClick.current = false
          return
        }
        onOpen()
      }}
      onKeyDown={(event) => {
        if (event.key !== 'Enter' && event.key !== ' ') return
        event.preventDefault()
        onOpen()
      }}
    >
      <div className="flex items-start justify-between gap-3">
        <div className="flex min-w-0 items-center gap-2.5">
          <div className="flex size-8 shrink-0 items-center justify-center rounded-prosights-md border border-prosights-border bg-prosights-surface-muted text-prosights-muted">
            <Github className="size-4" aria-hidden="true" />
          </div>
          <div className="min-w-0">
            <h2 className="truncate text-[14px] font-semibold text-prosights-text">{application.name}</h2>
            <ArchitectureRouteRows application={application} routes={routes} />
          </div>
        </div>
        <ArrowRight className="mt-1 size-4 shrink-0 text-prosights-subtle opacity-0 transition-[opacity,transform] group-hover:translate-x-0.5 group-hover:opacity-100" aria-hidden="true" />
      </div>
      <div className="mt-auto flex items-center justify-between gap-3 border-t border-prosights-border pt-3 pr-3">
        <span className="inline-flex items-center gap-2 text-[12px] font-medium text-prosights-muted">
          <span className={cn('size-2 rounded-full', application.status === 'healthy' ? 'bg-success' : application.status === 'failed' ? 'bg-danger' : 'bg-prosights-subtle')} />
          {application.status}
        </span>
        <span className="max-w-28 truncate text-[11px] text-prosights-subtle">{application.server_name}</span>
      </div>
      <button
        type="button"
        aria-label={`Resize ${application.name}`}
        className="absolute bottom-0.5 right-0.5 flex size-6 cursor-nwse-resize items-center justify-center rounded-prosights-sm text-prosights-subtle opacity-60 transition-[color,opacity] duration-150 hover:text-prosights-text hover:opacity-100 focus-visible:text-prosights-text focus-visible:opacity-100"
        onClick={(event) => event.stopPropagation()}
        onKeyDown={resizeWithKeyboard}
        onPointerDown={(event) => {
          event.stopPropagation()
          if (event.button !== 0 || resize.current) return
          event.currentTarget.setPointerCapture?.(event.pointerId)
          const origin = {
            width: cardRef.current?.offsetWidth || layout.width || architectureNodeWidth,
            height: cardRef.current?.offsetHeight || layout.height || architectureNodeMinHeight,
          }
          resize.current = { pointerID: event.pointerId, x: event.clientX, y: event.clientY, origin, size: origin }
        }}
        onPointerMove={(event) => {
          event.stopPropagation()
          const current = resize.current
          if (!current || current.pointerID !== event.pointerId) return
          current.size = {
            width: Math.max(architectureNodeMinWidth, current.origin.width + event.clientX - current.x),
            height: Math.max(architectureNodeMinHeight, current.origin.height + event.clientY - current.y),
          }
          if (cardRef.current) {
            cardRef.current.style.width = `${current.size.width}px`
            cardRef.current.style.height = `${current.size.height}px`
          }
        }}
        onPointerUp={(event) => {
          event.stopPropagation()
          const current = resize.current
          if (!current || current.pointerID !== event.pointerId) return
          resize.current = undefined
          if (event.currentTarget.hasPointerCapture?.(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId)
          onChange({ ...layout, ...current.size })
        }}
        onLostPointerCapture={() => {
          const current = resize.current
          if (!current) return
          resize.current = undefined
          onChange({ ...layout, ...current.size })
        }}
        onPointerCancel={(event) => {
          event.stopPropagation()
          const current = resize.current
          if (!current || current.pointerID !== event.pointerId) return
          if (cardRef.current) {
            cardRef.current.style.width = `${current.origin.width}px`
            cardRef.current.style.height = `${current.origin.height}px`
          }
          resize.current = undefined
        }}
      >
        <MoveDiagonal2 className="size-3.5" aria-hidden="true" />
      </button>
    </div>
  )
}

function ArchitectureRouteRows({ application, routes }: { application: Application, routes: ProxyRoute[] }) {
  const rows = architectureRouteRows(application, routes)
  return (
    <div className="mt-1 grid gap-0.5 text-[10px] leading-4 text-prosights-muted">
      {rows.map((row) => (
        <div key={`${row.label}:${row.url}`} className="grid min-w-0 grid-cols-[auto_minmax(0,1fr)_auto] gap-1.5">
          <span className="font-mono text-prosights-subtle">{row.label}</span>
          {row.url.startsWith('http') ? (
            <a
              href={row.url}
              target="_blank"
              rel="noreferrer"
              className="truncate hover:text-prosights-text hover:underline"
              onClick={(event) => event.stopPropagation()}
              onPointerDown={(event) => event.stopPropagation()}
            >
              {row.url}
            </a>
          ) : (
            <span className="truncate">{row.url}</span>
          )}
          {row.upstream
            ? <span title={`Active upstream ${row.upstream}`} className="font-mono text-prosights-subtle">{upstreamPortLabel(row.upstream)}</span>
            : row.port && <span title="Published host port" className="font-mono text-prosights-subtle">{row.port}</span>}
        </div>
      ))}
    </div>
  )
}

type RouteRow = { label: string, url: string, upstream?: string, port?: string }

function architectureRouteRows(application: Application, routes: ProxyRoute[]): RouteRow[] {
  const services = applicationComposeServices(application)
  if (services.length === 0) {
    if (routes.length > 0) return routes.map((route) => ({ label: route.compose_service || 'service', url: proxyRouteURL(route), upstream: route.upstream_url }))
    return [{ label: 'service', url: application.domain ? `https://${application.domain}` : 'No domains yet' }]
  }

  const matchedRoutes = new Set<string>()
  const rows = services.flatMap<RouteRow>((service) => {
    const serviceRoutes = routes.filter((route) => route.compose_service === service.name || (!route.compose_service && services.length === 1))
    serviceRoutes.forEach((route) => matchedRoutes.add(route.id))
    if (serviceRoutes.length > 0) return serviceRoutes.map((route) => ({ label: service.name, url: proxyRouteURL(route), upstream: route.upstream_url }))
    const ports = service.ports?.flatMap((port) => port.published_port ? [`:${port.published_port}`] : []).join(', ')
    return [{ label: service.name, url: 'private', port: ports || undefined }]
  })
  return [...rows, ...routes.filter((route) => !matchedRoutes.has(route.id)).map((route) => ({ label: route.compose_service || 'service', url: proxyRouteURL(route), upstream: route.upstream_url }))]
}

function upstreamPortLabel(upstream: string): string {
  try {
    const url = new URL(upstream)
    return `:${url.port || (url.protocol === 'https:' ? '443' : '80')}`
  } catch {
    return upstream
  }
}

function defaultNodeLayout(index: number): NodeLayout { return { x: 44 + (index % 3) * 286, y: 44 + Math.floor(index / 3) * 176 } }
function snapToGrid(value: number): number { return Math.round(value / architectureGridSize) * architectureGridSize }
function nodeTransform(position: NodePosition): string { return `translate3d(${position.x}px, ${position.y}px, 0)` }

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function finite(value: unknown): value is number {
  return Number.isFinite(value)
}

function parseCanvasOffset(stored: unknown): NodePosition | undefined {
  return isRecord(stored) && finite(stored.x) && finite(stored.y) ? { x: stored.x, y: stored.y } : undefined
}

function parseNodeLayouts(stored: unknown): Record<string, NodeLayout> | undefined {
  if (!isRecord(stored)) return undefined
  return Object.fromEntries(Object.entries(stored).flatMap(([applicationID, layout]) => {
    if (!isRecord(layout) || !finite(layout.x) || !finite(layout.y)) return []
    const value: NodeLayout = { x: snapToGrid(layout.x), y: snapToGrid(layout.y) }
    if (finite(layout.width)) value.width = Math.max(architectureNodeMinWidth, layout.width)
    if (finite(layout.height)) value.height = Math.max(architectureNodeMinHeight, layout.height)
    return [[applicationID, value]]
  }))
}
