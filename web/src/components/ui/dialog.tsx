import * as DialogPrimitive from '@radix-ui/react-dialog'
import { X } from 'lucide-react'
import type { ComponentProps, ReactNode } from 'react'
import { cn } from '../../lib/cn'

// The one dialog. `layout="center"` is a modal form; `layout="drawer"` is the
// full-height panel that slides in from the right (services, servers).

export const Dialog = DialogPrimitive.Root
export const DialogTrigger = DialogPrimitive.Trigger
export const DialogClose = DialogPrimitive.Close

const fade = 'data-[state=closed]:animate-out data-[state=closed]:fade-out-0 data-[state=closed]:duration-100 data-[state=open]:animate-in data-[state=open]:fade-in-0 data-[state=open]:duration-150'

const centerWidths = {
  sm: 'max-w-md',
  md: 'max-w-3xl',
  lg: 'max-w-4xl',
  xl: 'max-w-6xl',
}

export function DialogContent({
  layout = 'center',
  size = 'md',
  className,
  children,
  ...props
}: ComponentProps<typeof DialogPrimitive.Content> & {
  layout?: 'center' | 'drawer'
  size?: keyof typeof centerWidths
}) {
  return (
    <DialogPrimitive.Portal>
      <DialogPrimitive.Overlay className={cn('fixed inset-0 z-50', layout === 'drawer' ? 'bg-black/[0.04]' : 'bg-black/20 backdrop-blur-[1px]', fade)} />
      <DialogPrimitive.Content
        className={cn(
          'fixed z-50 flex flex-col overflow-hidden rounded-prosights-xl border border-prosights-border bg-prosights-surface outline-none',
          fade,
          layout === 'drawer'
            ? 'inset-y-3 right-3 w-[calc(100%-1.5rem)] max-w-[1240px] shadow-[0_24px_80px_rgba(0,0,0,0.20)] data-[state=closed]:slide-out-to-right-2 data-[state=open]:slide-in-from-right-2 sm:w-[min(68vw,1240px)]'
            : cn('left-1/2 top-1/2 max-h-[calc(100svh-2rem)] w-[calc(100%-2rem)] -translate-x-1/2 -translate-y-1/2 shadow-[0_24px_80px_rgba(0,0,0,0.18)]', centerWidths[size]),
          className,
        )}
        {...props}
      >
        {children}
      </DialogPrimitive.Content>
    </DialogPrimitive.Portal>
  )
}

// Title, description, and close button. Extra header content (tabs, actions)
// goes in `children` below the title row.
export function DialogHeader({
  title,
  description,
  closeLabel,
  icon,
  actions,
  children,
}: {
  title: ReactNode
  description?: ReactNode
  closeLabel: string
  icon?: ReactNode
  actions?: ReactNode
  children?: ReactNode
}) {
  return (
    <header className={cn('shrink-0 border-b border-prosights-border px-6', children ? 'pt-5' : 'py-5')}>
      <div className="flex items-start justify-between gap-4">
        <div className="flex min-w-0 items-center gap-3">
          {icon}
          <div className="min-w-0">
            <DialogPrimitive.Title className="truncate text-[17px] font-semibold text-prosights-text">{title}</DialogPrimitive.Title>
            {description
              ? <DialogPrimitive.Description className="mt-1 text-[12px] leading-5 text-prosights-muted">{description}</DialogPrimitive.Description>
              : <DialogPrimitive.Description className="sr-only">{title}</DialogPrimitive.Description>}
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          {actions}
          <DialogCloseButton label={closeLabel} />
        </div>
      </div>
      {children}
    </header>
  )
}

export function DialogCloseButton({ label }: { label: string }) {
  return (
    <DialogPrimitive.Close
      aria-label={label}
      className="inline-flex size-8 shrink-0 items-center justify-center rounded-prosights-md text-prosights-muted transition-colors hover:bg-prosights-surface-muted hover:text-prosights-text"
    >
      <X className="size-4" aria-hidden="true" />
    </DialogPrimitive.Close>
  )
}

export function DialogBody({ className, ...props }: ComponentProps<'div'>) {
  return <div className={cn('min-h-0 flex-1 overflow-auto bg-prosights-canvas p-6', className)} {...props} />
}
