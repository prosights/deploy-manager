import { AlertTriangle, CheckCircle2, Info, X } from 'lucide-react'
import { useToastStore, type Toast } from '../../store/toasts'
import { Button } from './button'

const toneIcons = {
  success: CheckCircle2,
  danger: AlertTriangle,
  info: Info,
}

const toneClasses = {
  success: 'text-success',
  danger: 'text-danger',
  info: 'text-accent-text',
}

// Bottom-right action feedback. aria-live lets screen readers announce
// results without moving focus away from the form that triggered them.
export function Toaster() {
  const toasts = useToastStore((state) => state.toasts)
  const dismiss = useToastStore((state) => state.dismiss)
  if (toasts.length === 0) return null
  return (
    <div aria-live="polite" className="pointer-events-none fixed bottom-4 right-4 z-50 flex w-full max-w-sm flex-col gap-2">
      {toasts.map((toast) => <ToastCard key={toast.id} toast={toast} onDismiss={() => dismiss(toast.id)} />)}
    </div>
  )
}

function ToastCard({ toast, onDismiss }: { toast: Toast, onDismiss: () => void }) {
  const Icon = toneIcons[toast.tone]
  return (
    <div role="status" className="toast-card pointer-events-auto flex items-start gap-3 rounded-lg border bg-surface p-3 shadow-lg">
      <Icon className={`mt-0.5 size-4 shrink-0 ${toneClasses[toast.tone]}`} aria-hidden="true" />
      <div className="min-w-0 flex-1 text-sm">
        <div className="font-medium text-ink">{toast.title}</div>
        {toast.description && <div className="mt-0.5 break-words text-xs leading-5 text-muted">{toast.description}</div>}
      </div>
      <Button type="button" variant="ghost" className="h-6 px-1" aria-label="Dismiss notification" onClick={onDismiss}>
        <X className="size-3.5" aria-hidden="true" />
      </Button>
    </div>
  )
}
