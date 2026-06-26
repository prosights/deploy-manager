import type React from 'react'

type SelectInputProps = {
  label: string
  value: string
  onChange: (value: string) => void
  children: React.ReactNode
  disabled?: boolean
  required?: boolean
}

export function SelectInput({
  label,
  value,
  onChange,
  children,
  disabled,
  required,
}: SelectInputProps) {
  return (
    <label className="space-y-1 text-xs text-muted">
      <span>{label}</span>
      <select
        className="h-9 w-full rounded-md border bg-background px-2 text-sm text-ink outline-none focus-visible:ring-2 focus-visible:ring-accent"
        value={value}
        onChange={(event) => onChange(event.target.value)}
        disabled={disabled}
        required={required}
      >
        {children}
      </select>
    </label>
  )
}
