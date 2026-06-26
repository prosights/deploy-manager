type ErrorMessageProps = {
  message: string
}

export function PanelError({ message }: ErrorMessageProps) {
  return <div className="border-t px-4 py-3 text-sm text-danger">{message}</div>
}

export function BlockError({ message }: ErrorMessageProps) {
  return (
    <div className="rounded-md border border-danger/40 bg-danger/10 px-4 py-3 text-sm text-danger">
      {message}
    </div>
  )
}

export function InlineError({ message }: ErrorMessageProps) {
  return <span className="text-sm text-danger">{message}</span>
}
